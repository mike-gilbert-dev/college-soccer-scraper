// Supabase Edge Function: roster-ingest
//
// Step 2 of the roster pipeline (scrape -> ingest -> headshots). Reads the raw
// roster JSON that roster-scrape archived to Storage (NO external fetch), parses
// it, matches each entry to the team-season's existing player_seasons, enriches
// confident matches, and stages unmatched/ambiguous entries in roster_entry_queue
// for human review. Never clobbers players.name; only fills null jersey/position;
// roster is authoritative for headshot/height/hometown/class_year.
//
// Targeting: ?source=<id> | ?team=<ncaa_team_id> | default = all verified sources.
// Auth: Bearer <service role key>. Deployed with verify_jwt off; self-checks.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { parse } from 'npm:node-html-parser@8';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'sidearm-raw-rosters';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function jsonPath(sportCode: string, seasonYear: number, teamId: number | string): string {
	return `${sportCode}/${seasonYear}/${teamId}.json`;
}
function htmlPath(sportCode: string, seasonYear: number, teamId: number | string): string {
	return `${sportCode}/${seasonYear}/${teamId}.html`;
}

// ── Inlined pure helpers (kept in sync with src/lib/server/sidearm.ts + roster-match.ts) ──
interface ParsedRosterPlayer {
	firstName: string; lastName: string; jerseyNumber: number | null; position: string | null;
	classYear: string | null; height: string | null; hometown: string | null;
	headshotUrl: string | null; externalRef: string | null;
}
function normalizeClassYear(short: string | null | undefined): string | null {
	if (!short) return null;
	let s = short.toLowerCase().replace(/[^a-z]/g, '');
	if (s.startsWith('r') && s.length > 2) s = s.slice(1);
	const map: Record<string, string> = {
		fr: 'FR', freshman: 'FR', so: 'SO', soph: 'SO', sophomore: 'SO', jr: 'JR', junior: 'JR',
		sr: 'SR', senior: 'SR', gr: 'GR', grad: 'GR', graduate: 'GR', g: 'GR', fifth: 'GR'
	};
	return map[s] ?? null;
}
function parseJersey(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
	return Number.isFinite(n) ? n : null;
}
function buildHeight(feet: unknown, inches: unknown): string | null {
	const f = feet === null || feet === undefined || feet === '' ? null : parseInt(String(feet), 10);
	if (f === null || !Number.isFinite(f) || f <= 0) return null;
	const i = inches === null || inches === undefined || inches === '' ? 0 : parseInt(String(inches), 10);
	return `${f}-${Number.isFinite(i) ? i : 0}`;
}
const clean = (s: unknown): string | null => {
	const t = (s == null ? '' : String(s)).trim();
	return t.length ? t : null;
};
// deno-lint-ignore no-explicit-any
function parseRoster(raw: any): ParsedRosterPlayer[] {
	const players = raw?.players ?? [];
	const out: ParsedRosterPlayer[] = [];
	for (const p of players) {
		if (p?.hide === true) continue;
		const firstName = (p.firstName ?? '').trim();
		const lastName = (p.lastName ?? '').trim();
		if (!firstName && !lastName) continue;
		out.push({
			firstName, lastName,
			jerseyNumber: parseJersey(p.jerseyNumber),
			position: clean(p.positionShort),
			classYear: normalizeClassYear(p.academicYearShort),
			height: buildHeight(p.heightFeet, p.heightInches),
			hometown: clean(p.hometown),
			headshotUrl: clean(p.image?.absoluteUrl) ?? clean(p.image?.url),
			externalRef: p.id !== null && p.id !== undefined ? String(p.id) : null
		});
	}
	return out;
}

