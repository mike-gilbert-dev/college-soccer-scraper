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
//
// Modes:
//   default    — recently-final games + season gap-fill, as above.
//   ?mode=live — in-progress games only. Self-gates on whether any game this
//                season currently has status='live' (set by nightly-ingest's
//                own live poll, so it's already trustworthy by the time this
//                runs); zero matches means no NCAA calls at all. One box-score
//                call per live game — much pricier per-poll than the bulk score
//                fetch — so this is meant to run on a coarser cron (e.g. every
//                10 min, not every minute) and skips the Storage archive and
//                reconciliation_log the way nightly-ingest's live mode skips
//                its own archive/scrape_log. The overnight run still produces
//                the canonical archive + log once games go final.

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

const POSITION_MAP: Record<string, string> = {
	GOALKEEPER: 'GK',
	FORWARD: 'FWD',
	MIDFIELDER: 'MID',
	DEFENDER: 'DEF'
};
/**
 * NCAA's box score feed usually reports position as a short code (GK/FWD/MID/DEF)
 * but occasionally spells it out (GOALKEEPER/FORWARD/...) for the same game type.
 * Map the full word to the short code so GK detection and display both see one
 * consistent value; anything else passes through unchanged.
 */
function normalizePosition(position: string | null | undefined): string | null {
	if (!position) return position ?? null;
	return POSITION_MAP[position.toUpperCase()] ?? position;
}

const NCAA_HEADERS = {
	Accept: 'application/json',
	'User-Agent': 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)'
};
const MAX_RETRIES = 3;
function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
/** Parse `Retry-After` (seconds or HTTP-date) into a delay in ms, or null if absent/unparseable. */
function retryAfterMs(res: Response): number | null {
	const header = res.headers.get('Retry-After');
	if (!header) return null;
	const seconds = Number(header);
	if (!Number.isNaN(seconds)) return seconds * 1000;
	const date = Date.parse(header);
	return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
/**
 * NCAA publishes no rate limit or robots.txt for this API, so a 429 (or a
 * transient 5xx) is the only real signal we have. Honor `Retry-After` when the
 * response includes one; otherwise back off exponentially (1s, 2s, 4s) with jitter.
 */
async function fetchWithRetry(url: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: NCAA_HEADERS });
		const retryable = res.status === 429 || [502, 503, 504].includes(res.status);
		if (!retryable || attempt >= MAX_RETRIES) return res;
		const delay = retryAfterMs(res) ?? 2 ** attempt * 1000 + Math.random() * 250;
		await sleep(delay);
	}
}

