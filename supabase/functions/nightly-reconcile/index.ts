// Supabase Edge Function: nightly-reconcile
//
// The accuracy / completeness pass that runs after nightly-ingest. For each
// target it (re)fetches box scores for recently-final games and any season
// finals still missing player stats, archives the raw JSON to Storage, and
// BATCH-upserts players / player_seasons / player_game_stats. Then it records a
// reconciliation_log row (incl. season-wide finals-missing-stats before/after).
//
// Storage stays the source of truth: every box score is written to the
// ncaa-raw-games bucket (boxscores/{contestId}.json) and stats are derived from
// that data, matching the admin "Ingest Archives" model.
//
// Scope is bounded: at most `cap` box scores per run (recent-first), so a large
// initial backfill self-heals over successive nights. Games themselves are owned
// by nightly-ingest; this function does not touch the games table (except to
// clear stale stats when a box score reports no data).
//
// Auth: Bearer <service role key>. Invoked by pg_cron via pg_net.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BUCKET = 'ncaa-raw-games';
const GQL_HOST = 'https://sdataprod.ncaa.com';
const BOX_SCORE_HASH = 'c9070c4e5a76468a4025896df89f8a7b22be8275c54a22ff79619cbb27d63d7d';

const DEFAULT_TARGETS: { sportCode: string; division: number }[] = [
	{ sportCode: 'MSO', division: 1 },
	{ sportCode: 'WSO', division: 1 }
];

// ── Box score shapes (subset) ───────────────────────────────────────
interface Penalties {
	fouls: string;
	greenCards: string;
	yellowCards: string;
	redCards: string;
}
interface PlayerStat {
	firstName: string;
	lastName: string;
	position: string;
	number: number;
	goals: string;
	assists: string;
	shots: string;
	shotsOnGoal: string;
	minutesPlayed: string;
	penaltyShotGoals: string;
	penaltyShotAttempts: string;
	starter: boolean;
	participated: boolean;
	penalties: Penalties;
}
interface TeamDetail {
	teamId: number;
	playerStats: PlayerStat[];
	teamStats: { goalie: { goalsAllowed: string; saves: string; shutouts: string } };
}
interface TeamIdentity {
	isHome: boolean;
	teamId: string;
	seoname: string;
	color: string;
}
interface BoxScore {
	teams: TeamIdentity[];
	teamBoxscore: TeamDetail[];
}

interface Target {
	game_id: number;
	ncaa_contest_id: string;
	contest_date: string;
	home_team_season_id: number;
	away_team_season_id: number;
}

// ── Helpers ─────────────────────────────────────────────────────────
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}
function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}
function boxScorePath(sportCode: string, division: number, year: number, contestId: string): string {
	return `${sportCode}/${division}/${year}/boxscores/${contestId}.json`;
}
function syntheticPlayerId(teamId: number | string, firstName: string, lastName: string): string {
	const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
	return `${teamId}_${norm(firstName)}_${norm(lastName)}`;
}
const num = (s: string) => parseInt(s || '0', 10) || 0;

async function fetchBoxScore(contestId: string): Promise<{ raw: unknown; boxScore: BoxScore | null }> {
	const url = new URL(GQL_HOST);
	url.searchParams.set('meta', 'NCAA_GetGamecenterBoxscoreSoccerById_web');
	url.searchParams.set(
		'extensions',
		JSON.stringify({ persistedQuery: { version: 1, sha256Hash: BOX_SCORE_HASH } })
	);
	url.searchParams.set('variables', JSON.stringify({ contestId, staticTestEnv: null }));
	const res = await fetch(url.toString(), {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)'
		}
	});
	if (!res.ok) throw new Error(`box score API ${res.status} for contestId=${contestId}`);
	const raw = await res.json();
	const boxScore = (raw as { data?: { boxscore?: BoxScore | null } })?.data?.boxscore ?? null;
	return { raw, boxScore };
}