// Old-Sidearm HTML roster parser (cards). Mirrors src/lib/server/sidearm-html.ts.
function normHeight(s: string | null): string | null {
	if (!s) return null;
	const m = s.match(/(\d+)\D+(\d+)/);
	return m ? `${m[1]}-${m[2]}` : null;
}
function parseSidearmHtmlRoster(html: string, domain: string): ParsedRosterPlayer[] {
	const root = parse(html);
	const cards = root.querySelectorAll('.sidearm-roster-player');
	const out: ParsedRosterPlayer[] = [];
	const seen = new Set<string>();
	for (const card of cards) {
		let id: string | null = null;
		let nameFromLink = '';
		for (const a of card.querySelectorAll('a')) {
			const href = a.getAttribute('href') ?? '';
			const m = href.match(/\/roster\/[^/]+\/(\d+)(?:[/?#]|$)/);
			if (m) { id = m[1]; if (!nameFromLink) nameFromLink = clean(a.text) ?? ''; }
		}
		if (!id || seen.has(id)) continue;
		const nameEl = card.querySelector('.sidearm-roster-player-name');
		let name = nameFromLink || clean(nameEl?.text) || '';
		name = name.replace(/^#?\d+\s+/, '').trim();
		if (!name) continue;
		seen.add(id);
		const t = (sel: string) => clean(card.querySelector(sel)?.text ?? null);
		const jerseyTxt = t('.sidearm-roster-player-jersey-number') ?? t('.sidearm-roster-player-jersey');
		const jersey = jerseyTxt ? parseInt(jerseyTxt.replace(/[^0-9]/g, ''), 10) : NaN;
		const posRaw = t('.sidearm-roster-player-position .text-bold');
		const position = posRaw ? posRaw.split(/\s+/).pop()! : null;
		const [firstName, ...rest] = name.split(/\s+/);
		const img = card.querySelector('.sidearm-roster-player-image img') ?? card.querySelector('img');
		let headshot = img?.getAttribute('data-src') ?? img?.getAttribute('src') ?? null;
		if (headshot && headshot.startsWith('/')) headshot = `https://${domain}${headshot}`;
		out.push({
			firstName: firstName ?? '', lastName: rest.join(' '),
			jerseyNumber: Number.isFinite(jersey) ? jersey : null,
			position,
			classYear: normalizeClassYear(t('.sidearm-roster-player-academic-year')),
			height: normHeight(t('.sidearm-roster-player-height')),
			hometown: t('.sidearm-roster-player-hometown'),
			headshotUrl: headshot,
			externalRef: id
		});
	}
	return out;
}

interface ExistingPS { id: number; player_id: number; name: string; jerseyNumber: number | null; position: string | null; }
type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';
interface MatchResult {
	entry: ParsedRosterPlayer; status: MatchStatus; playerSeasonId: number | null; playerId: number | null;
	suggestedPlayerSeasonId: number | null; reason: string; jerseyMismatch: boolean;
}
function normalizeName(s: string | null | undefined): string {
	return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function pushv<T>(m: Map<string, T[]>, k: string, v: T): void {
	const a = m.get(k); if (a) a.push(v); else m.set(k, [v]);
}
function matchRoster(parsed: ParsedRosterPlayer[], existing: ExistingPS[]): MatchResult[] {
	const byFull = new Map<string, ExistingPS[]>();
	const byLast = new Map<string, ExistingPS[]>();
	for (const e of existing) {
		const full = normalizeName(e.name); if (!full) continue;
		pushv(byFull, full, e);
		const parts = full.split(' '); pushv(byLast, parts[parts.length - 1], e);
	}
	const results: MatchResult[] = [];
	for (const entry of parsed) {
		const fullKey = normalizeName(`${entry.firstName} ${entry.lastName}`);
		const fullMatches = byFull.get(fullKey) ?? [];
		if (fullMatches.length === 1) {
			const m = fullMatches[0];
			const jerseyMismatch = entry.jerseyNumber !== null && m.jerseyNumber !== null && entry.jerseyNumber !== m.jerseyNumber;
			results.push({ entry, status: 'matched', playerSeasonId: m.id, playerId: m.player_id, suggestedPlayerSeasonId: null,
				reason: jerseyMismatch ? `unique name match; jersey differs (roster #${entry.jerseyNumber} vs internal #${m.jerseyNumber})` : 'unique name match', jerseyMismatch });
			continue;
		}
		if (fullMatches.length > 1) {
			const jResolved = entry.jerseyNumber !== null ? fullMatches.filter((m) => m.jerseyNumber === entry.jerseyNumber) : [];
			const suggestion = jResolved.length === 1 ? jResolved[0].id : null;
			results.push({ entry, status: 'ambiguous', playerSeasonId: null, playerId: null, suggestedPlayerSeasonId: suggestion,
				reason: `${fullMatches.length} internal players share this name${suggestion ? '; jersey resolves to one' : ''}`, jerseyMismatch: false });
			continue;
		}
		const lastKey = normalizeName(entry.lastName);
		const lastMatches = byLast.get(lastKey) ?? [];
		const jLast = entry.jerseyNumber !== null ? lastMatches.filter((m) => m.jerseyNumber === entry.jerseyNumber) : [];
		if (jLast.length === 1) {
			results.push({ entry, status: 'ambiguous', playerSeasonId: null, playerId: null, suggestedPlayerSeasonId: jLast[0].id,
				reason: 'last name + jersey match (likely first-name/nickname variant)', jerseyMismatch: false });
			continue;
		}
		results.push({ entry, status: 'unmatched', playerSeasonId: null, playerId: null, suggestedPlayerSeasonId: null, reason: 'no plausible internal match', jerseyMismatch: false });
	}
	return results;
}

// ── Target resolution ────────────────────────────────────────────────────────
interface Target { id: number; team_id: number; sport_code: string; season_id: number; season_year: number; platform: string; domain: string | null; }
async function resolveTargets(
	supabase: SupabaseClient,
	opts: { source?: string | null; team?: string | null; includeUnverified: boolean }
): Promise<Target[]> {
	let q = supabase.from('roster_sources')
		.select('id, team_id, sport_code, season_id, platform, domain, status, seasons!inner(start_date), teams!inner(ncaa_team_id)');
	if (!opts.includeUnverified) q = q.eq('status', 'verified');
	if (opts.source) q = q.eq('id', Number(opts.source));
	if (opts.team) q = q.eq('teams.ncaa_team_id', opts.team);
	const { data, error } = await q;
	if (error) throw new Error(`resolveTargets: ${error.message}`);
	// deno-lint-ignore no-explicit-any
	return (data ?? []).map((r: any) => {
		const season = Array.isArray(r.seasons) ? r.seasons[0] : r.seasons;
		return { id: r.id, team_id: r.team_id, sport_code: r.sport_code, season_id: r.season_id,
			season_year: new Date(`${season.start_date}T00:00:00Z`).getUTCFullYear(), platform: r.platform, domain: r.domain };
	});
}

Deno.serve(async (req) => {
	if (req.headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) return json({ error: 'Unauthorized' }, 401);

	const url = new URL(req.url);
	const opts = {
		source: url.searchParams.get('source'),
		team: url.searchParams.get('team'),
		includeUnverified: url.searchParams.get('includeUnverified') === 'true'
	};
	const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

	let targets: Target[];
	try { targets = await resolveTargets(supabase, opts); }
	catch (e) { return json({ ran: false, error: e instanceof Error ? e.message : String(e) }, 500); }
	if (!targets.length) return json({ ran: true, ingested: 0, reason: 'No matching sources', results: [] });

	const startedAt = Date.now();
	const results: unknown[] = [];

	for (const t of targets) {
		const t0 = Date.now();
		try {
			// Resolve the team-season this roster belongs to.
			const { data: ts, error: tsErr } = await supabase.from('team_seasons')
				.select('id').eq('team_id', t.team_id).eq('season_id', t.season_id).eq('sport_code', t.sport_code).maybeSingle();
			if (tsErr) throw new Error(`team_seasons: ${tsErr.message}`);
			if (!ts) throw new Error(`no team_season for team ${t.team_id} season ${t.season_id} ${t.sport_code}`);
			const teamSeasonId = ts.id as number;

			// Read archived roster from Storage (no external fetch). Path + parser by platform.
			const isHtml = t.platform === 'sidearm-html';
			const path = isHtml ? htmlPath(t.sport_code, t.season_year, t.team_id) : jsonPath(t.sport_code, t.season_year, t.team_id);
			const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
			if (dlErr) {
				const notFound = /not found|404|Object not found/i.test(dlErr.message);
				if (notFound) {
					await supabase.from('roster_scrape_log').insert({ roster_source_id: t.id, status: 'skipped',
						error_message: `no archived roster at ${path}; run roster-scrape first`, duration_ms: Date.now() - t0 });
					results.push({ source_id: t.id, skipped: true, reason: 'not scraped yet' });
					continue;
				}
				throw new Error(`download ${path}: ${dlErr.message}`);
			}
			const text = await blob.text();
			const parsed = isHtml ? parseSidearmHtmlRoster(text, t.domain ?? '') : parseRoster(JSON.parse(text));

			// Load existing player_seasons for this team-season.
			const { data: psRows, error: psErr } = await supabase.from('player_seasons')
				.select('id, player_id, jersey_number, position, players!inner(name)')
				.eq('team_season_id', teamSeasonId);
			if (psErr) throw new Error(`player_seasons: ${psErr.message}`);
			// deno-lint-ignore no-explicit-any
			const existing: ExistingPS[] = (psRows ?? []).map((r: any) => ({
				id: r.id, player_id: r.player_id, jerseyNumber: r.jersey_number, position: r.position,
				name: (Array.isArray(r.players) ? r.players[0]?.name : r.players?.name) ?? ''
			}));
			const existingById = new Map(existing.map((e) => [e.id, e]));

			const matches = matchRoster(parsed, existing);
			const nowIso = new Date().toISOString();

			// Enrich confident matches (per-row; never clobber name; fill-null jersey/position).
			let enriched = 0;
			for (const m of matches.filter((x) => x.status === 'matched')) {
				const ex = existingById.get(m.playerSeasonId!)!;
				const upd: Record<string, unknown> = { roster_source_id: t.id, roster_synced_at: nowIso };
				if (m.entry.headshotUrl !== null) upd.headshot_url = m.entry.headshotUrl;
				if (m.entry.height !== null) upd.height = m.entry.height;
				if (m.entry.hometown !== null) upd.hometown = m.entry.hometown;
				if (m.entry.classYear !== null) upd.class_year = m.entry.classYear;
				if (ex.jerseyNumber === null && m.entry.jerseyNumber !== null) upd.jersey_number = m.entry.jerseyNumber;
				if (ex.position === null && m.entry.position !== null) upd.position = m.entry.position;
				const { error: uErr } = await supabase.from('player_seasons').update(upd).eq('id', m.playerSeasonId!);
				if (uErr) throw new Error(`enrich ps ${m.playerSeasonId}: ${uErr.message}`);
				enriched++;
			}

			// Stage unmatched/ambiguous. Omit review_status/reviewed_at so an already
			// approved/rejected entry keeps its state on re-runs.
			const queueRows = matches.filter((x) => x.status !== 'matched').map((x) => ({
				roster_source_id: t.id, team_season_id: teamSeasonId,
				first_name: x.entry.firstName, last_name: x.entry.lastName, jersey_number: x.entry.jerseyNumber,
				position: x.entry.position, class_year: x.entry.classYear, height: x.entry.height,
				hometown: x.entry.hometown, headshot_url: x.entry.headshotUrl, external_ref: x.entry.externalRef,
				match_status: x.status, suggested_player_season_id: x.suggestedPlayerSeasonId, suggestion_reason: x.reason
			}));
			if (queueRows.length) {
				const { error: qErr } = await supabase.from('roster_entry_queue')
					.upsert(queueRows, { onConflict: 'roster_source_id,first_name,last_name,jersey_number' });
				if (qErr) throw new Error(`queue upsert: ${qErr.message}`);
			}

			const matched = matches.filter((x) => x.status === 'matched').length;
			const queued = queueRows.length;
			await supabase.from('roster_scrape_log').insert({ roster_source_id: t.id, status: 'success',
				entries_seen: parsed.length, matched, enriched, queued, duration_ms: Date.now() - t0 });

			results.push({ source_id: t.id, entries_seen: parsed.length, matched, enriched, queued,
				ambiguous: matches.filter((x) => x.status === 'ambiguous').length,
				unmatched: matches.filter((x) => x.status === 'unmatched').length, ms: Date.now() - t0 });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await supabase.from('roster_scrape_log').insert({ roster_source_id: t.id, status: 'error', error_message: msg, duration_ms: Date.now() - t0 });
			results.push({ source_id: t.id, error: msg });
		}
	}

	return json({ ran: true, ingested: targets.length, totalMs: Date.now() - startedAt, results });
});
