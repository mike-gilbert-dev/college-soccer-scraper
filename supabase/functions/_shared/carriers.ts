// Carrier normalization for game_streams.
//
// Schools name the same broadcaster many ways: a 387-event sample produced 12
// distinct `tv` strings for about 6 actual carriers ("Big Ten Network"/"BTN",
// "ACC Network Extra"/"ACCNX", "ACC Network"/"ACCN"). Writing those straight to
// games.broadcaster_name would put all twelve on the scoreboard as if they were
// different networks.
//
// The other job here is separating a WEBSTREAM from a TV BROADCAST, which the
// schedule feeds do not do — media.video.url carries both. ~90% of college
// soccer is direct-to-consumer streaming, but the ~10% that is linear TV still
// ships a URL, and it is a cable-authenticated simulcast page
// (Big Ten Network -> foxsports.com/live/btn). A "Watch" button on those sends
// the viewer to a TV-provider login, which reads as a broken link.
//
// Pure module: no IO. The edge functions inline a copy (Deno can't import $lib);
// keep the two in sync.

export type StreamAccess = 'free' | 'subscription' | 'tv_authenticated' | 'unknown';

export interface CarrierInfo {
	carrier: string;
	access: StreamAccess;
}

/**
 * Known carrier strings -> normalized identity. Keys are lowercased and
 * punctuation-stripped (see carrierKey). Unrecognized strings deliberately
 * resolve to null rather than being guessed at — they surface in /admin as a
 * prompt to add an entry here, which is how the map stays current without a
 * migration.
 */
export const CARRIERS: Record<string, CarrierInfo> = {
	// ── Direct-to-consumer streaming ────────────────────────────────────────
	'espn+': { carrier: 'espn_plus', access: 'subscription' },
	'espn plus': { carrier: 'espn_plus', access: 'subscription' },
	espnplus: { carrier: 'espn_plus', access: 'subscription' },
	'b1g+': { carrier: 'b1g_plus', access: 'subscription' },
	'b1g plus': { carrier: 'b1g_plus', access: 'subscription' },
	'btn+': { carrier: 'b1g_plus', access: 'subscription' },
	'big ten plus': { carrier: 'b1g_plus', access: 'subscription' },
	'acc network extra': { carrier: 'accnx', access: 'subscription' },
	accnx: { carrier: 'accnx', access: 'subscription' },
	'accn extra': { carrier: 'accnx', access: 'subscription' },
	'sec network+': { carrier: 'secn_plus', access: 'subscription' },
	'secn+': { carrier: 'secn_plus', access: 'subscription' },
	flosports: { carrier: 'flosports', access: 'subscription' },
	flofc: { carrier: 'flosports', access: 'subscription' },
	'flo sports': { carrier: 'flosports', access: 'subscription' },
	'midco sports plus': { carrier: 'midco', access: 'subscription' },
	'midco sports+': { carrier: 'midco', access: 'subscription' },
	'espn3': { carrier: 'espn3', access: 'subscription' },

	// ── Linear TV: needs a cable/TV-provider login, NOT a webstream ──────────
	'big ten network': { carrier: 'btn', access: 'tv_authenticated' },
	btn: { carrier: 'btn', access: 'tv_authenticated' },
	'acc network': { carrier: 'accn', access: 'tv_authenticated' },
	accn: { carrier: 'accn', access: 'tv_authenticated' },
	'sec network': { carrier: 'secn', access: 'tv_authenticated' },
	secn: { carrier: 'secn', access: 'tv_authenticated' },
	espnu: { carrier: 'espnu', access: 'tv_authenticated' },
	espn2: { carrier: 'espn2', access: 'tv_authenticated' },
	espnews: { carrier: 'espnews', access: 'tv_authenticated' },
	'cbs sports network': { carrier: 'cbssn', access: 'tv_authenticated' },
	cbssn: { carrier: 'cbssn', access: 'tv_authenticated' },
	'fox sports 1': { carrier: 'fs1', access: 'tv_authenticated' },
	fs1: { carrier: 'fs1', access: 'tv_authenticated' },

	// ── Free ────────────────────────────────────────────────────────────────
	youtube: { carrier: 'youtube', access: 'free' },
	'youtube live': { carrier: 'youtube', access: 'free' },
	facebook: { carrier: 'facebook', access: 'free' },
	'facebook live': { carrier: 'facebook', access: 'free' }
};

