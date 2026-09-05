// schedule-discovery — resolve each source's SCHEDULE address, once per season.
//
// The direct analogue of roster-discovery. For NextGen sites the address is a
// numeric scheduleId from /api/v2/Sports; for the two HTML platforms it is a
// path, and the slug varies per site the same way the roster slug does (Penn
// State serves /sports/mens-soccer/schedule and 404s on /sports/msoc/schedule,
// Virginia is the reverse), so we probe the variants.
//
// Writes roster_sources.sidearm_schedule_id / schedule_path / schedule_status.
// On-demand; no cron.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseSidearmHtmlSchedule, parseWmtSchedule } from '../_shared/schedule-html.ts';
import { parseSidearmSchedule, type ParsedScheduleEvent } from '../_shared/schedule.ts';

/**
 * An event is USABLE only if the matcher could act on it: it needs a date (the
 * match key) and an opponent (the confirmer). Counting raw rows instead is how
 * Clemson passed discovery with "16 events" and then matched zero games — its
 * rows parsed, but every date came back null. A broken parser must fail here,
 * loudly, not masquerade downstream as a school that publishes no streams.
 */
const usableEvents = (events: ParsedScheduleEvent[]): number =>
	events.filter((e) => e.date && e.opponentName).length;

/** Minimum usable events for a source to count as verified. */
const MIN_USABLE = 5;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const USER_AGENT = 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)';

// Every external fetch is bounded. The roster pipeline has no AbortControllers
// at all, which is why its log shows a 61.8s worst case for a single source —
// a remote site hanging with nothing to cut it off.
const FETCH_TIMEOUT_MS = 15_000;
// Bounded slice per invocation: an edge function has a wall clock, and at the
// measured ~2.3s per source a full 578-source sweep would take ~22 minutes.
const DEFAULT_LIMIT = 40;

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
	season_year: number;
}

