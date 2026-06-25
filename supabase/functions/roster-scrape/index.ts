// Supabase Edge Function: roster-scrape
//
// Step 1 of the roster pipeline (scrape -> ingest -> headshots). Archives the raw
// roster to the `sidearm-raw-rosters` bucket (source of truth) and logs. Branches
// by platform:
//   - sidearm       -> fetch /api/v2/Rosters/{id} JSON       -> archive .json
//   - sidearm-html  -> fetch /sports/{slug}/roster/{yr}      -> archive .html
//   - wmt           -> fetch /sports/{slug}/roster/season/{yr} (WMT Nuxt) -> archive .html
// No DB writes to player tables (that is roster-ingest).
//
// Targeting: ?source=<id> | ?team=<ncaa_team_id> | default = all verified.
// Auth: Bearer <service role key>. verify_jwt off; self-checks.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'sidearm-raw-rosters';
const USER_AGENT = 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)';
const SPORT_URL_SLUG: Record<string, string> = { MSO: 'mens-soccer', WSO: 'womens-soccer' };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function jsonPath(sportCode: string, y: number, teamId: number | string): string { return `${sportCode}/${y}/${teamId}.json`; }
function htmlPath(sportCode: string, y: number, teamId: number | string): string { return `${sportCode}/${y}/${teamId}.html`; }

interface RawPlayer { firstName?: string | null; lastName?: string | null; hide?: boolean | null; }
function visibleCount(raw: { players?: RawPlayer[] }): number {
	return (raw?.players ?? []).filter((p) => p?.hide !== true && ((p.firstName ?? '').trim() || (p.lastName ?? '').trim())).length;
}

// ── WMT (Nuxt SPA) helpers — count players from the __NUXT_DATA__ devalue graph.
// Full parser lives in roster-ingest / src/lib/server/wmt.ts; here we only count
// to pick the best candidate URL to archive.
function buildWmtRosterUrls(domain: string, sportPath: string, year: number): string[] {
	const slugs = sportPath === 'mens-soccer' ? ['mens-soccer', 'msoc'] : [sportPath, 'mens-soccer'];
	const urls: string[] = [];
	for (const s of slugs) urls.push(`https://${domain}/sports/${s}/roster/season/${year}`);
	for (const s of slugs) urls.push(`https://${domain}/sports/${s}/roster`);
	return urls;
}
function countWmtPlayers(html: string): number {
	const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
	if (!m) return 0;
	// deno-lint-ignore no-explicit-any
	let flat: any[];
	try { flat = JSON.parse(m[1]); } catch { return 0; }
	if (!Array.isArray(flat)) return 0;
	const cache = new Map<number, unknown>();
	// deno-lint-ignore no-explicit-any
	const R = (i: unknown): any => {
		if (typeof i !== 'number') return i;
		if (cache.has(i)) return cache.get(i);
		const v = flat[i];
		if (v === null || typeof v !== 'object') { cache.set(i, v); return v; }
		if (Array.isArray(v)) { const a: unknown[] = []; cache.set(i, a); for (const x of v) a.push(R(x)); return a; }
		const o: Record<string, unknown> = {}; cache.set(i, o);
		for (const k in v) o[k] = R((v as Record<string, unknown>)[k]);
		return o;
	};
	let n = 0;
	flat.forEach((v, i) => {
		if (!v || typeof v !== 'object' || Array.isArray(v)) return;
		if (!('player' in v) || !('jersey_number' in v) || !('photo' in v)) return;
		const e = R(i); const p = e.player;
		if (!p || typeof p !== 'object') return;
		if ((p.first_name ?? p.last_name ?? p.full_name ?? '').toString().trim()) n++;
	});
	return n;
}

interface Target { id: number; team_id: number; sport_code: string; domain: string | null; sidearm_roster_id: string | null; platform: string; season_year: number; }

async function resolveTargets(supabase: SupabaseClient, opts: { source?: string | null; team?: string | null; includeUnverified: boolean }): Promise<Target[]> {
	let q = supabase.from('roster_sources').select('id, team_id, sport_code, domain, sidearm_roster_id, platform, status, seasons!inner(start_date), teams!inner(ncaa_team_id)');
	if (!opts.includeUnverified) q = q.eq('status', 'verified');
	if (opts.source) q = q.eq('id', Number(opts.source));
	if (opts.team) q = q.eq('teams.ncaa_team_id', opts.team);
	const { data, error } = await q;
	if (error) throw new Error(`resolveTargets: ${error.message}`);
	// deno-lint-ignore no-explicit-any
	return (data ?? []).map((r: any) => {
		const season = Array.isArray(r.seasons) ? r.seasons[0] : r.seasons;
		return { id: r.id, team_id: r.team_id, sport_code: r.sport_code, domain: r.domain, sidearm_roster_id: r.sidearm_roster_id, platform: r.platform, season_year: new Date(`${season.start_date}T00:00:00Z`).getUTCFullYear() };
	});
}

