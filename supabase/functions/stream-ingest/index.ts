// stream-ingest — read the archive, parse, match, upsert. No external fetches.
//
// Reads what stream-scrape put in the `schedule-raw` bucket, parses it with the
// platform's parser, matches each event to a row in `games` via
// (team_season_id, contest_date), and upserts game_streams. Events that do not
// match are queued, never dropped, and NOTHING here creates a game — the NCAA
// feed owns which games exist.
//
// The only writes to `games` are broadcaster_name, taken from the schedule's own
// carrier field THROUGH the carrier map, so the scoreboard doesn't end up
// showing "BTN" and "Big Ten Network" as different networks.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseSidearmSchedule } from '../_shared/schedule.ts';
import { parseSidearmHtmlSchedule, parseWmtSchedule } from '../_shared/schedule-html.ts';
import { matchScheduleEvents, type CandidateGame } from '../_shared/schedule-match.ts';
import { carrierLabel } from '../_shared/carriers.ts';
import type { ParsedScheduleEvent } from '../_shared/schedule.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'schedule-raw';
const DEFAULT_LIMIT = 60;
/**
 * A source is due when it has never been ingested, or was last attempted more
 * than this ago. Ingest is sequential at ~730ms/source, so all 566 take about
 * 7 minutes — past an edge function's wall clock. Cron therefore fires this
 * repeatedly and each firing claims the stalest slice; surplus firings find
 * nothing due and return immediately.
 */
const STALE_HOURS_MS = 20 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Target {
	id: number;
	team_id: number;
	sport_code: string;
	season_id: number;
	domain: string | null;
	platform: string;
	season_year: number;
}

/**
 * The season a schedule page actually describes.
 *
 * Sidearm's /api/v2/Sports exposes only the CURRENT scheduleId, and every
 * platform's default schedule URL serves the current/upcoming season — the same
 * trap the roster pipeline hit ('the live default roster is the upcoming
 * season'). Pointing a past-season source at it yields events whose dates match
 * nothing, so all three functions scope to one season unless ?season= says
 * otherwise. Off-season falls back to the most recent season, which is what the
 * sites serve anyway.
 */
async function resolveSeasonId(supabase: SupabaseClient, override: string | null): Promise<number | null> {
	if (override) return Number(override);
	const today = new Date().toISOString().slice(0, 10);
	const { data: current } = await supabase
		.from('seasons')
		.select('id')
		.lte('start_date', today)
		.gte('end_date', today)
		.maybeSingle();
	if (current) return current.id as number;
	const { data: latest } = await supabase
		.from('seasons')
		.select('id')
		.order('start_date', { ascending: false })
		.limit(1)
		.maybeSingle();
	return (latest?.id as number) ?? null;
}

/** PAGINATED — see the 1000-row note in schedule-discovery. */
async function resolveTargets(
	supabase: SupabaseClient,
	opts: {
		source?: string | null;
		team?: string | null;
		limit: number;
		after: number;
		queue: boolean;
		staleBefore: string;
		seasonId: number | null;
	}
): Promise<Target[]> {
	const out: Target[] = [];
	const PAGE = 500;
	for (let from = 0; ; from += PAGE) {
		let q = supabase
			.from('roster_sources')
			.select('id, team_id, sport_code, season_id, domain, platform, status, schedule_status, seasons!inner(start_date), teams!inner(ncaa_team_id)')
			.eq('status', 'verified')
			.eq('schedule_status', 'verified')
			.gt('id', opts.after)
			.order(opts.queue ? 'last_ingested_at' : 'id', {
				ascending: true,
				nullsFirst: true // never-ingested sources go first
			})
			.range(from, from + PAGE - 1);
		// ?mode=queue: only sources actually due, so surplus cron firings no-op.
		if (opts.queue) q = q.or(`last_ingested_at.is.null,last_ingested_at.lt.${opts.staleBefore}`);
		if (opts.seasonId) q = q.eq('season_id', opts.seasonId);
		if (opts.source) q = q.eq('id', Number(opts.source));
		if (opts.team) q = q.eq('teams.ncaa_team_id', opts.team);

		const { data, error } = await q;
		if (error) throw new Error(`resolveTargets: ${error.message}`);
		const rows = (data ?? []) as Record<string, unknown>[];
		for (const r of rows) {
			const seasons = r.seasons as { start_date: string } | { start_date: string }[];
			const season = Array.isArray(seasons) ? seasons[0] : seasons;
			out.push({
				id: r.id as number,
				team_id: r.team_id as number,
				sport_code: r.sport_code as string,
				season_id: r.season_id as number,
				domain: r.domain as string | null,
				platform: r.platform as string,
				season_year: new Date(`${season.start_date}T00:00:00Z`).getUTCFullYear()
			});
			if (out.length >= opts.limit) return out;
		}
		if (rows.length < PAGE) break;
	}
	return out;
}