async function fetchBoxScore(contestId: string): Promise<{ raw: unknown; boxScore: BoxScore | null }> {
	const url = new URL(GQL_HOST);
	url.searchParams.set('meta', 'NCAA_GetGamecenterBoxscoreSoccerById_web');
	url.searchParams.set(
		'extensions',
		JSON.stringify({ persistedQuery: { version: 1, sha256Hash: BOX_SCORE_HASH } })
	);
	url.searchParams.set('variables', JSON.stringify({ contestId, staticTestEnv: null }));
	const res = await fetchWithRetry(url.toString());
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
	const isLive = url.searchParams.get('mode') === 'live';
	const forcedDate = url.searchParams.get('date'); // reconcile exactly this date's finals
	const recentDays = Math.max(0, parseInt(url.searchParams.get('recentDays') ?? '2', 10) || 0);
	const cap = Math.max(1, parseInt(url.searchParams.get('cap') ?? '200', 10) || 200);
	const concurrencyDefault = isLive ? 4 : 8;
	const concurrency =
		Math.max(1, parseInt(url.searchParams.get('concurrency') ?? String(concurrencyDefault), 10) || concurrencyDefault);
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

	// Live mode self-gate: nightly-ingest's own live poll (every minute) already
	// keeps `status` current, so a straight status='live' count is a trustworthy,
	// free-to-check signal — no NCAA call happens unless something is actually
	// in progress right now.
	if (isLive) {
		const { count, error: gateErr } = await supabase
			.from('games')
			.select('id', { count: 'exact', head: true })
			.eq('season_id', season.id)
			.eq('status', 'live');
		if (gateErr) {
			return json({ ran: false, mode: 'live', reason: `gate query failed: ${gateErr.message}` }, 500);
		}
		if (!count) {
			return json({ ran: false, mode: 'live', reason: 'no live games', anchor });
		}
	}

	const recentCutoff =
		forcedDate ?? isoDay(new Date(new Date(`${today}T00:00:00Z`).getTime() - recentDays * 86400000));

	const summary = {
		ran: true,
		mode: isLive ? 'live' : 'default',
		season: season.label,
		anchor,
		targets: [] as unknown[]
	};

	for (const { sportCode, division } of targets) {
		const t0 = Date.now();
		const out: Record<string, unknown> = { sportCode, division };
		const errors: { contestId: string; message: string }[] = [];
		try {
			const missingBefore = isLive ? null : await countMissingFinals(supabase, sportCode, division, season.id);

			// ── Select box-score targets ───────────────────────────────
			let targetRows: Target[];
			if (isLive) {
				const { data, error } = await supabase
					.from('games')
					.select('id, ncaa_contest_id, contest_date, home_team_season_id, away_team_season_id')
					.eq('season_id', season.id)
					.eq('sport_code', sportCode)
					.eq('division', division)
					.eq('status', 'live')
					.limit(cap);
				if (error) throw new Error(`select live games: ${error.message}`);
				targetRows = (data ?? []).map((g) => ({ ...g, game_id: g.id })) as Target[];
			} else if (forcedDate) {
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
				targetRows = (data ?? []).map((g) => ({ ...g, game_id: g.id })) as Target[];
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
			// Live mode skips the Storage archive — the overnight run still writes
			// the canonical copy once a game goes final.
			const fetched = await pool(targetRows, concurrency, async (t) => {
				try {
					const { raw, boxScore } = await fetchBoxScore(t.ncaa_contest_id);
					if (!isLive) {
						await supabase.storage
							.from(BUCKET)
							.upload(
								boxScorePath(sportCode, division, season.year, t.ncaa_contest_id),
								JSON.stringify(raw, null, 2),
								{ contentType: 'application/json', upsert: true }
							);
					}
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

					const gks = detail.playerStats.filter((p) => p.participated && normalizePosition(p.position) === 'GK');
					const soleGkName = gks.length === 1 ? `${gks[0].firstName} ${gks[0].lastName}` : null;
					const gk = detail.teamStats.goalie;

					for (const p of detail.playerStats) {
						if (!p.participated) continue;
						const ncaaPlayerId = syntheticPlayerId(detail.teamId, p.firstName, p.lastName);
						const fullName = `${p.firstName} ${p.lastName}`;
						const position = normalizePosition(p.position);
						playerRows.set(ncaaPlayerId, { ncaa_player_id: ncaaPlayerId, name: fullName });
						psRows.set(`${ncaaPlayerId}|${teamSeasonId}`, {
							ncaa_player_id: ncaaPlayerId,
							team_season_id: teamSeasonId,
							jersey_number: p.number,
							position
						});
						const isSoleGk = position === 'GK' && fullName === soleGkName;
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

			// Both the RPC's RETURN QUERY and a plain .upsert().select() are regular
			// PostgREST responses, capped at 1000 rows (silently truncated) like any
			// other read -- see CLAUDE.md. A single reconcile batch can span thousands
			// of unique players across many games, so both round-trips below MUST be
			// chunked well under that cap or the tail of the batch silently loses its
			// id mapping and never reaches player_seasons / player_game_stats.
			const ROW_CAP_CHUNK = 500;
			function chunk<T>(items: T[], size: number): T[][] {
				const out: T[][] = [];
				for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
				return out;
			}

			// Phase A: players -- insert new only; never overwrite an existing name,
			// so externally-normalized name formatting is preserved.
			const playerIdByNcaa = new Map<string, number>();
			for (const batch of chunk([...playerRows.values()], ROW_CAP_CHUNK)) {
				const { data, error } = await supabase.rpc('get_or_create_players', {
					p_players: batch
				});
				if (error) throw new Error(`get_or_create_players: ${error.message}`);
				for (const p of (data ?? []) as { id: number; ncaa_player_id: string }[]) {
					playerIdByNcaa.set(p.ncaa_player_id, p.id);
				}
			}

			// Phase B: player_seasons
			const psIdByKey = new Map<string, number>();
			const psRowsResolved = [...psRows.values()]
				.map((r) => ({
					player_id: playerIdByNcaa.get(r.ncaa_player_id),
					team_season_id: r.team_season_id,
					jersey_number: r.jersey_number,
					position: r.position
				}))
				.filter((r): r is typeof r & { player_id: number } => typeof r.player_id === 'number');
			for (const batch of chunk(psRowsResolved, ROW_CAP_CHUNK)) {
				const { data, error } = await supabase
					.from('player_seasons')
					.upsert(batch, { onConflict: 'player_id,team_season_id' })
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

			const missingAfter = isLive ? null : await countMissingFinals(supabase, sportCode, division, season.id);
			const durationMs = Date.now() - t0;
			const capped = targetRows.length >= cap;

			// Live mode skips the log write too — "finals missing stats" isn't a
			// meaningful concept mid-game, and this runs too often to accumulate rows.
			if (!isLive) await supabase.from('reconciliation_log').insert({
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
