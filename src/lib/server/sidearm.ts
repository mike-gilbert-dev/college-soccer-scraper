// Sidearm Sports roster API — types, fetch, and a pure parser.
//
// Most NCAA D1 athletics sites run on Sidearm ("Next Gen"), which serves roster
// data as clean JSON at https://{domain}/api/v2/Rosters/{id}. This module models
// the subset of that response we use and maps it to a normalized intermediate
// (ParsedRosterPlayer) that the matcher (Phase 3) consumes.
//
// parseRoster is pure and total: it never throws on a missing optional field —
// it maps to null. The roster-scrape edge function inlines copies of the small
// pure helpers here (Deno can't import $lib); keep the two in sync.

const USER_AGENT = 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)';

// ── Sidearm response shapes (subset we use) ──────────────────────────────────
export interface SidearmImage {
	url?: string | null;
	absoluteUrl?: string | null;
	altText?: string | null;
}
export interface SidearmPlayer {
	id?: number | string | null;
	firstName?: string | null;
	lastName?: string | null;
	jerseyNumber?: string | number | null;
	positionShort?: string | null;
	positionLong?: string | null;
	academicYearShort?: string | null;
	academicYearLong?: string | null;
	heightFeet?: number | string | null;
	heightInches?: number | string | null;
	hometown?: string | null;
	highSchool?: string | null;
	previousSchool?: string | null;
	image?: SidearmImage | null;
	hide?: boolean | null;
}
export interface SidearmRosterResponse {
	id?: number;
	displayTitle?: string;
	players?: SidearmPlayer[];
	[key: string]: unknown;
}

// ── Normalized intermediate consumed by the matcher ──────────────────────────
export interface ParsedRosterPlayer {
	firstName: string;
	lastName: string;
	jerseyNumber: number | null;
	position: string | null; // positionShort
	classYear: string | null; // normalized FR/SO/JR/SR/GR
	height: string | null; // raw, e.g. "5-8"
	hometown: string | null;
	headshotUrl: string | null; // image.absoluteUrl (preferred)
	externalRef: string | null; // Sidearm player id if present
}

/**
 * Map Sidearm academicYearShort to the player_seasons.class_year vocabulary
 * (FR/SO/JR/SR/GR). Redshirt prefixes (e.g. "R-Sr.") strip to the base year.
 * Unknown values return null (callers may log them) — never guessed.
 */
export function normalizeClassYear(short: string | null | undefined): string | null {
	if (!short) return null;
	let s = short.toLowerCase().replace(/[^a-z]/g, ''); // 'sr', 'rsr', 'rfr', 'grad'...
	// Strip a leading redshirt 'r' (e.g. 'rsr' -> 'sr', 'rfr' -> 'fr') — guarded so
	// we don't eat the real codes (all of which are >=2 chars after the prefix).
	if (s.startsWith('r') && s.length > 2) s = s.slice(1);
	const map: Record<string, string> = {
		fr: 'FR', freshman: 'FR',
		so: 'SO', soph: 'SO', sophomore: 'SO',
		jr: 'JR', junior: 'JR',
		sr: 'SR', senior: 'SR',
		gr: 'GR', grad: 'GR', graduate: 'GR', g: 'GR', fifth: 'GR'
	};
	return map[s] ?? null;
}

function parseJersey(raw: string | number | null | undefined): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
	return Number.isFinite(n) ? n : null;
}

function buildHeight(
	feet: number | string | null | undefined,
	inches: number | string | null | undefined
): string | null {
	const f = feet === null || feet === undefined || feet === '' ? null : parseInt(String(feet), 10);
	if (f === null || !Number.isFinite(f) || f <= 0) return null;
	const i = inches === null || inches === undefined || inches === '' ? 0 : parseInt(String(inches), 10);
	return `${f}-${Number.isFinite(i) ? i : 0}`;
}

const clean = (s: string | null | undefined): string | null => {
	const t = (s ?? '').trim();
	return t.length ? t : null;
};

/** Pure, total parse of a Sidearm roster response into normalized players. */
export function parseRoster(raw: SidearmRosterResponse | null | undefined): ParsedRosterPlayer[] {
	const players = raw?.players ?? [];
	const out: ParsedRosterPlayer[] = [];
	for (const p of players) {
		if (p?.hide === true) continue;
		const firstName = (p.firstName ?? '').trim();
		const lastName = (p.lastName ?? '').trim();
		if (!firstName && !lastName) continue; // skip empty/placeholder rows
		out.push({
			firstName,
			lastName,
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

/** Build the Sidearm roster API URL for a domain + roster id. */
export function buildRosterUrl(domain: string, rosterId: string): string {
	return `https://${domain}/api/v2/Rosters/${rosterId}`;
}

/** Fetch raw roster JSON. Throws with the status on non-2xx. */
export async function fetchRoster(domain: string, rosterId: string): Promise<SidearmRosterResponse> {
	const res = await fetch(buildRosterUrl(domain, rosterId), {
		headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
	});
	if (!res.ok) throw new Error(`Sidearm roster API ${res.status} for ${domain}/${rosterId}`);
	return (await res.json()) as SidearmRosterResponse;
}
