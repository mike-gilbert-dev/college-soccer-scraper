// Supabase Edge Function: roster-discovery
//
// Resolves + verifies the Sidearm roster id for roster_sources rows that already
// have a domain (populated by the bootstrap import). For each target it calls the
// Sidearm list endpoint (https://{domain}/api/v2/Rosters/list?sport={slug}),
// picks the entry whose season title matches the internal season's year, then
// verifies by fetching that roster and checking it returns a sane player count.
// Sets status = 'verified' | 'failed' and platform accordingly. Non-Sidearm /
// dead domains fail (the fallback list). Trusted-domain identity is assumed from
// the curated URL source; verification guards against dead/empty/non-soccer sites.
//
// Targeting: ?source=<id> | ?team=<ncaa_team_id> | default = all not-yet-verified.
// Knobs: ?limit=<n> (cap per run, default 20), ?concurrency=<n> (default 5),
//        ?force=true (re-verify already-verified rows too).
// Auth: Bearer <service role key>. verify_jwt off; self-checks.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const USER_AGENT = 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)';
const SPORT_SLUG: Record<string, string> = { MSO: 'msoc', WSO: 'wsoc' };
const SPORT_URL_SLUG: Record<string, string> = { MSO: 'mens-soccer', WSO: 'womens-soccer' };
const MIN_PLAYERS = 12;
const MAX_PLAYERS = 60;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
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

// deno-lint-ignore no-explicit-any
function listItemId(it: any): string | null {
	const v = it?.id ?? it?.rosterId ?? it?.rosterID ?? null;
	return v === null || v === undefined ? null : String(v);
}
// deno-lint-ignore no-explicit-any
function listItemTitle(it: any): string {
	const s = it?.season;
	const v = it?.seasonTitle ?? it?.title ?? (s && (s.title ?? s.shortName)) ?? s ?? '';
	return String(v);
}

interface Target { id: number; team_id: number; sport_code: string; domain: string | null; season_year: number; }

async function resolveTargets(
	supabase: SupabaseClient,
	opts: { source?: string | null; team?: string | null; force: boolean; limit: number }
): Promise<Target[]> {
	let q = supabase
		.from('roster_sources')
		.select('id, team_id, sport_code, domain, status, seasons!inner(start_date), teams!inner(ncaa_team_id)')
		.not('domain', 'is', null)
		.limit(opts.limit);
	if (opts.source) q = q.eq('id', Number(opts.source));
	else if (opts.team) q = q.eq('teams.ncaa_team_id', opts.team);
	else if (!opts.force) q = q.eq('status', 'unverified');
	const { data, error } = await q;
	if (error) throw new Error(`resolveTargets: ${error.message}`);
	// deno-lint-ignore no-explicit-any
	return (data ?? []).map((r: any) => {
		const season = Array.isArray(r.seasons) ? r.seasons[0] : r.seasons;
		return {
			id: r.id,
			team_id: r.team_id,
			sport_code: r.sport_code,
			domain: r.domain,
			season_year: new Date(`${season.start_date}T00:00:00Z`).getUTCFullYear()
		};
	});
}

type Disc = { roster_id: string | null; status: string; platform: string; note: string };