/** Sport slug candidates, most likely first. */
function slugs(sportCode: string): string[] {
	return sportCode === 'MSO'
		? ['mens-soccer', 'msoc', 'msoccer']
		: ['womens-soccer', 'wsoc', 'wsoccer'];
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

/**
 * PAGINATED. roster-scrape's resolveTargets does an unpaginated select on
 * status='verified' and there are 1,157 such rows against PostgREST's 1000-row
 * cap, so it silently skips ~157 sources. Do not repeat that here.
 */
async function resolveTargets(
	supabase: SupabaseClient,
	opts: { source?: string | null; team?: string | null; limit: number; force: boolean; seasonId: number | null }
): Promise<Target[]> {
	const out: Target[] = [];
	const PAGE = 500;
	for (let from = 0; ; from += PAGE) {
		let q = supabase
			.from('roster_sources')
			.select('id, team_id, sport_code, domain, platform, status, schedule_status, seasons!inner(start_date), teams!inner(ncaa_team_id)')
			.eq('status', 'verified')
			.order('id', { ascending: true })
			.range(from, from + PAGE - 1);
		if (opts.seasonId) q = q.eq('season_id', opts.seasonId);
		if (opts.source) q = q.eq('id', Number(opts.source));
		if (opts.team) q = q.eq('teams.ncaa_team_id', opts.team);
		if (!opts.force && !opts.source && !opts.team) q = q.eq('schedule_status', 'unverified');

		const { data, error } = await q;
		if (error) throw new Error(`resolveTargets: ${error.message}`);
		const rows = data ?? [];
		for (const r of rows as Record<string, unknown>[]) {
			const seasons = r.seasons as { start_date: string } | { start_date: string }[];
			const season = Array.isArray(seasons) ? seasons[0] : seasons;
			out.push({
				id: r.id as number,
				team_id: r.team_id as number,
				sport_code: r.sport_code as string,
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

/** NextGen: /api/v2/Sports carries a scheduleId per sport. */
async function discoverSidearm(domain: string, sportCode: string) {
	const res = await fetchWithTimeout(`https://${domain}/api/v2/Sports`, {
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`/api/v2/Sports HTTP ${res.status}`);
	const sports = await res.json();
	if (!Array.isArray(sports)) throw new Error('/api/v2/Sports not an array');
	// The \b matters: /men'?s soccer/ also matches "Women's Soccer" as a
	// SUBSTRING, so a site listing women first would silently hand MSO the
	// women's schedule. There is no word boundary between the "o" and "m"
	// of "Women's", so \bmen rejects it while still matching "Men's Soccer".
	// (Syracuse also lists a bare "Soccer" entry whose scheduleId is null.)
	const want = sportCode === 'MSO' ? /\bmen'?s soccer/i : /\bwomen'?s soccer/i;
	const soccer = sports.filter(
		(s: Record<string, unknown>) => typeof s.title === 'string' && /soccer/i.test(s.title)
	) as Record<string, unknown>[];

	// Prefer the gendered entry. The Citadel labels its only soccer programme
	// just "Soccer", so fall back to a bare entry — but ONLY when it is the sole
	// programme with a scheduleId AND its title names no gender. Without that
	// second condition a women's-only school would hand its schedule to an MSO
	// source, which is the same silent sport-swap the \b in `want` prevents.
	const isGendered = (title: string) => /\b(?:wo)?men'?s\b/i.test(title);
	const withId = soccer.filter((s) => s.scheduleId != null);
	const hit =
		withId.find((s) => want.test(s.title as string)) ??
		(withId.length === 1 && !isGendered(withId[0].title as string) ? withId[0] : undefined);
	if (!hit) throw new Error(`no ${sportCode} entry in /api/v2/Sports (saw: ${soccer.map((s) => s.title).join(", ") || "no soccer"})`);
	const scheduleId = hit.scheduleId;

	// Verify it actually returns games before marking it verified.
	const sres = await fetchWithTimeout(`https://${domain}/api/v2/Schedule/${scheduleId}`, {
		headers: { Accept: 'application/json' }
	});
	if (!sres.ok) throw new Error(`/api/v2/Schedule/${scheduleId} HTTP ${sres.status}`);
	const sched = await sres.json();
	const rows = Array.isArray(sched?.games) ? sched.games.length : 0;
	if (rows === 0) throw new Error(`schedule ${scheduleId} has 0 games`);
	const usable = usableEvents(parseSidearmSchedule(sched, domain));
	if (usable < MIN_USABLE) {
		throw new Error(`schedule ${scheduleId}: ${rows} rows but only ${usable} usable (date + opponent)`);
	}
	return { sidearm_schedule_id: String(scheduleId), schedule_path: null, events: usable, httpStatus: sres.status };
}

/** HTML platforms: probe slug variants, keep whichever parses to events. */
async function discoverHtml(domain: string, sportCode: string, platform: string, seasonYear: number) {
	let lastStatus = 0;
	let best: { path: string; rows: number; usable: number; httpStatus: number } | null = null;

	for (const slug of slugs(sportCode)) {
		const path = `/sports/${slug}/schedule`;
		const res = await fetchWithTimeout(`https://${domain}${path}`);
		lastStatus = res.status;
		if (!res.ok) continue;
		const html = await res.text();
		const parsed =
			platform === 'wmt'
				? parseWmtSchedule(html, domain, seasonYear)
				: parseSidearmHtmlSchedule(html, domain, seasonYear);
		const usable = usableEvents(parsed);
		if (usable >= MIN_USABLE) {
			return { sidearm_schedule_id: null, schedule_path: path, events: usable, httpStatus: res.status };
		}
		if (!best || usable > best.usable) {
			best = { path, rows: parsed.length, usable, httpStatus: res.status };
		}
	}
	// Distinguish "found nothing" from "found rows we could not read" — the
	// second is a parser gap and needs to say so, not fail as an unreachable page.
	if (best && best.rows > 0) {
		throw new Error(
			`${best.rows} rows at ${best.path} but only ${best.usable} usable (date + opponent) — parser gap`
		);
	}
	throw new Error(`no parseable schedule page (last HTTP ${lastStatus})`);
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
		force: url.searchParams.get('force') === 'true'
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
	if (!targets.length) return json({ ran: true, resolved: 0, reason: 'No matching sources', results: [] });

	const startedAt = Date.now();
	const results: unknown[] = [];
	const logs: Record<string, unknown>[] = [];

	for (const t of targets) {
		const t0 = Date.now();
		try {
			if (!t.domain) throw new Error('source missing domain');
			// DETECT the platform rather than trusting roster_sources.platform.
			// Those labels were set by the roster project and have drifted as
			// schools migrated to NextGen: gopack, Cal, Syracuse, Chattanooga,
			// Samford, Liberty and The Citadel were all still labelled
			// sidearm-html or wmt while serving the JSON API. Hand-correcting
			// rows does not stop the drift; detecting does.
			let found;
			let detected = t.platform;
			try {
				found = await discoverSidearm(t.domain, t.sport_code);
				detected = 'sidearm';
			} catch (apiErr) {
				try {
					found = await discoverHtml(t.domain, t.sport_code, t.platform, t.season_year);
				} catch (htmlErr) {
					// Report whichever path got furthest rather than only the last.
					const a = apiErr instanceof Error ? apiErr.message : String(apiErr);
					const b = htmlErr instanceof Error ? htmlErr.message : String(htmlErr);
					throw new Error(`API: ${a} | HTML: ${b}`);
				}
			}

			const { error } = await supabase
				.from('roster_sources')
				.update({
					sidearm_schedule_id: found.sidearm_schedule_id,
					schedule_path: found.schedule_path,
					platform: detected,
					schedule_status: 'verified',
					schedule_verified_at: new Date().toISOString()
				})
				.eq('id', t.id);
			if (error) throw new Error(`update: ${error.message}`);

			results.push({
				source: t.id, domain: t.domain, sport: t.sport_code, status: 'verified',
				events: found.events,
				...(detected !== t.platform ? { platformWas: t.platform, platformNow: detected } : {})
			});
			logs.push({
				roster_source_id: t.id,
				phase: 'discovery',
				status: 'success',
				http_status: found.httpStatus,
				events_seen: found.events,
				duration_ms: Date.now() - t0
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			await supabase
				.from('roster_sources')
				.update({ schedule_status: 'failed', schedule_verified_at: new Date().toISOString() })
				.eq('id', t.id);
			results.push({ source: t.id, domain: t.domain, sport: t.sport_code, status: 'failed', error: message });
			logs.push({
				roster_source_id: t.id,
				phase: 'discovery',
				status: 'error',
				error_message: message,
				duration_ms: Date.now() - t0
			});
		}
	}

	if (logs.length) await supabase.from('stream_scrape_log').insert(logs);

	const verified = results.filter((r) => (r as { status: string }).status === 'verified').length;
	// A 200 here does not mean every source succeeded — per-source errors are
	// caught above. Judge a run by stream_scrape_log.
	return json({
		ran: true,
		attempted: targets.length,
		verified,
		failed: targets.length - verified,
		duration_ms: Date.now() - startedAt,
		results
	});
});
