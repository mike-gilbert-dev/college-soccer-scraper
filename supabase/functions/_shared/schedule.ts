// School athletics-site SCHEDULE parsing — types and the Sidearm NextGen parser.
//
// These pages are a MEDIA-LINK source, not a schedule source. nightly-ingest's
// ?ahead= window already puts unplayed games in the DB from the NCAA feed, and
// that feed stays authoritative for date, time, opponent and score. What it does
// not carry is any broadcast data at all (0 of 4,956 2026 D1 games have a
// broadcaster_name), which is the entire reason this module exists.
//
// All three platform parsers produce ParsedScheduleEvent so the matcher and the
// ingest path are shared. Parsers are pure and total: a missing optional field
// maps to null, never a throw. The edge functions inline copies (Deno can't
// import $lib); keep them in sync.

import { resolveCarrier, isDeepLink, type StreamAccess } from './carriers.ts';

/** One media link found on a schedule event. */
export interface ParsedStreamLink {
	kind: 'video' | 'audio' | 'stats' | 'tickets';
	url: string | null; // null when a carrier is named with nothing to click
	label: string | null;
	carrier: string | null;
	access: StreamAccess;
	isDeepLink: boolean;
}

/** One event from a school's schedule, normalized across platforms. */
export interface ParsedScheduleEvent {
	externalEventId: string | null;
	/** Local calendar date as the school published it, YYYY-MM-DD. */
	date: string | null;
	/** 'H' | 'A' | 'N' — which side the scraping school is on. */
	locationSide: 'H' | 'A' | 'N' | null;
	opponentName: string | null;
	carrierRaw: string | null; // the school's own tv string, for the queue
	links: ParsedStreamLink[];
}

// ── Sidearm NextGen /api/v2/Schedule/{id} shapes (subset we use) ─────────────
interface SidearmLink {
	title?: string | null;
	url?: string | null;
	label?: string | null;
}
interface SidearmScheduleMedia {
	tv?: string | null;
	tvImage?: string | null;
	radio?: string | null;
	video?: SidearmLink | null;
	audio?: SidearmLink | null;
	stats?: SidearmLink | null;
	tickets?: SidearmLink | null;
}
interface SidearmScheduleGame {
	id?: number | string | null;
	date?: string | null; // '2026-08-20T19:30:00' (local, no zone)
	locationIndicator?: string | null; // 'H' | 'A' | 'N'
	opponent?: { title?: string | null } | null;
	media?: SidearmScheduleMedia | null;
	tbd?: boolean | null;
}
export interface SidearmScheduleResponse {
	id?: number;
	title?: string;
	games?: SidearmScheduleGame[];
	[key: string]: unknown;
}

const clean = (s: string | null | undefined): string | null => {
	const t = (s ?? '').replace(/\s+/g, ' ').trim();
	return t.length ? t : null;
};

/**
 * Take the calendar date only. The feed publishes wall-clock local time with no
 * zone, and we match on the school's own calendar date — the ±1 day fallback in
 * the matcher covers the late-Pacific edge rather than guessing a timezone here.
 */
export function scheduleDate(raw: string | null | undefined): string | null {
	const t = clean(raw);
	if (!t) return null;
	const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	const d = new Date(t);
	if (Number.isNaN(d.getTime())) return null;
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Strip the decoration schools put around an opponent name: a leading AP
 * ranking ("#16 High Point") and a trailing conference tag ("Boston College
 * (ACC)"). Both would defeat the matcher's normalized-name comparison.
 */
export function cleanOpponent(raw: string | null | undefined): string | null {
	let t = clean(raw);
	if (!t) return null;
	t = t.replace(/^#\s*\d+\s*/, ''); // ranking prefix
	t = t.replace(/\s*\([^)]*\)\s*$/, ''); // trailing (ACC)
	t = t.replace(/^(?:at|vs\.?)\s+/i, ''); // stray at/vs
	return clean(t);
}

export function normalizeSide(raw: string | null | undefined): 'H' | 'A' | 'N' | null {
	const t = (raw ?? '').trim().toUpperCase();
	if (t === 'H' || t === 'HOME') return 'H';
	if (t === 'A' || t === 'AWAY') return 'A';
	if (t === 'N' || t === 'NEUTRAL') return 'N';
	return null;
}

/**
 * Build a link record, resolving carrier + access + deep-link status.
 * Exported because all three parsers use it.
 */
export function buildLink(
	kind: ParsedStreamLink['kind'],
	url: string | null,
	label: string | null,
	ctx: { tv?: string | null; tvImage?: string | null; domain?: string | null }
): ParsedStreamLink {
	// The event's tv / tvImage describe the VIDEO broadcast only. Feeding them to
	// a stats, audio or tickets link mislabels it — a StatBroadcast link on an
	// ACCNX game is not carried by ACCNX. Those kinds resolve from their URL.
	const isVideo = kind === 'video';
	const resolved = resolveCarrier({
		tv: isVideo ? ctx.tv : null,
		tvImage: isVideo ? ctx.tvImage : null,
		url,
		domain: ctx.domain
	});
	return {
		kind,
		url: clean(url),
		label: clean(label),
		carrier: resolved.carrier || null,
		access: resolved.access,
		isDeepLink: isDeepLink(url)
	};
}

/**
 * Parse a Sidearm NextGen schedule response.
 * @param raw   the /api/v2/Schedule/{id} JSON
 * @param domain the school's host, so school-run streams resolve as free
 */
export function parseSidearmSchedule(raw: unknown, domain: string): ParsedScheduleEvent[] {
	const res = (raw ?? {}) as SidearmScheduleResponse;
	const games = Array.isArray(res.games) ? res.games : [];
	const out: ParsedScheduleEvent[] = [];

	for (const g of games) {
		const media = g.media ?? {};
		const tv = clean(media.tv);
		const tvImage = clean(media.tvImage);
		const ctx = { tv, tvImage, domain };
		const links: ParsedStreamLink[] = [];

		if (media.video?.url) links.push(buildLink('video', media.video.url, media.video.title ?? null, ctx));
		if (media.audio?.url) links.push(buildLink('audio', media.audio.url, media.audio.title ?? null, ctx));
		if (media.stats?.url) links.push(buildLink('stats', media.stats.url, media.stats.title ?? null, ctx));
		if (media.tickets?.url) links.push(buildLink('tickets', media.tickets.url, media.tickets.title ?? null, ctx));

		// A carrier named with no link is still worth a row — it is how the
		// scoreboard says "on ACC Network" for a game with nothing to click.
		const hasVideo = links.some((l) => l.kind === 'video');
		if (!hasVideo && (tv || tvImage)) {
			const carrierOnly = buildLink('video', null, tv, ctx);
			if (carrierOnly.carrier) links.push(carrierOnly);
		}

		out.push({
			externalEventId: g.id != null ? String(g.id) : null,
			date: scheduleDate(g.date),
			locationSide: normalizeSide(g.locationIndicator),
			opponentName: cleanOpponent(g.opponent?.title),
			carrierRaw: tv,
			links
		});
	}
	return out;
}