// NextGen JSON path: resolve roster id via the list endpoint + verify by player count.
// Returns a verified result, or null if this site has no usable JSON roster API.
async function tryJson(t: Target): Promise<Disc | null> {
	const slug = SPORT_SLUG[t.sport_code] ?? 'msoc';
	let listRes: Response;
	try {
		listRes = await fetch(`https://${t.domain}/api/v2/Rosters/list?sport=${slug}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
	} catch { return null; }
	if (!listRes.ok) return null;
	let list: unknown;
	try { list = await listRes.json(); } catch { return null; }
	const arr = Array.isArray(list) ? list : (list as { items?: unknown[] })?.items;
	if (!Array.isArray(arr)) return null;
	const match = arr.find((it) => listItemTitle(it) === String(t.season_year));
	const rosterId = match ? listItemId(match) : null;
	if (!rosterId) return null;
	let r: Response;
	try { r = await fetch(`https://${t.domain}/api/v2/Rosters/${rosterId}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } }); } catch { return null; }
	if (!r.ok) return null;
	let roster: { players?: { firstName?: string; lastName?: string; hide?: boolean }[] };
	try { roster = await r.json(); } catch { return null; }
	const n = (roster.players ?? []).filter((p) => p?.hide !== true && ((p.firstName ?? '').trim() || (p.lastName ?? '').trim())).length;
	if (n < MIN_PLAYERS || n > MAX_PLAYERS) return null;
	return { roster_id: rosterId, status: 'verified', platform: 'sidearm', note: `${n} players (json)` };
}

// Old-Sidearm HTML path: the roster renders as .sidearm-roster-player cards whose
// player profile links contain ids. Count unique ids to verify a scrapeable roster.
async function tryHtml(t: Target): Promise<Disc> {
	const urlSlug = SPORT_URL_SLUG[t.sport_code] ?? 'mens-soccer';
	let res: Response;
	try {
		res = await fetch(`https://${t.domain}/sports/${urlSlug}/roster/${t.season_year}`, { headers: { 'User-Agent': USER_AGENT } });
	} catch (e) {
		return { roster_id: null, status: 'failed', platform: 'unknown', note: `no JSON API; page fetch error: ${e instanceof Error ? e.message : String(e)}` };
	}
	if (!res.ok) return { roster_id: null, status: 'failed', platform: 'unknown', note: `no JSON API; page HTTP ${res.status}` };
	const html = await res.text();
	const ids = new Set([...html.matchAll(/\/roster\/[^/"']+\/(\d+)/g)].map((m) => m[1]));
	const sidearm = /sidearmsports\.com|sidearm\.nextgen\.sites/.test(html);
	if (ids.size >= MIN_PLAYERS) {
		return { roster_id: null, status: 'verified', platform: 'sidearm-html', note: `${ids.size} players (html)` };
	}
	return { roster_id: null, status: 'failed', platform: sidearm ? 'sidearm' : 'unknown', note: `no JSON API; html had ${ids.size} roster links` };
}

async function discoverOne(t: Target): Promise<Disc> {
	const j = await tryJson(t);
	if (j) return j;
	return await tryHtml(t);
}

Deno.serve(async (req) => {
	if (req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) return json({ error: 'Unauthorized' }, 401);
	const url = new URL(req.url);
	const opts = {
		source: url.searchParams.get('source'),
		team: url.searchParams.get('team'),
		force: url.searchParams.get('force') === 'true',
		limit: Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
	};
	const concurrency = Math.max(1, parseInt(url.searchParams.get('concurrency') ?? '5', 10) || 5);
	const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

	let targets: Target[];
	try { targets = await resolveTargets(supabase, opts); }
	catch (e) { return json({ ran: false, error: e instanceof Error ? e.message : String(e) }, 500); }
	if (!targets.length) return json({ ran: true, processed: 0, reason: 'No targets (all verified or none with domains)', results: [] });

	const startedAt = Date.now();
	let verified = 0, failed = 0;
	const results = await pool(targets, concurrency, async (t) => {
		const d = await discoverOne(t);
		await supabase
			.from('roster_sources')
			.update({
				sidearm_roster_id: d.roster_id,
				platform: d.platform,
				status: d.status,
				last_verified_at: d.status === 'verified' ? new Date().toISOString() : null,
				notes: d.note
			})
			.eq('id', t.id);
		if (d.status === 'verified') verified++; else failed++;
		await new Promise((r) => setTimeout(r, 100));
		return { source_id: t.id, domain: t.domain, roster_id: d.roster_id, status: d.status, note: d.note };
	});

	return json({ ran: true, processed: targets.length, verified, failed, totalMs: Date.now() - startedAt, results });
});