/**
 * Canonical display name per carrier — what `games.broadcaster_name` and the
 * scoreboard show. This is the whole point of normalizing: without it the
 * sample's 12 raw strings reach the UI and "BTN" and "Big Ten Network" read as
 * two different networks.
 */
export const CARRIER_LABELS: Record<string, string> = {
	espn_plus: 'ESPN+',
	b1g_plus: 'B1G+',
	accnx: 'ACC Network Extra',
	secn_plus: 'SEC Network+',
	flosports: 'FloSports',
	midco: 'Midco Sports+',
	espn3: 'ESPN3',
	btn: 'Big Ten Network',
	accn: 'ACC Network',
	secn: 'SEC Network',
	espnu: 'ESPNU',
	espn2: 'ESPN2',
	espnews: 'ESPNews',
	cbssn: 'CBS Sports Network',
	fs1: 'FS1',
	youtube: 'YouTube',
	facebook: 'Facebook',
	statbroadcast: 'Live Stats',
	stretch: 'Stretch Internet',
	nfhs: 'NFHS Network',
	boxcast: 'BoxCast',
	school_stream: 'School stream'
};

/** Display name for a normalized carrier id; null if we have no label for it. */
export function carrierLabel(carrier: string | null | undefined): string | null {
	if (!carrier) return null;
	return CARRIER_LABELS[carrier] ?? null;
}

/**
 * URL host -> carrier, for the 121-of-387 events that publish a link with no
 * carrier name. Matched as a substring of the hostname.
 */
const HOST_CARRIERS: Array<[string, CarrierInfo]> = [
	['bigtenplus.com', { carrier: 'b1g_plus', access: 'subscription' }],
	['plus.espn.com', { carrier: 'espn_plus', access: 'subscription' }],
	['espn.com', { carrier: 'espn_plus', access: 'subscription' }],
	['flosports', { carrier: 'flosports', access: 'subscription' }],
	['flofc.com', { carrier: 'flosports', access: 'subscription' }],
	// FloSports' college brand — surfaced as an unknown carrier by the first
	// live NC State run, which is how this map is meant to grow.
	['flocollege.com', { carrier: 'flosports', access: 'subscription' }],
	['midcosportsplus.com', { carrier: 'midco', access: 'subscription' }],
	['foxsports.com', { carrier: 'btn', access: 'tv_authenticated' }],
	['youtube.com', { carrier: 'youtube', access: 'free' }],
	['youtu.be', { carrier: 'youtube', access: 'free' }],
	['facebook.com', { carrier: 'facebook', access: 'free' }],
	['statbroadcast.com', { carrier: 'statbroadcast', access: 'free' }],
	['stretchinternet.com', { carrier: 'stretch', access: 'free' }],
	['nfhsnetwork.com', { carrier: 'nfhs', access: 'subscription' }],
	['boxcast.tv', { carrier: 'boxcast', access: 'free' }],
	['bigten.org', { carrier: 'b1g_plus', access: 'subscription' }]
];

