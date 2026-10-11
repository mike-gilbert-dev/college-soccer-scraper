// Display helpers for game_streams rows, shared by /scores and the game page.
//
// Pure module: safe to import client-side (src/lib/server/carriers.ts is not).

export type StreamAccess = 'free' | 'subscription' | 'tv_authenticated' | 'unknown';

/** One link for a game, as the UI renders it. */
export interface StreamLink {
	url: string | null;
	carrier: string | null;
	access: StreamAccess;
	label: string | null;
	is_deep_link: boolean;
	source_side: 'home' | 'away';
}

// Display name per carrier. Mirrors CARRIER_LABELS in
// src/lib/server/carriers.ts — change one, change the other.
export const CARRIER_LABELS: Record<string, string> = {
	espn_plus: 'ESPN+', b1g_plus: 'B1G+', accnx: 'ACC Network Extra',
	secn_plus: 'SEC Network+', flosports: 'FloSports', midco: 'Midco Sports+',
	espn3: 'ESPN3', btn: 'Big Ten Network', accn: 'ACC Network', secn: 'SEC Network',
	espnu: 'ESPNU', espn2: 'ESPN2', espnews: 'ESPNews', cbssn: 'CBS Sports Network',
	fs1: 'FS1', youtube: 'YouTube', facebook: 'Facebook', school_stream: 'School stream'
};

export const carrierName = (s: StreamLink) =>
	(s.carrier && CARRIER_LABELS[s.carrier]) || s.label || 'Watch';

/**
 * A link is only a button when clicking it actually reaches a broadcast.
 * `tv_authenticated` means a cable-provider login (Big Ten Network ->
 * foxsports.com/live/btn), and a link with no per-game id lands on a
 * carrier's home page — both read as broken links, so they render as plain
 * text instead.
 */
export const isWatchable = (s: StreamLink | undefined): s is StreamLink & { url: string } =>
	!!s?.url && s.is_deep_link && (s.access === 'free' || s.access === 'subscription');

const accessRank = (a: string) =>
	({ free: 0, subscription: 1, unknown: 2, tv_authenticated: 3 })[a] ?? 2;

/**
 * Whether `next` should replace `cur` as a game's primary link. Same preference
 * order as the game_primary_stream view: a link to THIS game beats a landing
 * page, free beats a subscription beats a cable login, and the home school beats
 * the away school.
 */
export function isBetterStream(next: StreamLink, cur: StreamLink | undefined): boolean {
	if (!cur) return true;
	if (next.is_deep_link !== cur.is_deep_link) return next.is_deep_link;
	const a = accessRank(next.access), b = accessRank(cur.access);
	if (a !== b) return a < b;
	return next.source_side === 'home' && cur.source_side !== 'home';
}
