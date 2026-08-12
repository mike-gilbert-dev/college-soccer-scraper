// Supabase Edge Function: nightly-ingest
//
// Fetches NCAA contests for a rolling window, archives the raw JSON to Storage,
// and BATCH-upserts teams / conferences / team_seasons / games. This replaces the
// Vercel cron's per-game sequential writes (which blew past Vercel's 60s limit on
// big slates) with a handful of bulk upserts per date.
//
// Scope: scores-only (no box scores / player stats — those are pulled separately).
// Auth:  Bearer <service role key>. Invoked by pg_cron via pg_net (see migration).
// Trigger ratings recompute separately (Phase 2) — this function does not rate.
//
// Modes:
//   default     — rolling window: today + the previous ?days-1 (default 2 total, for
//                 score corrections) + the next ?ahead days (default 7, for schedule
//                 changes and newly-published slates). Or a single ?date=.
//   ?mode=live  — today only, for in-game score updates. Self-gates on whether any
//                 game is in (or near) its play window, and skips the Storage archive
//                 + per-run success logging so it's cheap to run every minute.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BUCKET = 'ncaa-raw-games';
const GQL_HOST = 'https://sdataprod.ncaa.com';
const CONTESTS_HASH = '4bcb5e6432fa9da365c0c19af01b1f9015cc7eb5c21e7af2dba308784a166df7';

const DEFAULT_TARGETS: { sportCode: string; division: number }[] = [
	{ sportCode: 'MSO', division: 1 },
	{ sportCode: 'WSO', division: 1 }
];

// ── NCAA response shapes (subset we use) ────────────────────────────
interface ContestTeam {
	isHome: boolean;
	seoname: string;
	nameShort: string;
	name6Char: string;
	score: number;
	isWinner: boolean;
	conferenceSeo: string;
}
interface Contest {
	contestId: number;
	startTimeEpoch: number;
	hasStartTime?: boolean;
	tba?: boolean;
	statusCodeDisplay: string;
	currentPeriod?: string | null;
	finalMessage?: string | null;
	isChampionship?: boolean;
	broadcasterName?: string | null;
	roundDescription?: string | null;
	teams: ContestTeam[];
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

/** YYYY-MM-DD → MM/DD/YYYY for the NCAA API. */
function toNcaaDate(iso: string): string {
	const [y, m, d] = iso.split('-');
	return `${m}/${d}/${y}`;
}

/** YYYY-MM-DD → 'MSO/1/2025/12-15.json' (matches src/lib/server/ncaa-archive.ts). */
function archivePath(sportCode: string, division: number, year: number, iso: string): string {
	const [, mm, dd] = iso.split('-');
	return `${sportCode}/${division}/${year}/${mm}-${dd}.json`;
}

function normalizeStatus(s: string): string {
	switch (s?.toLowerCase()) {
		case 'final':
			return 'final';
		case 'live':
			return 'live';
		case 'postponed':
			return 'postponed';
		case 'cancelled':
			return 'cancelled';
		default:
			return 'scheduled';
	}
}

/**
 * Whether the feed actually knows this game's kickoff.
 *
 * A TBD game still ships a *placeholder* `startTimeEpoch` — almost always
 * midnight or 01:00 ET — so the timestamp alone can't be trusted. Only the
 * `hasStartTime` / `tba` flags separate it from a genuine late kickoff:
 * Hawaii's 7:00 PM local IS 1:00 AM ET, and those contests carry the exact
 * same `startTime: "01:00"` as the placeholder ones. Filtering on the clock
 * instead of the flags would blank every Hawaii / Alaska / late-Pacific game.
 *
 * Written as `!== false` / `!== true` so a feed that stops sending the fields
 * keeps the old behaviour instead of silently nulling every real kickoff.
 */
function hasKnownStartTime(c: Contest): boolean {
	return !!c.startTimeEpoch && c.hasStartTime !== false && c.tba !== true;
}

function dedupeBy<T>(rows: T[], key: (r: T) => string | number): T[] {
	const seen = new Map<string | number, T>();
	for (const r of rows) seen.set(key(r), r);
	return [...seen.values()];
}

async function fetchContests(
	sportCode: string,
	division: number,
	seasonYear: number,
	ncaaDate: string
): Promise<{ raw: unknown; contests: Contest[] }> {
	const url = new URL(GQL_HOST);
	url.searchParams.set('meta', 'GetContests_web');
	url.searchParams.set(
		'extensions',
		JSON.stringify({ persistedQuery: { version: 1, sha256Hash: CONTESTS_HASH } })
	);
	url.searchParams.set('queryName', 'GetContests_web');
	url.searchParams.set(
		'variables',
		JSON.stringify({ sportCode, division, seasonYear, contestDate: ncaaDate, week: null })
	);

	const res = await fetch(url.toString(), {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)'
		}
	});
	if (!res.ok) throw new Error(`NCAA API responded ${res.status}`);
	const raw = await res.json();
	const contests = (raw as { data?: { contests?: Contest[] } })?.data?.contests ?? [];
	return { raw, contests };
}

