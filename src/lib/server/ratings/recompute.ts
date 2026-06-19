// Orchestrates a full, idempotent ratings rebuild for one (sport, division,
// season) scope. Reads final games + carryover seeds from the DB, runs the
// pure engines, and rebuilds the team_ratings rows via delete-then-insert so
// the stored history always exactly reflects the games table.

import { supabaseAdmin } from '$lib/server/supabase-admin';
import { computeElo, buildEloSeeds } from './elo';
import { computeRpi } from './rpi';
import { computePower } from './power';
import type { GameInput, RatingRow, RatingSystem } from './types';

export interface RecomputeArgs {
	sportCode: string;
	division: number;
	seasonId: number;
	systems?: RatingSystem[];
}

export interface SystemResult {
	system: RatingSystem;
	gamesProcessed: number;
	teamsRated: number;
	rowsWritten: number;
}

export interface RecomputeResult {
	sportCode: string;
	division: number;
	seasonId: number;
	results: SystemResult[];
}

const INSERT_CHUNK = 1000;
// PostgREST caps each response at the project's max_rows (1000 here), so every
// read that can exceed that must page through with .range(). A full season is
// well over 1000 games — truncation would silently corrupt ELO.
const PAGE = 1000;

/** Final, score-complete games for the scope, in deterministic chronological order. */
async function loadFinalGames(
	sportCode: string,
	division: number,
	seasonId: number
): Promise<GameInput[]> {
	const out: GameInput[] = [];
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await supabaseAdmin
			.from('games')
			.select(
				'id, contest_date, start_time, home_team_season_id, away_team_season_id, home_score, away_score, neutral_site'
			)
			.eq('sport_code', sportCode)
			.eq('division', division)
			.eq('season_id', seasonId)
			.eq('status', 'final')
			.not('home_score', 'is', null)
			.not('away_score', 'is', null)
			.order('contest_date', { ascending: true })
			.order('start_time', { ascending: true, nullsFirst: false })
			.order('id', { ascending: true })
			.range(from, from + PAGE - 1);

		if (error) throw new Error(`loadFinalGames: ${error.message}`);
		const rows = data ?? [];
		for (const g of rows) {
			out.push({
				id: g.id,
				contestDate: g.contest_date,
				startTime: g.start_time,
				homeTeamSeasonId: g.home_team_season_id,
				awayTeamSeasonId: g.away_team_season_id,
				homeScore: g.home_score as number,
				awayScore: g.away_score as number,
				neutralSite: g.neutral_site
			});
		}
		if (rows.length < PAGE) break;
	}
	return out;
}

/** All team_seasons in the scope (the teams we will rate). */
async function loadScopeTeamSeasons(
	sportCode: string,
	division: number,
	seasonId: number
): Promise<{ id: number; team_id: number }[]> {
	const out: { id: number; team_id: number }[] = [];
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await supabaseAdmin
			.from('team_seasons')
			.select('id, team_id')
			.eq('sport_code', sportCode)
			.eq('division', division)
			.eq('season_id', seasonId)
			.eq('division_member', true)
			.order('id', { ascending: true })
			.range(from, from + PAGE - 1);

		if (error) throw new Error(`loadScopeTeamSeasons: ${error.message}`);
		const rows = data ?? [];
		out.push(...rows);
		if (rows.length < PAGE) break;
	}
	return out;
}

/**
 * Map current team_season_id -> prior-season final ELO, matched by team_id.
 * Uses the most recent season (this sport) that starts before the current one,
 * regardless of division. Returns an empty map if there is no prior season or
 * it has no ELO ratings yet (teams then seed at the base rating).
 */