/** Run `tasks` with bounded concurrency, collecting settled results in order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

async function countMissingFinals(
	supabase: SupabaseClient,
	sportCode: string,
	division: number,
	seasonId: number
): Promise<number> {
	const { data, error } = await supabase.rpc('get_games_missing_player_stats', {
		p_sport_code: sportCode,
		p_division: division,
		p_season_id: seasonId
	});
	if (error) throw new Error(`get_games_missing_player_stats: ${error.message}`);
	return (data ?? []).length;
}

Deno.serve(async (req) => {
	if (req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const url = new URL(req.url);
	const forcedDate = url.searchParams.get('date'); // reconcile exactly this date's finals
	const recentDays = Math.max(0, parseInt(url.searchParams.get('recentDays') ?? '2', 10) || 0);
	const cap = Math.max(1, parseInt(url.searchParams.get('cap') ?? '200', 10) || 200);
	const concurrency = Math.max(1, parseInt(url.searchParams.get('concurrency') ?? '8', 10) || 8);
	const sportParam = url.searchParams.get('sport');
	const divisionParam = url.searchParams.get('division');
	const targets =
		sportParam && divisionParam
			? [{ sportCode: sportParam, division: parseInt(divisionParam, 10) }]
			: DEFAULT_TARGETS;

	const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
	const today = isoDay(new Date());
	const anchor = forcedDate ?? today;

	const { data: season } = await supabase
		.from('seasons')
		.select('id, year, label, start_date, end_date')
		.lte('start_date', anchor)
		.gte('end_date', anchor)
		.order('start_date', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (!season) {
		return json({
			ran: false,
			reason: forcedDate ? `No season covers ${forcedDate}` : 'No active season covers today',
			anchor
		});
	}

	const recentCutoff =
		forcedDate ?? isoDay(new Date(new Date(`${today}T00:00:00Z`).getTime() - recentDays * 86400000));

	const summary = { ran: true, season: season.label, anchor, targets: [] as unknown[] };

	for (const { sportCode, division } of targets) {
		const t0 = Date.now();
		const out: Record<string, unknown> = { sportCode, division };
		const errors: { contestId: string; message: string }[] = [];
		try {
			const missingBefore = await countMissingFinals(supabase, sportCode, division, season.id);

			// ── Select box-score targets ───────────────────────────────
			let targetRows: Target[];
			if (forcedDate) {
				const { data, error } = await supabase
					.from('games')
					.select('id, ncaa_contest_id, contest_date, home_team_season_id, away_team_season_id')
					.eq('season_id', season.id)
					.eq('sport_code', sportCode)
					.eq('division', division)
					.eq('status', 'final')
					.eq('contest_date', forcedDate)
					.limit(cap);
				if (error) throw new Error(`select finals: ${error.message}`);
				targetRows = (data ?? []).map((g) => ({ ...g })) as Target[];
			} else {
				const { data, error } = await supabase.rpc('get_reconcile_targets', {
					p_sport_code: sportCode,
					p_division: division,
					p_season_id: season.id,
					p_recent_cutoff: recentCutoff,
					p_limit: cap
				});
				if (error) throw new Error(`get_reconcile_targets: ${error.message}`);
				targetRows = (data ?? []) as Target[];
			}

			// ── Fetch + archive box scores (bounded concurrency) ────────
			const fetched = await pool(targetRows, concurrency, async (t) => {
				try {
					const { raw, boxScore } = await fetchBoxScore(t.ncaa_contest_id);
					await supabase.storage
						.from(BUCKET)
						.upload(
							boxScorePath(sportCode, division, season.year, t.ncaa_contest_id),
							JSON.stringify(raw, null, 2),
							{ contentType: 'application/json', upsert: true }
						);
					return { t, boxScore };
				} catch (e) {
					errors.push({
						contestId: t.ncaa_contest_id,
						message: e instanceof Error ? e.message : String(e)
					});
					return null;
				}
			});

			// ── Build batched player-stat rows ─────────────────────────
			const playerRows = new Map<string, { ncaa_player_id: string; name: string }>();
			const psRows = new Map<
				string,
				{ ncaa_player_id: string; team_season_id: number; jersey_number: number; position: string | null }
			>();
			type StatRec = {
				ncaa_player_id: string;
				team_season_id: number;
				game_id: number;
				row: Record<string, unknown>;
			};
			const statRecs: StatRec[] = [];
			const clearGameIds: number[] = []; // box score reported but data.boxscore is null

			let boxscoresFetched = 0;
			for (const f of fetched) {
				if (!f) continue;
				boxscoresFetched++;
				const { t, boxScore } = f;
				if (!boxScore) {
					clearGameIds.push(t.game_id);
					continue;
				}
				for (const detail of boxScore.teamBoxscore) {
					const identity = boxScore.teams.find((x) => String(x.teamId) === String(detail.teamId));
					if (!identity) continue;
					const teamSeasonId = identity.isHome ? t.home_team_season_id : t.away_team_season_id;

					const gks = detail.playerStats.filter((p) => p.participated && p.position === 'GK');
					const soleGkName = gks.length === 1 ? `${gks[0].firstName} ${gks[0].lastName}` : null;
					const gk = detail.teamStats.goalie;

					for (const p of detail.playerStats) {
						if (!p.participated) continue;
						const ncaaPlayerId = syntheticPlayerId(detail.teamId, p.firstName, p.lastName);
						const fullName = `${p.firstName} ${p.lastName}`;
						playerRows.set(ncaaPlayerId, { ncaa_player_id: ncaaPlayerId, name: fullName });
						psRows.set(`${ncaaPlayerId}|${teamSeasonId}`, {
							ncaa_player_id: ncaaPlayerId,
							team_season_id: teamSeasonId,
							jersey_number: p.number,
							position: p.position ?? null
						});
						const isSoleGk = p.position === 'GK' && fullName === soleGkName;
						statRecs.push({
							ncaa_player_id: ncaaPlayerId,
							team_season_id: teamSeasonId,
							game_id: t.game_id,
							row: {
								game_id: t.game_id,
								starter: p.starter,
								minutes_played: num(p.minutesPlayed),
								goals: num(p.goals),
								assists: num(p.assists),
								shots: num(p.shots),
								shots_on_goal: num(p.shotsOnGoal),
								fouls_committed: num(p.penalties.fouls),
								yellow_cards: num(p.penalties.yellowCards),
								red_cards: num(p.penalties.redCards),
								green_cards: num(p.penalties.greenCards),
								penalty_shot_goals: num(p.penaltyShotGoals),
								penalty_shot_attempts: num(p.penaltyShotAttempts),
								gk_saves: isSoleGk ? num(gk.saves) : null,
								gk_goals_against: isSoleGk ? num(gk.goalsAllowed) : null,
								gk_shutout: isSoleGk ? num(gk.shutouts) > 0 : null
							}
						});
					}
				}
			}

			// Phase A: players — insert new only; never overwrite an existing name,
			// so externally-normalized name formatting is preserved.
			const playerIdByNcaa = new Map<string, number>();
			if (playerRows.size) {
				const { data, error } = await supabase.rpc('get_or_create_players', {
					p_players: [...playerRows.values()]
				});
				if (error) throw new Error(`get_or_create_players: ${error.message}`);
				for (const p of (data ?? []) as { id: number; ncaa_player_id: string }[]) {
					playerIdByNcaa.set(p.ncaa_player_id, p.id);
				}
			}

			// Phase B: player_seasons
			const psIdByKey = new Map<string, number>();
			if (psRows.size) {
				const rows = [...psRows.values()]
					.map((r) => ({
						player_id: playerIdByNcaa.get(r.ncaa_player_id),
						team_season_id: r.team_season_id,
						jersey_number: r.jersey_number,
						position: r.position
					}))
					.filter((r): r is typeof r & { player_id: number } => typeof r.player_id === 'number');
				const { data, error } = await supabase
					.from('player_seasons')
					.upsert(rows, { onConflict: 'player_id,team_season_id' })
					.select('id, player_id, team_season_id');
				if (error) throw new Error(`player_seasons upsert: ${error.message}`);
				for (const ps of data ?? []) psIdByKey.set(`${ps.player_id}|${ps.team_season_id}`, ps.id);
			}

			// Phase C: player_game_stats
			let statsUpserted = 0;
			const gamesWithStats = new Set<number>();
			if (statRecs.length) {
				const rows = [];
				for (const s of statRecs) {
					const playerId = playerIdByNcaa.get(s.ncaa_player_id);
					if (playerId === undefined) continue;
					const psId = psIdByKey.get(`${playerId}|${s.team_season_id}`);
					if (psId === undefined) continue;
					rows.push({ player_season_id: psId, ...s.row });
					gamesWithStats.add(s.game_id);
				}
				// chunk to stay well within statement limits
				const CHUNK = 1000;
				for (let i = 0; i < rows.length; i += CHUNK) {
					const { error } = await supabase
						.from('player_game_stats')
						.upsert(rows.slice(i, i + CHUNK), { onConflict: 'player_season_id,game_id' });
					if (error) throw new Error(`player_game_stats upsert: ${error.message}`);
				}
				statsUpserted = rows.length;
			}

			// Clear stale stats for games whose box score reported no data
			if (clearGameIds.length) {
				await supabase.from('player_game_stats').delete().in('game_id', clearGameIds);
			}

			const missingAfter = await countMissingFinals(supabase, sportCode, division, season.id);
			const durationMs = Date.now() - t0;
			const capped = targetRows.length >= cap;

			await supabase.from('reconciliation_log').insert({
				sport_code: sportCode,
				division,
				season_id: season.id,
				targets_considered: targetRows.length,
				boxscores_fetched: boxscoresFetched,
				games_with_stats: gamesWithStats.size,
				stats_upserted: statsUpserted,
				finals_missing_before: missingBefore,
				finals_missing_after: missingAfter,
				capped,
				duration_ms: durationMs,
				errors
			});

			out.result = {
				targetsConsidered: targetRows.length,
				boxscoresFetched,
				gamesWithStats: gamesWithStats.size,
				statsUpserted,
				finalsMissingBefore: missingBefore,
				finalsMissingAfter: missingAfter,
				capped,
				errors: errors.length,
				durationMs
			};
		} catch (e) {
			out.error = e instanceof Error ? e.message : String(e);
		}
		summary.targets.push(out);
	}

	return json(summary);
});