/** Bulk-upsert one date's contests: conferences → teams → team_seasons → games. */
async function ingestDate(
	supabase: SupabaseClient,
	sportCode: string,
	division: number,
	season: { id: number; year: number },
	contestDate: string,
	contests: Contest[]
): Promise<{ contests: number; teams: number; games: number }> {
	const allTeams = contests.flatMap((c) => c.teams);

	// 1. Conferences → map ncaa_conference_id → id
	const confMap = new Map<string, number>();
	const confRows = dedupeBy(
		allTeams
			.filter((t) => t.conferenceSeo)
			.map((t) => ({
				ncaa_conference_id: t.conferenceSeo,
				season_id: season.id,
				name: t.conferenceSeo,
				short_name: t.conferenceSeo,
				division
			})),
		(r) => r.ncaa_conference_id
	);
	if (confRows.length) {
		const { data, error } = await supabase
			.from('conferences')
			.upsert(confRows, { onConflict: 'ncaa_conference_id,season_id' })
			.select('id, ncaa_conference_id');
		if (error) throw new Error(`conferences upsert: ${error.message}`);
		for (const c of data ?? []) confMap.set(c.ncaa_conference_id, c.id);
	}

	// 2. Teams → map ncaa_team_id → id (leaves team_color / logos untouched)
	const teamRows = dedupeBy(
		allTeams.map((t) => ({
			ncaa_team_id: t.seoname,
			name: t.nameShort,
			short_name: t.name6Char || t.nameShort
		})),
		(r) => r.ncaa_team_id
	);
	const teamMap = new Map<string, number>();
	if (teamRows.length) {
		const { data, error } = await supabase
			.from('teams')
			.upsert(teamRows, { onConflict: 'ncaa_team_id' })
			.select('id, ncaa_team_id');
		if (error) throw new Error(`teams upsert: ${error.message}`);
		for (const t of data ?? []) teamMap.set(t.ncaa_team_id, t.id);
	}

	// 3. Team seasons → map team_id → team_season_id
	const tsRows = dedupeBy(
		allTeams
			.map((t) => ({
				team_id: teamMap.get(t.seoname),
				season_id: season.id,
				division,
				conference_id: t.conferenceSeo ? (confMap.get(t.conferenceSeo) ?? null) : null,
				sport_code: sportCode
			}))
			.filter((r): r is typeof r & { team_id: number } => typeof r.team_id === 'number'),
		(r) => r.team_id
	);
	const tsMap = new Map<number, number>();
	if (tsRows.length) {
		const { data, error } = await supabase
			.from('team_seasons')
			.upsert(tsRows, { onConflict: 'team_id,season_id,sport_code' })
			.select('id, team_id');
		if (error) throw new Error(`team_seasons upsert: ${error.message}`);
		for (const ts of data ?? []) tsMap.set(ts.team_id, ts.id);
	}

	// 4. Games
	const nowIso = new Date().toISOString();
	const gameRows = [];
	for (const c of contests) {
		const home = c.teams.find((t) => t.isHome);
		const away = c.teams.find((t) => !t.isHome);
		if (!home || !away) continue;
		const homeTs = tsMap.get(teamMap.get(home.seoname) ?? -1);
		const awayTs = tsMap.get(teamMap.get(away.seoname) ?? -1);
		if (!homeTs || !awayTs) continue;
		// Penalty-kick shootout: tied regulation/OT score but the feed still flags the
		// advancing team via isWinner. Stays a tie in records/ratings; we only record
		// who advanced. The feed occasionally sets a spurious isWinner on regular-season
		// draws, so trust it only with a FINAL/PK marker or a championship-bracket game.
		const pkMarked = /PK/i.test(c.currentPeriod ?? '') || /PK/i.test(c.finalMessage ?? '');
		const shootout =
			home.score === away.score &&
			home.isWinner !== away.isWinner &&
			(pkMarked || c.isChampionship === true);
		gameRows.push({
			ncaa_contest_id: String(c.contestId),
			season_id: season.id,
			contest_date: contestDate,
			start_time: hasKnownStartTime(c) ? new Date(c.startTimeEpoch * 1000).toISOString() : null,
			home_team_season_id: homeTs,
			away_team_season_id: awayTs,
			home_score: home.score,
			away_score: away.score,
			shootout,
			shootout_winner_team_season_id: shootout ? (home.isWinner ? homeTs : awayTs) : null,
			status: normalizeStatus(c.statusCodeDisplay),
			neutral_site: false,
			sport_code: sportCode,
			division,
			broadcaster_name: c.broadcasterName ?? null,
			round_description: c.roundDescription ?? null,
			last_fetched_at: nowIso
		});
	}
	let games = 0;
	if (gameRows.length) {
		const { data, error } = await supabase
			.from('games')
			.upsert(gameRows, { onConflict: 'ncaa_contest_id' })
			.select('id');
		if (error) throw new Error(`games upsert: ${error.message}`);
		games = data?.length ?? 0;
	}

	return { contests: contests.length, teams: teamRows.length, games };
}