async function loadEloCarryover(
	sportCode: string,
	seasonId: number,
	currentTeamSeasons: { id: number; team_id: number }[]
): Promise<Map<number, number>> {
	const { data: curSeason, error: curErr } = await supabaseAdmin
		.from('seasons')
		.select('start_date')
		.eq('id', seasonId)
		.single();
	if (curErr || !curSeason) return new Map();

	const { data: prior } = await supabaseAdmin
		.from('seasons')
		.select('id')
		.lt('start_date', curSeason.start_date)
		.order('start_date', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (!prior) return new Map();

	// Latest ELO per team_season in the prior season for this sport. Paginated:
	// a full prior season is thousands of per-game history rows.
	const priorFinalByTeamId = new Map<number, number>();
	for (let from = 0; ; from += PAGE) {
		const { data: priorRows, error: prErr } = await supabaseAdmin
			.from('team_ratings')
			.select('value, as_of, team_seasons!inner(team_id, season_id, sport_code)')
			.eq('system', 'elo')
			.eq('team_seasons.sport_code', sportCode)
			.eq('team_seasons.season_id', prior.id)
			.order('as_of', { ascending: false })
			.range(from, from + PAGE - 1);
		if (prErr || !priorRows) break;

		// First row seen per team_id is its latest (rows are sorted by as_of desc).
		for (const row of priorRows as unknown as {
			value: number;
			team_seasons: { team_id: number };
		}[]) {
			const teamId = row.team_seasons.team_id;
			if (!priorFinalByTeamId.has(teamId)) priorFinalByTeamId.set(teamId, row.value);
		}
		if (priorRows.length < PAGE) break;
	}

	const priorFinalByTeamSeasonId = new Map<number, number>();
	for (const ts of currentTeamSeasons) {
		const prev = priorFinalByTeamId.get(ts.team_id);
		if (prev !== undefined) priorFinalByTeamSeasonId.set(ts.id, prev);
	}
	return priorFinalByTeamSeasonId;
}

/** Keep only the last row per (team_season, as_of) — the day's final value. */
function collapseByDay(rows: RatingRow[]): RatingRow[] {
	const byKey = new Map<string, RatingRow>();
	for (const r of rows) byKey.set(`${r.teamSeasonId}|${r.asOf}`, r);
	return [...byKey.values()];
}

/** Delete every row for (scope, system), then bulk-insert the fresh set. */
async function rebuildSystem(
	teamSeasonIds: number[],
	system: RatingSystem,
	rows: RatingRow[]
): Promise<void> {
	if (teamSeasonIds.length === 0) return;

	const { error: delErr } = await supabaseAdmin
		.from('team_ratings')
		.delete()
		.eq('system', system)
		.in('team_season_id', teamSeasonIds);
	if (delErr) throw new Error(`rebuildSystem(${system}) delete: ${delErr.message}`);

	const payload = rows.map((r) => ({
		team_season_id: r.teamSeasonId,
		system: r.system,
		as_of: r.asOf,
		value: r.value,
		games_played: r.gamesPlayed,
		meta: r.meta ?? null
	}));

	for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
		const chunk = payload.slice(i, i + INSERT_CHUNK);
		const { error: insErr } = await supabaseAdmin.from('team_ratings').insert(chunk);
		if (insErr) throw new Error(`rebuildSystem(${system}) insert: ${insErr.message}`);
	}
}

export async function recomputeRatings(args: RecomputeArgs): Promise<RecomputeResult> {
	const { sportCode, division, seasonId } = args;
	const systems = args.systems ?? ['elo'];

	// Keep the division-membership flag current, then rate only genuine members
	// and only games between two members (non-D1 games are excluded entirely).
	await supabaseAdmin.rpc('refresh_division_members', {
		p_sport_code: sportCode,
		p_division: division,
		p_season_id: seasonId
	});

	const [allGames, teamSeasons] = await Promise.all([
		loadFinalGames(sportCode, division, seasonId),
		loadScopeTeamSeasons(sportCode, division, seasonId)
	]);
	const teamSeasonIds = teamSeasons.map((t) => t.id);
	const memberSet = new Set(teamSeasonIds);
	const games = allGames.filter(
		(g) => memberSet.has(g.homeTeamSeasonId) && memberSet.has(g.awayTeamSeasonId)
	);

	const results: SystemResult[] = [];

	for (const system of systems) {
		if (system === 'elo') {
			const carryover = await loadEloCarryover(sportCode, seasonId, teamSeasons);
			const seeds = buildEloSeeds(teamSeasonIds, carryover);
			const collapsed = collapseByDay(computeElo(games, seeds));
			await rebuildSystem(teamSeasonIds, 'elo', collapsed);
			results.push({
				system: 'elo',
				gamesProcessed: games.length,
				teamsRated: new Set(collapsed.map((r) => r.teamSeasonId)).size,
				rowsWritten: collapsed.length
			});
		}
		if (system === 'rpi') {
			const rows = computeRpi(games);
			await rebuildSystem(teamSeasonIds, 'rpi', rows);
			results.push({
				system: 'rpi',
				gamesProcessed: games.length,
				teamsRated: rows.length,
				rowsWritten: rows.length
			});
		}
		if (system === 'power') {
			const rows = computePower(games);
			await rebuildSystem(teamSeasonIds, 'power', rows);
			results.push({
				system: 'power',
				gamesProcessed: games.length,
				teamsRated: rows.length,
				rowsWritten: rows.length
			});
		}
	}

	return { sportCode, division, seasonId, results };
}
