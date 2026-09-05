// stream-scrape — fetch each school's schedule and archive it verbatim.
//
// Fetch and archive ONLY: no parsing, no writes to game tables. The archive in
// the private `schedule-raw` bucket is the point — when a parser bug turns up,
// stream-ingest re-runs against Storage instead of hitting 374 schools again.
//
// Bounded per invocation (?limit=, ?after=): an edge function has a wall clock,
// and roster_scrape_log puts the real cost at ~2.3s per source, so a full
// 578-source sweep is ~22 minutes and must be walked across invocations.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const USER_AGENT = 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)';
const BUCKET = 'schedule-raw';

const FETCH_TIMEOUT_MS = 15_000;
/**
 * A source is due when it has never been scraped, or was last attempted more
 * than this ago. Cron fires repeatedly inside one hour; once the queue is
 * drained the remaining firings match nothing and return immediately.
 */
const STALE_HOURS_MS = 20 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 40;
const DEFAULT_CONCURRENCY = 6;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
	try {
		return await fetch(url, {
			...init,
			signal: ctrl.signal,
			headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) }
		});
	} finally {
		clearTimeout(t);
	}
}

interface Target {
	id: number;
	team_id: number;
	sport_code: string;
	domain: string | null;
	platform: string;
	sidearm_schedule_id: string | null;
	schedule_path: string | null;
	season_year: number;
}

/** `{sport}/{year}/{teamId}.{json|html}` */
export function archivePath(sportCode: string, seasonYear: number, teamId: number, ext: string) {
	return `${sportCode}/${seasonYear}/${teamId}.${ext}`;
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
			.select('id, team_id, sport_code, domain, platform, sidearm_schedule_id, schedule_path, schedule_status, status, seasons!inner(start_date), teams!inner(ncaa_team_id)')
			.eq('status', 'verified')
			.eq('schedule_status', 'verified')
			.gt('id', opts.after)
			.order(opts.queue ? 'last_scraped_at' : 'id', {
				ascending: true,
				nullsFirst: true // never-scraped sources go first
			})
			.range(from, from + PAGE - 1);
		// ?mode=queue: only sources actually due, so surplus cron firings no-op.
		if (opts.queue) q = q.or(`last_scraped_at.is.null,last_scraped_at.lt.${opts.staleBefore}`);
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
				domain: r.domain as string | null,
				platform: r.platform as string,
				sidearm_schedule_id: r.sidearm_schedule_id as string | null,
				schedule_path: r.schedule_path as string | null,
				season_year: new Date(`${season.start_date}T00:00:00Z`).getUTCFullYear()
			});
			if (out.length >= opts.limit) return out;
		}
		if (rows.length < PAGE) break;
	}
	return out;
}

/** Run `fn` over items with a bounded worker pool. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(n, items.length) }, async () => {
			while (i < items.length) {
				const k = i++;
				out[k] = await fn(items[k]);
			}
		})
	);
	return out;
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
	const concurrency = Number(url.searchParams.get('concurrency') ?? DEFAULT_CONCURRENCY);
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
		return json({ ran: true, scraped: 0, reason: 'No matching sources', nextAfter: null, results: [] });
	}

	const startedAt = Date.now();
	const logs: Record<string, unknown>[] = [];

	const results = await pool(targets, concurrency, async (t) => {
		const t0 = Date.now();
		try {
			if (!t.domain) throw new Error('source missing domain');

			let body: string, ext: string, httpStatus: number;
			if (t.platform === 'sidearm') {
				if (!t.sidearm_schedule_id) throw new Error('no sidearm_schedule_id — run schedule-discovery');
				const res = await fetchWithTimeout(
					`https://${t.domain}/api/v2/Schedule/${t.sidearm_schedule_id}`,
					{ headers: { Accept: 'application/json' } }
				);
				httpStatus = res.status;
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				body = await res.text();
				ext = 'json';
			} else {
				if (!t.schedule_path) throw new Error('no schedule_path — run schedule-discovery');
				const res = await fetchWithTimeout(`https://${t.domain}${t.schedule_path}`);
				httpStatus = res.status;
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				body = await res.text();
				ext = 'html';
			}
			if (!body.length) throw new Error('empty response body');

			const path = archivePath(t.sport_code, t.season_year, t.team_id, ext);
			const { error: upErr } = await supabase.storage
				.from(BUCKET)
				.upload(path, body, {
					contentType: ext === 'json' ? 'application/json' : 'text/html',
					upsert: true
				});
			if (upErr) throw new Error(`storage upload: ${upErr.message}`);

			logs.push({
				roster_source_id: t.id,
				phase: 'scrape',
				status: 'success',
				http_status: httpStatus,
				duration_ms: Date.now() - t0
			});
			return { source: t.id, domain: t.domain, sport: t.sport_code, status: 'ok', bytes: body.length, path };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			logs.push({
				roster_source_id: t.id,
				phase: 'scrape',
				status: 'error',
				error_message: message,
				duration_ms: Date.now() - t0
			});
			return { source: t.id, domain: t.domain, sport: t.sport_code, status: 'error', error: message };
		}
	});

	if (logs.length) await supabase.from('stream_scrape_log').insert(logs);

	// Stamp every source we ATTEMPTED, successful or not. Stamping only on
	// success would let one permanently broken site sit at the head of the
	// queue and be retried by every firing, starving everything behind it.
	if (targets.length) {
		await supabase
			.from('roster_sources')
			.update({ last_scraped_at: new Date().toISOString() })
			.in('id', targets.map((t) => t.id));
	}

	const ok = results.filter((r) => r.status === 'ok').length;
	// nextAfter lets the caller walk the whole season across invocations.
	// The id cursor only means something when targets are id-ordered. In queue
	// mode they are ordered by staleness, so there is no position to resume
	// from — the next firing simply takes whatever is stalest then.
	const nextAfter =
		!opts.queue && targets.length === opts.limit ? targets[targets.length - 1].id : null;
	return json({
		ran: true,
		attempted: targets.length,
		scraped: ok,
		failed: targets.length - ok,
		nextAfter,
		duration_ms: Date.now() - startedAt,
		results
	});
});