/**
 * Every game this team-season plays, with the OTHER side's names for the
 * opponent confirmer. Paginated: a season is ~5,000 games league-wide, and
 * although one team plays ~20, the cap is cheap insurance.
 */
async function loadCandidateGames(
	supabase: SupabaseClient,
	t: Target
): Promise<{ games: CandidateGame[]; teamSeasonId: number | null }> {
	const { data: ts, error: tsErr } = await supabase
		.from('team_seasons')
		.select('id')
		.eq('team_id', t.team_id)
		.eq('season_id', t.season_id)
		.eq('sport_code', t.sport_code)
		.maybeSingle();
	if (tsErr) throw new Error(`team_seasons: ${tsErr.message}`);
	if (!ts) return { games: [], teamSeasonId: null };
	const teamSeasonId = ts.id as number;

	const { data, error } = await supabase
		.from('games')
		.select(`
			id, contest_date, home_team_season_id, away_team_season_id,
			home_team_season:team_seasons!home_team_season_id(team:teams(name, short_name)),
			away_team_season:team_seasons!away_team_season_id(team:teams(name, short_name))
		`)
		.eq('season_id', t.season_id)
		.eq('sport_code', t.sport_code)
		.or(`home_team_season_id.eq.${teamSeasonId},away_team_season_id.eq.${teamSeasonId}`)
		.order('contest_date', { ascending: true })
		.range(0, 999);
	if (error) throw new Error(`games: ${error.message}`);

	const games: CandidateGame[] = (data ?? []).map((g: Record<string, unknown>) => {
		const isHome = g.home_team_season_id === teamSeasonId;
		const other = (isHome ? g.away_team_season : g.home_team_season) as
			| { team: { name: string; short_name: string } | { name: string; short_name: string }[] }
			| null;
		const teamObj = other?.team;
		const team = Array.isArray(teamObj) ? teamObj[0] : teamObj;
		return {
			id: g.id as number,
			contestDate: String(g.contest_date),
			opponentNames: [team?.name, team?.short_name].filter(Boolean) as string[],
			side: isHome ? 'home' : 'away'
		};
	});
	return { games, teamSeasonId };
}

function parseArchive(
	platform: string,
	body: string,
	domain: string,
	seasonYear: number
): ParsedScheduleEvent[] {
	if (platform === 'sidearm') return parseSidearmSchedule(JSON.parse(body), domain);
	if (platform === 'wmt') return parseWmtSchedule(body, domain, seasonYear);
	return parseSidearmHtmlSchedule(body, domain, seasonYear);
}