Deno.serve(async (req) => {
	// ── Auth: shared secret = service role key (function deployed with verify_jwt off) ──
	if (req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const url = new URL(req.url);
	const isLive = url.searchParams.get('mode') === 'live';
	const days = Math.max(1, parseInt(url.searchParams.get('days') ?? '2', 10) || 2);
	// Days of lookahead. `?ahead=0` disables it; garbage falls back to the default.
	const aheadRaw = parseInt(url.searchParams.get('ahead') ?? '7', 10);
	const ahead = Number.isFinite(aheadRaw) ? Math.max(0, aheadRaw) : 7;
	const forcedDate = url.searchParams.get('date'); // YYYY-MM-DD (ignored in live mode)
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

	// Live mode self-gate: only hit the NCAA API when a game is in (or near) its
	// play window. Keyed purely on start_time — never on a mutable column — so it
	// auto-wakes for any game (weeknight or 40-game Saturday) and auto-sleeps once
	// the slate is well over. A game qualifies if it kicked off up to 3h ago
	// (in-progress or just-finished, to catch score corrections) or starts within
	// the next 15m (imminent). No game-day babysitting and no calendar to maintain.
	if (isLive) {
		const nowMs = Date.now();
		const windowStart = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(); // kicked off ≤3h ago
		const windowEnd = new Date(nowMs + 15 * 60 * 1000).toISOString(); // starts ≤15m from now
		const { count, error: gateErr } = await supabase
			.from('games')
			.select('id', { count: 'exact', head: true })
			.eq('season_id', season.id)
			.gte('start_time', windowStart)
			.lte('start_time', windowEnd);
		if (gateErr) {
			return json({ ran: false, mode: 'live', reason: `gate query failed: ${gateErr.message}` }, 500);
		}
		if (!count) {
			return json({ ran: false, mode: 'live', reason: 'no games in play window', anchor });
		}
	}

	// Build date window, clamped to the season's start and end. Live mode is today-only.
	const dates: string[] = [];
	if (isLive) {
		dates.push(today);
	} else if (forcedDate) {
		dates.push(forcedDate);
	} else {
		const start = new Date(`${today}T00:00:00Z`);
		// Backwards: today + the previous `days - 1`, to pick up score corrections on
		// games that have already been played.
		for (let i = 0; i < days; i++) {
			const d = new Date(start);
			d.setUTCDate(d.getUTCDate() - i);
			const iso = isoDay(d);
			if (iso < season.start_date) break;
			dates.push(iso);
		}
		dates.reverse();
		// Forwards: the next `ahead` days. NCAA keeps editing the schedule after a date
		// first appears in the feed — kickoffs move, and whole slates get published days
		// later — so a backwards-only window is a one-shot read of each date at 08:00 UTC
		// on game day, and every later change stayed invisible until the date had already
		// been played. It's also what keeps *unplayed* games in the DB at all, which
		// pick'em and the team schedule pages depend on.
		for (let i = 1; i <= ahead; i++) {
			const d = new Date(start);
			d.setUTCDate(d.getUTCDate() + i);
			const iso = isoDay(d);
			if (season.end_date && iso > season.end_date) break;
			dates.push(iso);
		}
	}

	const startedAt = Date.now();
	const summary = {
		ran: true,
		mode: isLive ? 'live' : 'window',
		season: season.label,
		anchor,
		window: dates,
		targets: [] as unknown[]
	};

	for (const { sportCode, division } of targets) {
		const targetOut = { sportCode, division, dates: [] as unknown[], error: null as string | null };
		try {
			for (const contestDate of dates) {
				const t0 = Date.now();
				const { raw, contests } = await fetchContests(
					sportCode,
					division,
					season.year,
					toNcaaDate(contestDate)
				);

				// Archive raw JSON to Storage (source of truth for re-ingest).
				// Skipped in live mode: the per-minute intermediate states aren't worth
				// keeping — the nightly run captures the canonical end-of-day archive.
				if (!isLive) {
					await supabase.storage
						.from(BUCKET)
						.upload(
							archivePath(sportCode, division, season.year, contestDate),
							JSON.stringify(raw, null, 2),
							{ contentType: 'application/json', upsert: true }
						);
				}

				const r = await ingestDate(supabase, sportCode, division, season, contestDate, contests);

				// Skip per-run success logging in live mode (would add ~1 row/min).
				if (!isLive) {
					await supabase.from('scrape_log').insert({
						endpoint: 'GetContests_web',
						contest_date: contestDate,
						http_status: 200,
						status: 'success',
						games_upserted: r.games
					});
				}

				targetOut.dates.push({ date: contestDate, ...r, ms: Date.now() - t0 });
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			targetOut.error = msg;
			await supabase.from('scrape_log').insert({
				endpoint: 'GetContests_web',
				status: 'error',
				error_message: `${sportCode}/${division}: ${msg}`
			});
		}
		summary.targets.push(targetOut);
	}

	return json({ ...summary, totalMs: Date.now() - startedAt });
});
