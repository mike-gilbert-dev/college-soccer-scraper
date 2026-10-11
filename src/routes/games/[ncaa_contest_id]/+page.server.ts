import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { isBetterStream, type StreamLink } from '$lib/streams';
import type { PickOutcome, PickResult } from '$lib/picks';

export type PlayerStat = {
	id: number;
	player_season_id: number;
	starter: boolean;
	minutes_played: number | null;
	goals: number;
	assists: number;
	shots: number;
	shots_on_goal: number;
	fouls_committed: number;
	yellow_cards: number;
	red_cards: number;
	gk_saves: number | null;
	gk_goals_against: number | null;
	gk_shutout: boolean | null;
	jersey_number: number | null;
	position: string | null;
	class_year: string | null;
	headshot_path: string | null;
	team_season_id: number;
	ncaa_player_id: string;
	player_name: string;
};

/** A team's season-to-date picture, from its side of the matchup. */
export type MatchupSide = {
	record: { w: number; l: number; t: number };
	confRecord: { w: number; l: number; t: number } | null;
	/** Last five counted finals, oldest first (most recent on the right). */
	form: { result: 'W' | 'L' | 'T'; contestId: string; opponent: string; score: string }[];
	elo: { value: number; rank: number } | null;
	rpiRank: number | null;
	powerRank: number | null;
	seed: number | null;
};

type SeasonGame = {
	ncaa_contest_id: string;
	contest_date: string;
	start_time: string | null;
	home_team_season_id: number;
	away_team_season_id: number;
	home_score: number;
	away_score: number;
	home_team_season: { division_member: boolean; conference_id: number | null; team: { name: string } | null } | null;
	away_team_season: { division_member: boolean; conference_id: number | null; team: { name: string } | null } | null;
};

/**
 * Record, conference record and form for one team. Only games against fellow
 * division members count, mirroring get_standings and the team page — the
 * per-division NCAA feed includes non-D1 opponents.
 */
function summarize(teamSeasonId: number, conferenceId: number | null, games: SeasonGame[]) {
	const record = { w: 0, l: 0, t: 0 };
	const confRecord = { w: 0, l: 0, t: 0 };
	const counted: { g: SeasonGame; result: 'W' | 'L' | 'T'; opp: SeasonGame['home_team_season'] }[] = [];

	for (const g of games) {
		const home = g.home_team_season_id === teamSeasonId;
		if (!home && g.away_team_season_id !== teamSeasonId) continue;
		const opp = home ? g.away_team_season : g.home_team_season;
		if (opp?.division_member === false) continue;

		const mine = home ? g.home_score : g.away_score;
		const theirs = home ? g.away_score : g.home_score;
		const result = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
		const key = result === 'W' ? 'w' : result === 'L' ? 'l' : 't';
		record[key]++;
		if (conferenceId != null && opp?.conference_id === conferenceId) confRecord[key]++;
		counted.push({ g, result, opp });
	}

	const form = counted.slice(-5).map(({ g, result, opp }) => {
		const home = g.home_team_season_id === teamSeasonId;
		return {
			result,
			contestId: g.ncaa_contest_id,
			opponent: `${home ? 'vs' : '@'} ${opp?.team?.name || 'Opponent'}`,
			score: home ? `${g.home_score}–${g.away_score}` : `${g.away_score}–${g.home_score}`
		};
	});

	return { record, confRecord: conferenceId != null ? confRecord : null, form };
}

