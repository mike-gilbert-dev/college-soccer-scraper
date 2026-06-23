// Supabase Edge Function: roster-headshots
//
// Step 3 of the roster pipeline (scrape -> ingest -> headshots). The ONLY step
// that downloads images. For each matched player_season with a headshot_url that
// is new or changed, it fetches the image and stores a durable copy in the public
// `player-headshots` bucket, keyed by player_id within a sport/season/division/team
// folder. Idempotent (skips unchanged via headshot_downloaded_from), fault-isolated
// (one bad image never aborts the batch, never wipes an existing headshot_path).
//
// Targeting: ?source=<id> | ?team=<ncaa_team_id> | default = all verified sources.
// Optional: ?force=true (re-download even if unchanged), ?concurrency=<n>.
// Auth: Bearer <service role key>. Deployed with verify_jwt off; self-checks.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'player-headshots';
const USER_AGENT = 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function headshotPath(sportCode: string, seasonYear: number, division: number, teamId: number | string, playerId: number | string, ext: string): string {
	return `${sportCode}/${seasonYear}/${division}/${teamId}/${playerId}.${ext}`;
}
function extForContentType(contentType: string | null): string | null {
	const ct = (contentType ?? '').split(';')[0].trim().toLowerCase();
	switch (ct) {
		case 'image/jpeg': case 'image/jpg': return 'jpg';
		case 'image/png': return 'png';
		case 'image/webp': return 'webp';
		case 'image/gif': return 'gif';
		case 'image/avif': return 'avif';
		default: return null;
	}
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

interface Target { id: number; team_id: number; sport_code: string; season_id: number; season_year: number; }
async function resolveTargets(supabase: SupabaseClient, opts: { source?: string | null; team?: string | null; includeUnverified: boolean }): Promise<Target[]> {
	let q = supabase.from('roster_sources').select('id, team_id, sport_code, season_id, status, seasons!inner(start_date), teams!inner(ncaa_team_id)');
	if (!opts.includeUnverified) q = q.eq('status', 'verified');
	if (opts.source) q = q.eq('id', Number(opts.source));
	if (opts.team) q = q.eq('teams.ncaa_team_id', opts.team);
	const { data, error } = await q;
	if (error) throw new Error(`resolveTargets: ${error.message}`);
	// deno-lint-ignore no-explicit-any
	return (data ?? []).map((r: any) => {
		const season = Array.isArray(r.seasons) ? r.seasons[0] : r.seasons;
		return { id: r.id, team_id: r.team_id, sport_code: r.sport_code, season_id: r.season_id, season_year: new Date(`${season.start_date}T00:00:00Z`).getUTCFullYear() };
	});
}

interface PSRow { id: number; player_id: number; headshot_url: string; headshot_path: string | null; headshot_downloaded_from: string | null; }

Deno.serve(async (req) => {
	if (req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) return json({ error: 'Unauthorized' }, 401);
	const url = new URL(req.url);
	const opts = { source: url.searchParams.get('source'), team: url.searchParams.get('team'), includeUnverified: url.searchParams.get('includeUnverified') === 'true' };
	const force = url.searchParams.get('force') === 'true';
	const concurrency = Math.max(1, parseInt(url.searchParams.get('concurrency') ?? '4', 10) || 4);
	const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

	let targets: Target[];
	try { targets = await resolveTargets(supabase, opts); }
	catch (e) { return json({ ran: false, error: e instanceof Error ? e.message : String(e) }, 500); }
	if (!targets.length) return json({ ran: true, processed: 0, reason: 'No matching sources', results: [] });

	const startedAt = Date.now();
	const results: unknown[] = [];

	for (const t of targets) {
		const t0 = Date.now();
		const errors: { player_season_id: number; message: string }[] = [];
		try {
			const { data: ts, error: tsErr } = await supabase.from('team_seasons').select('id, division').eq('team_id', t.team_id).eq('season_id', t.season_id).eq('sport_code', t.sport_code).maybeSingle();
			if (tsErr) throw new Error(`team_seasons: ${tsErr.message}`);
			if (!ts) throw new Error(`no team_season for team ${t.team_id} season ${t.season_id} ${t.sport_code}`);
			const teamSeasonId = ts.id as number;
			const division = ts.division as number;

			const { data: psAll, error: psErr } = await supabase.from('player_seasons')
				.select('id, player_id, headshot_url, headshot_path, headshot_downloaded_from')
				.eq('team_season_id', teamSeasonId).not('headshot_url', 'is', null);
			if (psErr) throw new Error(`player_seasons: ${psErr.message}`);
			const candidates = (psAll ?? []) as PSRow[];
			const todo = candidates.filter((p) => force || p.headshot_path === null || p.headshot_downloaded_from !== p.headshot_url);

			let downloaded = 0;
			await pool(todo, concurrency, async (p) => {
				try {
					// Old-Sidearm card images are 80px thumbnails (?width=80); strip the query
					// to fetch the full-resolution original. NextGen URLs have no query (no-op).
					const res = await fetch(p.headshot_url.split('?')[0], { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' } });
					if (!res.ok) throw new Error(`image HTTP ${res.status}`);
					const ext = extForContentType(res.headers.get('content-type'));
					if (!ext) throw new Error(`non-image content-type ${res.headers.get('content-type')}`);
					const bytes = new Uint8Array(await res.arrayBuffer());
					const key = headshotPath(t.sport_code, t.season_year, division, t.team_id, p.player_id, ext);

					// Remove any stale <playerId>.<otherExt> in the folder so a content-type change leaves one file.
					const prefix = `${t.sport_code}/${t.season_year}/${division}/${t.team_id}`;
					const { data: existingFiles } = await supabase.storage.from(BUCKET).list(prefix);
					const stale = (existingFiles ?? [])
						.filter((f) => f.name.startsWith(`${p.player_id}.`) && f.name !== `${p.player_id}.${ext}`)
						.map((f) => `${prefix}/${f.name}`);
					if (stale.length) await supabase.storage.from(BUCKET).remove(stale);

					const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, bytes, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true });
					if (upErr) throw new Error(`upload: ${upErr.message}`);

					const { error: updErr } = await supabase.from('player_seasons')
						.update({ headshot_path: key, headshot_downloaded_at: new Date().toISOString(), headshot_downloaded_from: p.headshot_url })
						.eq('id', p.id);
					if (updErr) throw new Error(`update ps: ${updErr.message}`);
					downloaded++;
				} catch (e) {
					errors.push({ player_season_id: p.id, message: e instanceof Error ? e.message : String(e) });
				}
				await new Promise((r) => setTimeout(r, 100)); // politeness
			});

			await supabase.from('roster_scrape_log').insert({
				roster_source_id: t.id, status: errors.length && downloaded === 0 ? 'error' : 'success',
				entries_seen: candidates.length, enriched: downloaded, queued: errors.length,
				error_message: errors.length ? `${errors.length} image(s) failed: ${errors.slice(0, 3).map((e) => e.message).join('; ')}` : null,
				duration_ms: Date.now() - t0
			});
			results.push({ source_id: t.id, candidates: candidates.length, needed: todo.length, downloaded, failed: errors.length, ms: Date.now() - t0 });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await supabase.from('roster_scrape_log').insert({ roster_source_id: t.id, status: 'error', error_message: msg, duration_ms: Date.now() - t0 });
			results.push({ source_id: t.id, error: msg });
		}
	}

	return json({ ran: true, processed: targets.length, totalMs: Date.now() - startedAt, results });
});