/** Lowercase, collapse whitespace, drop punctuation that varies between sites. */
export function carrierKey(s: string | null | undefined): string {
	return (s ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[._]/g, ' ')
		.replace(/[^a-z0-9+\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Resolve a school's `tv` string (or a tvImage filename) to a known carrier. */
export function carrierFromName(raw: string | null | undefined): CarrierInfo | null {
	const key = carrierKey(raw);
	if (!key) return null;
	if (CARRIERS[key]) return CARRIERS[key];

	// tvImage filenames carry the carrier when `tv` is blank (15 of 387 events):
	// "accnx-Logo_l90Hs.png", "B1G_plus_Oxx9R.png", "uconn_plus.png". Match the
	// longest key contained in the string so "acc network extra" beats "accn".
	const keys = Object.keys(CARRIERS).sort((a, b) => b.length - a.length);
	for (const k of keys) {
		if (k.length >= 4 && key.includes(k)) return CARRIERS[k];
	}
	return null;
}

/** Resolve a carrier from the link's host, when no name was published. */
export function carrierFromUrl(url: string | null | undefined): CarrierInfo | null {
	if (!url) return null;
	let host: string;
	try {
		host = new URL(url, 'https://placeholder.invalid').hostname.toLowerCase();
	} catch {
		return null;
	}
	// A relative URL resolves to the placeholder host: that is the school's own
	// site, which means a school-run stream.
	if (host === 'placeholder.invalid') return { carrier: 'school_stream', access: 'free' };
	for (const [needle, info] of HOST_CARRIERS) {
		if (host.includes(needle)) return info;
	}
	return null;
}

/**
 * Full resolution, in the order the plan specifies: the published name, then
 * the network logo filename, then the URL host. Anything unrecognized stays
 * null/'unknown' so it shows up for review instead of being mislabeled.
 */
export function resolveCarrier(opts: {
	tv?: string | null;
	tvImage?: string | null;
	url?: string | null;
	domain?: string | null;
}): CarrierInfo & { resolvedFrom: 'name' | 'logo' | 'host' | 'none' } {
	const byName = carrierFromName(opts.tv);
	if (byName) return { ...byName, resolvedFrom: 'name' };

	// Use only the filename, not the whole path — "/images/2025/8/5/accnx-Logo.png"
	// would otherwise match on date fragments.
	const file = (opts.tvImage ?? '').split('/').pop() ?? '';
	const byLogo = carrierFromName(file.replace(/\.(png|jpe?g|svg|webp|gif)$/i, ''));
	if (byLogo) return { ...byLogo, resolvedFrom: 'logo' };

	// A link on the school's own domain is a school-run stream, not ESPN.
	if (opts.url && opts.domain && opts.url.includes(opts.domain)) {
		return { carrier: 'school_stream', access: 'free', resolvedFrom: 'host' };
	}
	const byHost = carrierFromUrl(opts.url);
	if (byHost) return { ...byHost, resolvedFrom: 'host' };

	return { carrier: '', access: 'unknown', resolvedFrom: 'none' };
}

/**
 * Does this URL point at THIS game, or at a landing page?
 *
 * Independent of access: a B1G+ per-game link is deep AND paywalled;
 * foxsports.com/live/btn is generic AND cable-gated. Pattern-matching hosts was
 * tried and got this wrong (it scored bigtenplus.com/.../2194669 as generic), so
 * the test is structural — a landing page is a bare or well-known-generic path.
 */
export function isDeepLink(url: string | null | undefined): boolean {
	if (!url) return false;
	let path: string, search: string, host: string;
	try {
		const u = new URL(url, 'https://placeholder.invalid');
		path = u.pathname.replace(/\/+$/, '');
		search = u.search;
		host = u.hostname.toLowerCase();
	} catch {
		return false;
	}
	if (!path && !search) return false; // bare domain: plus.espn.com
	// Known landing pages.
	if (/^\/(watch|live|home|index|search|schedule|tickets)$/i.test(path) && !search) return false;
	if (/^\/en-[a-z]{2,3}\/page\/home$/i.test(path)) return false; // bigtenplus.com/en-int/page/home
	if (/^\/live\/[a-z0-9]{2,5}$/i.test(path) && !search) return false; // foxsports.com/live/btn
	if (/espn\.com$/.test(host) && /^\/search/i.test(path)) return false;
	// A YouTube channel/user is not a broadcast; /watch?v= and /live/<id> are.
	if (/youtube\.com$/.test(host)) return /^\/(watch|live|embed)/i.test(path) && (!!search || /\/live\/.+/.test(path));
	// Otherwise: a real path segment or a query identifies the event.
	return /[a-z0-9]/i.test(path.replace(/^\//, '')) || /[?&](id|v|event|live)=/i.test(search);
}