export const load: PageServerLoad = async ({ params, url, depends, locals }) => {
	// Live games patch `game` (score/status/period) via a direct realtime match
	// on `games`, same as /scores. `player_game_stats` rows need player/team
	// joins the realtime payload doesn't carry, so those re-run this load
	// instead — see the `boxscore:stats` invalidate call in +page.svelte.
	depends('boxscore:stats');

	const sport      = url.searchParams.get('sport')    ?? 'MSO';
	const division   = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonLabel = url.searchParams.get('season') ?? '';
	const fromTeam   = url.searchParams.get('from') ?? null;

	const { data: game } = await supabaseAdmin
		.from('games')
		.select(`
			id,
			ncaa_contest_id,
			contest_date,
			home_score,
			away_score,
			shootout,
			shootout_winner_team_season_id,
			status,
			current_period,
			start_time,
			season_id,
			sport_code,
			division,
			round_description,
			home_seed,
			away_seed,
			broadcaster_name,
			home_team_season_id,
			away_team_season_id,
			home_team_season:team_seasons!home_team_season_id(
				conference_id,
				team:teams(ncaa_team_id, name, logo_url_dark, logo_url_light, team_color)
			),
			away_team_season:team_seasons!away_team_season_id(
				conference_id,
				team:teams(ncaa_team_id, name, logo_url_dark, logo_url_light, team_color)
			)
		`)
		.eq('ncaa_contest_id', params.ncaa_contest_id)
		.single();

	if (!game) error(404, 'Game not found');

	const { data: rawStats } = await supabaseAdmin
		.from('player_game_stats')
		.select(`
			id,
			player_season_id,
			starter,
			minutes_played,
			goals,
			assists,
			shots,
			shots_on_goal,
			fouls_committed,
			yellow_cards,
			red_cards,
			gk_saves,
			gk_goals_against,
			gk_shutout,
			player_season:player_seasons(
				jersey_number,
				position,
				class_year,
				headshot_path,
				team_season_id,
				player:players(ncaa_player_id, name)
			)
		`)
		.eq('game_id', game.id);

	const allStats: PlayerStat[] = (rawStats ?? []).map(s => {
		const ps = s.player_season as unknown as {
			jersey_number: number | null;
			position: string | null;
			class_year: string | null;
			headshot_path: string | null;
			team_season_id: number;
			player: { ncaa_player_id: string; name: string };
		};
		return {
			id: s.id,
			player_season_id: s.player_season_id,
			starter: s.starter ?? false,
			minutes_played: s.minutes_played,
			goals: s.goals ?? 0,
			assists: s.assists ?? 0,
			shots: s.shots ?? 0,
			shots_on_goal: s.shots_on_goal ?? 0,
			fouls_committed: s.fouls_committed ?? 0,
			yellow_cards: s.yellow_cards ?? 0,
			red_cards: s.red_cards ?? 0,
			gk_saves: s.gk_saves,
			gk_goals_against: s.gk_goals_against,
			gk_shutout: s.gk_shutout,
			jersey_number: ps.jersey_number,
			position: ps.position,
			class_year: ps.class_year,
			headshot_path: ps.headshot_path,
			team_season_id: ps.team_season_id,
			ncaa_player_id: ps.player.ncaa_player_id,
			player_name: ps.player.name,
		};
	});

	const homeStats = allStats.filter(s => s.team_season_id === game.home_team_season_id);
	const awayStats = allStats.filter(s => s.team_season_id === game.away_team_season_id);

	type GameTeam = { ncaa_team_id: string; name: string; logo_url_dark: string | null; logo_url_light: string | null; team_color: string | null };
	type GameTeamSeason = { conference_id: number | null; team: GameTeam } | null;
	const homeTs = game.home_team_season as unknown as GameTeamSeason;
	const awayTs = game.away_team_season as unknown as GameTeamSeason;
	const homeTeam = homeTs?.team ?? null;
	const awayTeam = awayTs?.team ?? null;

	// ── Matchup preview ───────────────────────────────────────────────────
	// Everything below is season context for both sides plus the user's pick
	// and where to watch. All of it is independent, so it runs in parallel.
	//
	// Skipped once the game is final: the page doesn't show the preview then, and
	// today's ratings/records would misdescribe a game already played. (The pick
	// query still runs — a final game shows how the user's pick graded.)
	const { user } = await locals.safeGetSession();
	const preview = game.status !== 'final';
	const ratingArgs = { p_season_id: game.season_id, p_sport_code: game.sport_code, p_division: game.division };
	const teamIds = `${game.home_team_season_id},${game.away_team_season_id}`;
	const empty = Promise.resolve({ data: null, error: null });

	const [eloRes, rpiRes, powerRes, seasonGamesRes, linksRes, pickRes] = await Promise.all([
		preview ? supabaseAdmin.rpc('get_current_ratings', { ...ratingArgs, p_system: 'elo' }) : empty,
		preview ? supabaseAdmin.rpc('get_current_ratings', { ...ratingArgs, p_system: 'rpi' }) : empty,
		preview ? supabaseAdmin.rpc('get_current_ratings', { ...ratingArgs, p_system: 'power' }) : empty,
		// Both teams' finals this season — ~40 rows at most.
		!preview ? empty : supabaseAdmin
			.from('games')
			.select(`
				ncaa_contest_id,
				contest_date,
				start_time,
				home_team_season_id,
				away_team_season_id,
				home_score,
				away_score,
				home_team_season:team_seasons!home_team_season_id(division_member, conference_id, team:teams(name)),
				away_team_season:team_seasons!away_team_season_id(division_member, conference_id, team:teams(name))
			`)
			.eq('season_id', game.season_id)
			.eq('sport_code', game.sport_code)
			.eq('division', game.division)
			.eq('status', 'final')
			.not('home_score', 'is', null)
			.not('away_score', 'is', null)
			.or(`home_team_season_id.in.(${teamIds}),away_team_season_id.in.(${teamIds})`)
			.order('contest_date', { ascending: true })
			.order('start_time', { ascending: true, nullsFirst: true }),
		!preview ? empty : supabaseAdmin
			.from('game_streams')
			.select('kind, url, carrier, access, label, is_deep_link, source_side')
			.eq('game_id', game.id),
		// The user's JWT client, not supabaseAdmin: RLS scopes picks to their owner.
		user
			? locals.supabase.from('picks').select('outcome, result').eq('game_id', game.id).eq('user_id', user.id).maybeSingle()
			: empty
	]);

	for (const [label, res] of [['elo', eloRes], ['rpi', rpiRes], ['power', powerRes], ['season games', seasonGamesRes], ['streams', linksRes], ['pick', pickRes]] as const) {
		if (res.error) console.error(`[game] ${label} query error:`, res.error);
	}

	type RatingRow = { ts_id: number; value: number; rank: number };
	const ratingFor = (rows: RatingRow[] | null, tsId: number) =>
		rows?.find((r) => Number(r.ts_id) === tsId) ?? null;

	const seasonGames = (seasonGamesRes.data ?? []) as unknown as SeasonGame[];
	function side(tsId: number, ts: GameTeamSeason, seed: number | null): MatchupSide {
		const elo = ratingFor(eloRes.data as RatingRow[] | null, tsId);
		return {
			...summarize(tsId, ts?.conference_id ?? null, seasonGames),
			elo: elo ? { value: Number(elo.value), rank: Number(elo.rank) } : null,
			rpiRank: ratingFor(rpiRes.data as RatingRow[] | null, tsId)?.rank ?? null,
			powerRank: ratingFor(powerRes.data as RatingRow[] | null, tsId)?.rank ?? null,
			seed
		};
	}

	// Best link per kind (watch / listen / live stats / tickets), same preference
	// order as /scores. Only links that land on THIS game are worth a button.
	const links: Partial<Record<'video' | 'audio' | 'stats' | 'tickets', StreamLink>> = {};
	for (const r of (linksRes.data ?? []) as (StreamLink & { kind: keyof typeof links })[]) {
		if (isBetterStream(r, links[r.kind])) links[r.kind] = r;
	}

	return {
		game: {
			id: game.id,
			ncaa_contest_id: game.ncaa_contest_id,
			contest_date: game.contest_date,
			home_score: game.home_score,
			away_score: game.away_score,
			shootout: game.shootout ?? false,
			home_advanced: game.shootout
				? game.shootout_winner_team_season_id === game.home_team_season_id
				: null,
			away_advanced: game.shootout
				? game.shootout_winner_team_season_id === game.away_team_season_id
				: null,
			status: game.status,
			current_period: game.current_period as string | null,
			start_time: game.start_time as string | null,
			sport_code: game.sport_code as string,
			round_description: game.round_description as string | null,
			broadcaster_name: game.broadcaster_name as string | null,
		},
		homeTeam,
		awayTeam,
		matchup: preview
			? {
				home: side(game.home_team_season_id, homeTs, game.home_seed),
				away: side(game.away_team_season_id, awayTs, game.away_seed),
				// get_current_ratings covers division members only; rank is out of this.
				fieldSize: (eloRes.data as RatingRow[] | null)?.length ?? 0
			}
			: null,
		links,
		userPick: (pickRes.data ?? null) as { outcome: PickOutcome; result: PickResult | null } | null,
		signedIn: !!user,
		homeStats,
		awayStats,
		fromTeam,
		sport,
		division,
		seasonLabel,
	};
};