Deno.serve(async (req) => {
	if (req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) {
		return json({ error: 'Unauthorized' }, 401);
	}
	const url = new URL(req.url);
	const opts = {
		source: url.searchParams.get('source'),
		team: url.searchParams.get('team'),
		limit: Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT),
		after: Number(url.searchParams.get('after') ?? 0),
		queue: url.searchParams.get('mode') === 'queue',
		staleBefore: new Date(Date.now() - STALE_HOURS_MS).toISOString()
	};
	const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

	// Scope to one season: a schedule page always describes the current one.
	const seasonId = await resolveSeasonId(supabase, url.searchParams.get('season'));

	let targets: Target[];
	try {
		targets = await resolveTargets(supabase, { ...opts, seasonId });
	} catch (e) {
		return json({ ran: false, error: e instanceof Error ? e.message : String(e) }, 500);
	}
	if (!targets.length) {
		return json({ ran: true, ingested: 0, reason: 'No matching sources', nextAfter: null, results: [] });
	}

	const startedAt = Date.now();
	const logs: Record<string, unknown>[] = [];
	const results: unknown[] = [];

	// Sequential per source: each source writes to a distinct set of games, but
	// keeping writes serialized avoids piling connections onto the pool while
	// nightly-ingest-live is running every minute.
	for (const t of targets) {
		const t0 = Date.now();
		try {
			if (!t.domain) throw new Error('source missing domain');

			// Resolve the team-season FIRST. A source with none has no games for a
			// link to attach to, so there is nothing to do — and that is not a
			// fault. These are non-D1 schools that exist in `teams` only because
			// they appear as opponents in the D1 feed; the first full sweep found
			// 35 of them. Logging those as errors would put 35 standing red
			// herrings in the table a run is judged by, so they are `skipped`.
			// Checking before the archive download also saves the Storage read.
			const { games, teamSeasonId } = await loadCandidateGames(supabase, t);
			if (!teamSeasonId) {
				logs.push({
					roster_source_id: t.id,
					phase: 'ingest',
					status: 'skipped',
					error_message: 'no team_season for this source (no games to attach links to)',
					duration_ms: Date.now() - t0
				});
				results.push({ source: t.id, domain: t.domain, sport: t.sport_code, status: 'skipped' });
				continue;
			}

			const ext = t.platform === 'sidearm' ? 'json' : 'html';
			const path = `${t.sport_code}/${t.season_year}/${t.team_id}.${ext}`;

			const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
			if (dlErr || !blob) throw new Error(`no archive at ${path} — run stream-scrape`);
			const body = await blob.text();

			const events = parseArchive(t.platform, body, t.domain, t.season_year);
			const matches = matchScheduleEvents(events, games);

			const streamRows: Record<string, unknown>[] = [];
			const queueRows: Record<string, unknown>[] = [];
			const broadcasters = new Map<number, string>();

			for (const m of matches) {
				if (m.status === 'matched' && m.gameId != null) {
					for (const link of m.event.links) {
						// Skip a carrier-only row that resolved to nothing usable.
						if (!link.url && !link.carrier) continue;
						streamRows.push({
							game_id: m.gameId,
							kind: link.kind,
							url: link.url,
							label: link.label,
							carrier: link.carrier,
							access: link.access,
							is_deep_link: link.isDeepLink,
							source_side: m.sourceSide,
							roster_source_id: t.id,
							external_event_id: m.event.externalEventId,
							last_seen_at: new Date().toISOString()
						});
					}
					// broadcaster_name comes from the VIDEO link's already-resolved
					// carrier, not from the raw tv string: NC State (and others) ship
					// tv:"" and identify the carrier by tvImage alone, so keying off tv
					// filled nothing on the first live run. The map turns the carrier id
					// into one canonical label, so "BTN" and "Big Ten Network" agree.
					const videoLink = m.event.links.find((l) => l.kind === 'video');
					const label = carrierLabel(videoLink?.carrier);
					if (label) broadcasters.set(m.gameId, label);
				} else {
					const video = m.event.links.find((l) => l.kind === 'video');
					queueRows.push({
						roster_source_id: t.id,
						event_date: m.event.date,
						opponent_name: m.event.opponentName,
						location_side: m.event.locationSide,
						video_url: video?.url ?? null,
						carrier_raw: m.event.carrierRaw,
						external_event_id: m.event.externalEventId,
						match_status: m.status,
						suggested_game_id: m.suggestedGameId,
						suggestion_reason: m.reason
					});
				}
			}

			// Postgres refuses an ON CONFLICT batch that touches the same row
			// twice ("cannot affect row a second time"), and a schedule can
			// legitimately point two events at one game (a doubleheader resolved
			// to the same fixture, or a duplicated link). Dedupe on the same key
			// the index uses before sending.
			const byKey = new Map<string, Record<string, unknown>>();
			for (const r of streamRows) {
				byKey.set(`${r.game_id}|${r.kind}|${r.url ?? r.carrier}`, r);
			}
			const deduped = [...byKey.values()];

			let upserted = 0;
			if (deduped.length) {
				const { error } = await supabase
					.from('game_streams')
					.upsert(deduped, { onConflict: 'game_id,kind,link_key', ignoreDuplicates: false });
				if (error) throw new Error(`game_streams upsert: ${error.message}`);
				upserted = deduped.length;
			}
			const qByKey = new Map();
			for (const r of queueRows) qByKey.set(`${r.roster_source_id}|${r.event_date}|${r.opponent_name}`, r);
			const dedupedQueue = [...qByKey.values()];
			if (dedupedQueue.length) {
				// Same dedupe reason, plus: a source re-scraped nightly re-queues the same
				// unmatched events, and the queue is for humans, not a change log.
				await supabase
					.from('stream_entry_queue')
					.upsert(dedupedQueue, { onConflict: 'roster_source_id,event_date,opponent_name', ignoreDuplicates: true });
			}
			for (const [gameId, name] of broadcasters) {
				await supabase.from('games').update({ broadcaster_name: name }).eq('id', gameId);
			}

			const matched = matches.filter((m) => m.status === 'matched').length;
			logs.push({
				roster_source_id: t.id,
				phase: 'ingest',
				status: 'success',
				events_seen: events.length,
				matched,
				links_upserted: upserted,
				queued: dedupedQueue.length,
				duration_ms: Date.now() - t0
			});
			results.push({
				source: t.id,
				domain: t.domain,
				sport: t.sport_code,
				status: 'ok',
				events: events.length,
				matched,
				links: upserted,
				queued: dedupedQueue.length
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			logs.push({
				roster_source_id: t.id,
				phase: 'ingest',
				status: 'error',
				error_message: message,
				duration_ms: Date.now() - t0
			});
			results.push({ source: t.id, domain: t.domain, status: 'error', error: message });
		}
	}

	if (logs.length) await supabase.from('stream_scrape_log').insert(logs);

	// Stamp every source we ATTEMPTED — success, skip or error alike. Stamping
	// only on success would park a permanently failing source at the head of
	// the queue, where every firing would retry it and starve the rest.
	if (targets.length) {
		await supabase
			.from('roster_sources')
			.update({ last_ingested_at: new Date().toISOString() })
			.in('id', targets.map((t) => t.id));
	}

	const statusOf = (r: unknown) => (r as { status: string }).status;
	const ok = results.filter((r) => statusOf(r) === 'ok').length;
	const skipped = results.filter((r) => statusOf(r) === 'skipped').length;
	// The id cursor only means something when targets are id-ordered. In queue
	// mode they are ordered by staleness, so there is no position to resume
	// from — the next firing simply takes whatever is stalest then.
	const nextAfter =
		!opts.queue && targets.length === opts.limit ? targets[targets.length - 1].id : null;
	return json({
		ran: true,
		attempted: targets.length,
		ingested: ok,
		// Sources with no team-season: nothing to do, not a fault. Counted apart
		// from `failed` so a clean run reads as clean.
		skipped,
		failed: targets.length - ok - skipped,
		nextAfter,
		duration_ms: Date.now() - startedAt,
		results
	});
});
