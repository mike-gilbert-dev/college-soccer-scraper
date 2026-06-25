// WMT Digital roster parser.
//
// A third athletics-site platform (alongside Sidearm NextGen JSON and the older
// ASP.NET Sidearm HTML). Used by Stanford, Virginia, Clemson, Penn St, Virginia
// Tech, San Diego St, UCF, Old Dominion, San Jose St, Seattle, and others.
//
// These are Nuxt SPAs: the roster page server-renders its data into a single
// `<script id="__NUXT_DATA__">` block as a devalue-encoded *flat array* (each
// object's property values are integer indices into the same array). We resolve
// that graph, then pull every roster-entry object (has `player`, `jersey_number`,
// `photo`) into the shared ParsedRosterPlayer shape.
//
// Season targeting: the live default roster is the *upcoming* season, so callers
// must request `/sports/{sportPath}/roster/season/{year}` to get a past season
// (see buildWmtRosterUrls). Headshot URLs (`photo.url`) are full-resolution
// absolute imgproxy URLs — no `?width=` thumbnail param to strip.

import type { ParsedRosterPlayer } from './sidearm';

const clean = (s: unknown): string | null => {
	const t = s == null ? '' : String(s).trim();
	return t.length ? t : null;
};
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
// WMT class levels are full phrases ("Redshirt Senior", "Graduate Student"),
// so keyword-scan rather than relying on normalizeClassYear's short-code map.
function wmtClassYear(name: unknown): string | null {
	const s = (name == null ? '' : String(name)).toLowerCase();
	if (!s) return null;
	if (/fresh/.test(s)) return 'FR';
	if (/soph/.test(s)) return 'SO';
	if (/jun/.test(s)) return 'JR';
	if (/sen/.test(s)) return 'SR';
	if (/grad/.test(s)) return 'GR';
	return null;
}

// Resolve a devalue flat-array graph into plain objects (memoized; cycle-safe).
// deno-lint-ignore no-explicit-any
function makeResolver(flat: any[]): (i: unknown) => any {
	const cache = new Map<number, unknown>();
	// deno-lint-ignore no-explicit-any
	function R(i: unknown): any {
		if (typeof i !== 'number') return i;
		if (cache.has(i)) return cache.get(i);
		const v = flat[i];
		if (v === null || typeof v !== 'object') {
			cache.set(i, v);
			return v;
		}
		if (Array.isArray(v)) {
			const a: unknown[] = [];
			cache.set(i, a);
			for (const x of v) a.push(R(x));
			return a;
		}
		const o: Record<string, unknown> = {};
		cache.set(i, o);
		for (const k in v) o[k] = R((v as Record<string, unknown>)[k]);
		return o;
	}
	return R;
}

export function parseWmtRoster(html: string): ParsedRosterPlayer[] {
	const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
	if (!m) return [];
	// deno-lint-ignore no-explicit-any
	let flat: any[];
	try {
		flat = JSON.parse(m[1]);
	} catch {
		return [];
	}
	if (!Array.isArray(flat)) return [];
	const R = makeResolver(flat);
	const out: ParsedRosterPlayer[] = [];
	const seen = new Set<string>();
	flat.forEach((v, i) => {
		if (!v || typeof v !== 'object' || Array.isArray(v)) return;
		if (!('player' in v) || !('jersey_number' in v) || !('photo' in v)) return;
		const e = R(i);
		const p = e.player;
		if (!p || typeof p !== 'object') return;
		const first = clean(p.first_name) ?? '';
		const last = clean(p.last_name) ?? '';
		const full = clean(p.full_name) ?? '';
		if (!first && !last && !full) return;
		const ref =
			e.player_id != null ? String(e.player_id) : p.id != null ? String(p.id) : clean(p.slug);
		if (ref && seen.has(ref)) return;
		if (ref) seen.add(ref);
		const pos =
			e.player_position && typeof e.player_position === 'object'
				? (clean(e.player_position.abbreviation) ?? clean(e.player_position.name))
				: null;
		const ft = e.height_feet ?? p.height_feet;
		const inch = e.height_inches ?? p.height_inches;
		out.push({
			firstName: first || full.split(/\s+/)[0] || '',
			lastName: last || full.split(/\s+/).slice(1).join(' '),
			jerseyNumber: parseJersey(e.jersey_number ?? p.jersey_number),
			position: pos,
			classYear: wmtClassYear(e.class_level && e.class_level.name),
			height: buildHeight(ft, inch),
			hometown: clean(p.hometown),
			headshotUrl: e.photo && typeof e.photo === 'object' ? clean(e.photo.url) : null,
			externalRef: ref
		});
	});
	return out;
}

export function countWmtPlayers(html: string): number {
	return parseWmtRoster(html).filter((p) => p.firstName || p.lastName).length;
}

// Candidate roster URLs to try, in priority order: season-specific paths first
// (to pin the correct season), then the live default as a fallback. Sport path
// is usually `mens-soccer` but some sites (Virginia, South Carolina) use `msoc`.
export function buildWmtRosterUrls(domain: string, sportPath: string, year: number): string[] {
	const slugs = sportPath === 'mens-soccer' ? ['mens-soccer', 'msoc'] : [sportPath, 'mens-soccer'];
	const urls: string[] = [];
	for (const s of slugs) urls.push(`https://${domain}/sports/${s}/roster/season/${year}`);
	for (const s of slugs) urls.push(`https://${domain}/sports/${s}/roster`);
	return urls;
}