Deno.serve(async (req) => {
	if (req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) return json({ error: 'Unauthorized' }, 401);
	const url = new URL(req.url);
	const opts = { source: url.searchParams.get('source'), team: url.searchParams.get('team'), includeUnverified: url.searchParams.get('includeUnverified') === 'true' };
	const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

	let targets: Target[];
	try { targets = await resolveTargets(supabase, opts); }
	catch (e) { return json({ ran: false, error: e instanceof Error ? e.message : String(e) }, 500); }
	if (!targets.length) return json({ ran: true, scraped: 0, reason: 'No matching sources', results: [] });

	const startedAt = Date.now();
	const results: unknown[] = [];

	for (const t of targets) {
		const t0 = Date.now();
		try {
			if (!t.domain) throw new Error('source missing domain');
			let path: string, entriesSeen: number, httpStatus: number;

			if (t.platform === 'wmt') {
				// WMT Nuxt SPA: try season-specific paths first (the live default is the
				// upcoming season), then the default; pick the first with a real roster.
				const slug = SPORT_URL_SLUG[t.sport_code] ?? 'mens-soccer';
				const urls = buildWmtRosterUrls(t.domain, slug, t.season_year);
				let best: { html: string; count: number; url: string; status: number } | null = null;
				let lastStatus = 0;
				for (const u of urls) {
					const res = await fetch(u, { headers: { 'User-Agent': USER_AGENT } });
					lastStatus = res.status;
					if (!res.ok) continue;
					const html = await res.text();
					const count = countWmtPlayers(html);
					if (count >= 10) { best = { html, count, url: u, status: res.status }; break; }
					if (!best || count > best.count) best = { html, count, url: u, status: res.status };
				}
				if (!best) throw new Error(`no WMT roster page reachable (last HTTP ${lastStatus})`);
				if (best.count === 0) throw new Error(`WMT page had 0 players (${best.url})`);
				httpStatus = best.status;
				path = htmlPath(t.sport_code, t.season_year, t.team_id);
				const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, best.html, { contentType: 'text/html', upsert: true });
				if (upErr) throw new Error(`storage upload: ${upErr.message}`);
				entriesSeen = best.count;
			} else if (t.platform === 'sidearm-html') {
				const slug = SPORT_URL_SLUG[t.sport_code] ?? 'mens-soccer';
				const res = await fetch(`https://${t.domain}/sports/${slug}/roster/${t.season_year}`, { headers: { 'User-Agent': USER_AGENT } });
				httpStatus = res.status;
				if (!res.ok) throw new Error(`roster page HTTP ${httpStatus}`);
				const html = await res.text();
				path = htmlPath(t.sport_code, t.season_year, t.team_id);
				const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, html, { contentType: 'text/html', upsert: true });
				if (upErr) throw new Error(`storage upload: ${upErr.message}`);
				entriesSeen = new Set([...html.matchAll(/\/roster\/[^/"']+\/(\d+)/g)].map((m) => m[1])).size;
			} else {
				if (!t.sidearm_roster_id) throw new Error('source missing sidearm_roster_id');
				const res = await fetch(`https://${t.domain}/api/v2/Rosters/${t.sidearm_roster_id}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
				httpStatus = res.status;
				if (!res.ok) throw new Error(`Sidearm API ${httpStatus}`);
				const raw = await res.json();
				path = jsonPath(t.sport_code, t.season_year, t.team_id);
				const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, JSON.stringify(raw, null, 2), { contentType: 'application/json', upsert: true });
				if (upErr) throw new Error(`storage upload: ${upErr.message}`);
				entriesSeen = visibleCount(raw);
			}

			await supabase.from('roster_scrape_log').insert({ roster_source_id: t.id, status: 'success', http_status: httpStatus, entries_seen: entriesSeen, duration_ms: Date.now() - t0 });
			results.push({ source_id: t.id, platform: t.platform, path, entries_seen: entriesSeen, ms: Date.now() - t0 });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await supabase.from('roster_scrape_log').insert({ roster_source_id: t.id, status: 'error', error_message: msg, duration_ms: Date.now() - t0 });
			results.push({ source_id: t.id, error: msg });
		}
	}

	return json({ ran: true, scraped: targets.length, totalMs: Date.now() - startedAt, results });
});
