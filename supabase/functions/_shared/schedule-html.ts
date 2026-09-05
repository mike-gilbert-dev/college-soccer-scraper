// Schedule parsers for the two HTML platforms.
//
//  parseSidearmHtmlSchedule — the OLDER Sidearm (ASP.NET + Knockout), which
//    renders .sidearm-schedule-game-row blocks and has no schedule JSON API
//    (/api/v2/* 404s; services/schedule_xml_2.aspx redirects to /sorry.ashx).
//
//  parseWmtSchedule — WMT Digital's Nuxt sites. Note that unlike the WMT ROSTER,
//    the schedule is NOT in the __NUXT_DATA__ payload (checked across Virginia,
//    Clemson, Stanford and Seattle: no event objects, no stream URLs). The
//    server-rendered HTML is the only source.
//
// ── Why this is written the way it is ───────────────────────────────────────
// Neither vendor ships one markup. Two conferences produced four WMT variants
// and two old-Sidearm variants, disagreeing on nearly every class name:
//
//   Virginia   .schedule-event-date__month-day  .schedule-default-event__name
//   Clemson    <time> (no datetime attr)        .schedule-event-default__name
//   Stanford   .event-date-item__date           .schedule-event-item-team__opponent-name
//   Seattle    .schedule-event-date__day        .schedule-default-event__name
//
// Chasing that with a longer fallback chain per field does not converge — each
// new conference added a variant. So the extraction below is POSITION-
// INDEPENDENT: it reads the row's text and its anchors, and only consults class
// names as a hint when one happens to be present. Concretely:
//
//   date      a real month name anywhere in the row's text
//   opponent  the opponent-history link or the logo's alt text (structural)
//   links     any anchor whose href looks like a stream (not its class)
//
// Both produce ParsedScheduleEvent, identical to the NextGen JSON parser.
// Works in Node (tests) and Deno edge runtime (via `npm:node-html-parser`).

import { parse, type HTMLElement } from 'npm:node-html-parser@6.1.13';
import {
	buildLink,
	cleanOpponent,
	normalizeSide,
	type ParsedScheduleEvent,
	type ParsedStreamLink
} from './schedule.ts';

const clean = (s: string | null | undefined): string | null => {
	const t = (s ?? '').replace(/\s+/g, ' ').trim();
	return t.length ? t : null;
};

const MONTHS: Record<string, number> = {
	jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
	jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/**
 * Find a calendar date in arbitrary row text.
 *
 * Anchoring on a real month name — rather than "3+ letters then digits" — is
 * what makes this survive the run-together text these pages produce:
 *
 *   "Aug 10 (Mon)"   "Sun, Aug 23"   "Aug 23home"   "TueAug 11"   "WedAug 124:00 PM"
 *
 * The old pattern read "TueAug" as the month and "124" as the day. Requiring a
 * known month, and allowing it to be preceded by a run-together weekday, makes
 * every one of those resolve correctly.
 */
export function dateFromText(text: string | null | undefined, seasonYear: number): string | null {
	const t = clean(text);
	if (!t) return null;
	// [a-z]* after the month absorbs "Sept"/"August"; (?!\d) stops "12" being
	// taken from "124:00 PM".
	const m = t.match(
		/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{1,2})(?!\d)/i
	);
	if (!m) return null;
	const month = MONTHS[m[1].toLowerCase()];
	const day = Number(m[2]);
	if (month === undefined || day < 1 || day > 31) return null;
	// Schedule pages omit the year; a season spans Aug–Dec, so the season's own
	// year is correct for every month a soccer season touches.
	const d = new Date(Date.UTC(seasonYear, month, day));
	if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null; // e.g. Feb 30
	return d.toISOString().slice(0, 10);
}

/**
 * Opponent name, preferring structure over class names.
 *
 * An opponent-history link (`/sports/.../opponent-history/<slug>/<id>`) and a
 * logo `alt` are both present regardless of which template a site runs, whereas
 * the name element is called something different on every variant.
 */
export function opponentFromRow(row: HTMLElement): string | null {
	// Named elements FIRST. Where a variant has one it is exactly right; the
	// problem was never their accuracy, only that each variant names it
	// differently. Structural fallbacks below are strictly worse — an
	// opponent-history link's text is often the literal word "History", and a
	// logo's alt is as likely to be the SCRAPING school's crest as the
	// opponent's ("virginia_cavaliers_logo", "TigerPaw_Orange_Logo").
	// Explicitly-opponent elements before generic "name" ones: Seattle renders
	// BOTH teams as .schedule-default-event__name (its own first), so a
	// querySelector there returns the scraping school, not the opponent.
	const named =
		row.querySelector('.sidearm-schedule-game-opponent-name')?.text ??
		row.querySelector('.schedule-default-event__opponent-heading')?.text ??
		row.querySelector('.schedule-event-item-team__opponent-name')?.text ??
		row.querySelector('.schedule-event-item__opponent-name')?.text ??
		row.querySelector('.schedule-event-item-opponent__name')?.text ??
		row.querySelector('.schedule-event-default__name')?.text ??
		row.querySelector('.schedule-default-event__title')?.text ?? // WMT: Purdue
		nonSelfName(row) ??
		row.querySelector('.sidearm-schedule-game-opponent-text')?.text ??
		null;
	const byName = cleanOpponent(named);
	if (byName && !isGenericLabel(byName)) return byName;

	// Fallback: the opponent-history slug, which is a real team identifier.
	// Its LINK TEXT is not usable — templates render it as "History",
	// "Opponent History", or a bare logo.
	for (const a of row.querySelectorAll('a')) {
		const href = a.getAttribute('href') ?? '';
		const slug = href.match(/opponent-history\/([^/?#]+)/i)?.[1];
		if (!slug || /^\d+$/.test(slug)) continue;
		const title = cleanOpponent(
			slug.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())
		);
		if (title && !isGenericLabel(title)) return title;
	}
	return null;
}

/**
 * `.schedule-default-event__name` names BOTH teams on some variants — Seattle
 * lists itself first, Virginia lists only the opponent. Drop any entry that
 * matches the row's `__current-name` (the scraping school) and take what's left.
 */
function nonSelfName(row: HTMLElement): string | null {
	const all = row.querySelectorAll('.schedule-default-event__name');
	if (all.length === 0) return null;
	if (all.length === 1) return all[0].text;
	const self = clean(row.querySelector('.schedule-default-event__current-name')?.text);
	const other = all.map((e) => clean(e.text)).find((t) => t && t !== self);
	return other ?? all[all.length - 1].text; // no marker: the opponent is listed second
}

/**
 * Reject strings that are chrome rather than a team: link labels, and the
 * filename-ish alt text sites give their own crest.
 */
function isGenericLabel(s: string): boolean {
	return (
		s.length < 2 ||
		/^(history|opponent history|logo|team|tbd|tba|opponent)$/i.test(s) ||
		/_logo|logo_|^[a-z]+_[a-z_]+$/i.test(s)
	);
}

/** Which side the scraping school is on, from whatever the row exposes. */
export function sideFromRow(row: HTMLElement): 'H' | 'A' | 'N' | null {
	const explicit =
		row.querySelector('.schedule-event-date__venue-type')?.text ??
		row.querySelector('.sidearm-schedule-game-location-indicator')?.text ??
		null;
	const byExplicit = normalizeSide(clean(explicit));
	if (byExplicit) return byExplicit;

	// "at Cal State Fullerton" / "vs. Portland" — the at/vs token is the signal.
	const atVs = clean(
		row.querySelector('.sidearm-schedule-game-conference-vs')?.text ??
			row.querySelector('.schedule-event-item__location-indicator')?.text ??
			null
	);
	if (atVs) return /^at\b|^@/i.test(atVs) ? 'A' : 'H';

	// Location block ending in the word home/away/neutral (Virginia).
	const locTxt = clean(row.querySelector('.schedule-event-item__location')?.text) ?? '';
	const byWord = normalizeSide(locTxt.match(/\b(home|away|neutral)\s*$/i)?.[1] ?? null);
	if (byWord) return byWord;

	// Modifier class on a child (Stanford).
	if (row.querySelector('[class*="--home"]')) return 'H';
	if (row.querySelector('[class*="--away"]')) return 'A';

	// Last resort: an "at " at the start of the row's own text.
	const rowTxt = clean(row.text) ?? '';
	if (/^at\s+/i.test(rowTxt)) return 'A';
	if (/^vs\.?\s+/i.test(rowTxt)) return 'H';
	return null;
}

/** Hosts that mean "this anchor is a broadcast", regardless of its class. */
const STREAM_HOSTS =
	/espn\.com|bigtenplus\.com|bigten\.org|flosports|flofc\.com|flocollege\.com|midcosportsplus\.com|foxsports\.com|youtube\.com|youtu\.be|facebook\.com|nfhsnetwork\.com|boxcast|stretchinternet\.com|hudl\.com|vimeo\.com/i;
const STATS_HOSTS = /statbroadcast\.com|sidearmstats\.com|statsheet|livestats/i;
const TICKET_HOSTS = /ticketmaster|seatgeek|tickets?\./i;

/**
 * Classify an anchor by what it points at and what it says — never by its class
 * alone. Stanford's links are `schedule-event-links__link` and Virginia's are
 * `schedule-event-item-links__link`; keying on either missed the other.
 */
function classifyAnchor(
	href: string,
	text: string,
	liClass: string
): ParsedStreamLink['kind'] | null {
	// An explicit class is the most reliable signal WHEN present.
	if (/links-video/.test(liClass)) return 'video';
	if (/links-stats/.test(liClass)) return 'stats';
	if (/links-tickets/.test(liClass)) return 'tickets';
	if (/links-audio|links-radio/.test(liClass)) return 'audio';

	const t = text.toLowerCase();
	// Text first: "Box Score" and "Recap" are on stream hosts' pages too, and
	// must not be taken for a broadcast.
	if (/box ?score|recap|preview|notes|gallery|photo|history/.test(t)) return null;
	if (/live stat|stats|statbroadcast/.test(t) || STATS_HOSTS.test(href)) return 'stats';
	if (/ticket/.test(t) || TICKET_HOSTS.test(href)) return 'tickets';
	if (/listen|radio|audio/.test(t)) return 'audio';
	if (/watch|video|stream|live/.test(t) || STREAM_HOSTS.test(href)) return 'video';
	return null;
}

/** Every media link in a row, found by href rather than by container class. */
function linksFromRow(
	row: HTMLElement,
	domain: string,
	ctx: { tv: string | null; tvImage: string | null; domain: string }
): { links: ParsedStreamLink[]; ariaDate: string | null } {
	const links: ParsedStreamLink[] = [];
	const seen = new Set<string>();
	let ariaDate: string | null = null;

	for (const a of row.querySelectorAll('a')) {
		const href = a.getAttribute('href');
		if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;

		const aria = a.getAttribute('aria-label') ?? '';
		if (!ariaDate) ariaDate = dateFromAriaLabel(aria);

		// Opponent-history and internal navigation are not media.
		if (/opponent-history|\/roster|\/news\/|\/facilities/i.test(href)) continue;

		const liClass = a.parentNode?.getAttribute?.('class') ?? '';
		const text = `${clean(a.text) ?? ''} ${aria}`;
		const kind = classifyAnchor(href, text, liClass);
		if (!kind) continue;

		const url = absolutize(href, domain);
		const dedupe = `${kind}|${url}`;
		if (seen.has(dedupe)) continue;
		seen.add(dedupe);
		links.push(buildLink(kind, url, clean(a.text), ctx));
	}
	return { links, ariaDate };
}

/**
 * Pull a date out of an aria-label. Old-Sidearm labels read
 * "Video for Men's Soccer vs Lindenwood on September 4, 2026 at 7PM"; WMT uses
 * "Live Stats - Virginia Cavaliers vs. Boston College" (no date).
 */
export function dateFromAriaLabel(label: string | null | undefined): string | null {
	if (!label) return null;
	const m = label.match(/on\s+([A-Z][a-z]+ \d{1,2},? \d{4})/);
	if (!m) return null;
	const d = new Date(m[1]);
	if (Number.isNaN(d.getTime())) return null;
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function absolutize(href: string, domain: string): string {
	if (/^https?:\/\//i.test(href)) return href;
	if (href.startsWith('//')) return `https:${href}`;
	return `https://${domain}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * Date for a row: a datetime attribute if the site provides one (exact), then a
 * date-bearing element if one is recognizable, then the row's whole text.
 */
function dateFromRow(row: HTMLElement, seasonYear: number): string | null {
	const dt =
		row.querySelector('[datetime]')?.getAttribute('datetime') ??
		row.querySelector('time')?.getAttribute('datetime') ??
		null;
	if (dt) {
		const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	}
	// A narrow element first (least surrounding noise), then the whole row.
	const narrow =
		row.querySelector('.sidearm-schedule-game-opponent-date')?.text ??
		row.querySelector('.schedule-event-date__month-day')?.text ??
		row.querySelector('.event-date-item__date')?.text ??
		row.querySelector('.schedule-event-date__day')?.text ??
		row.querySelector('.schedule-event-item__date')?.text ??
		row.querySelector('time')?.text ??
		null;
	return dateFromText(narrow, seasonYear) ?? dateFromText(row.text, seasonYear);
}

/** Shared row → event mapping, used by both platforms. */
function eventFromRow(
	row: HTMLElement,
	domain: string,
	seasonYear: number,
	tv: string | null,
	tvImage: string | null,
	externalEventId: string | null
): ParsedScheduleEvent {
	const ctx = { tv, tvImage, domain };
	const { links, ariaDate } = linksFromRow(row, domain, ctx);

	// A carrier named with no link is still worth a row — it is how the
	// scoreboard says "on ACC Network" for a game with nothing to click.
	if (!links.some((l) => l.kind === 'video') && (tv || tvImage)) {
		const carrierOnly = buildLink('video', null, tv, ctx);
		if (carrierOnly.carrier) links.push(carrierOnly);
	}

	return {
		externalEventId,
		date: dateFromRow(row, seasonYear) ?? ariaDate,
		locationSide: sideFromRow(row),
		opponentName: opponentFromRow(row),
		carrierRaw: tv,
		links
	};
}

/** Old-Sidearm: .sidearm-schedule-game-row blocks. */
export function parseSidearmHtmlSchedule(
	html: string,
	domain: string,
	seasonYear: number
): ParsedScheduleEvent[] {
	const root = parse(html);
	// Most old-Sidearm sites mark rows `.sidearm-schedule-game-row`; a few (North
	// American University) use the bare `.sidearm-schedule-game`. Fall back only
	// when the specific class finds nothing, so sites carrying both are not
	// double-counted.
	let rows = root.querySelectorAll('.sidearm-schedule-game-row');
	if (rows.length === 0) rows = root.querySelectorAll('.sidearm-schedule-game');
	return rows.map((row) =>
		eventFromRow(
			row,
			domain,
			seasonYear,
			clean(row.querySelector('.sidearm-schedule-game-coverage-tv')?.text),
			row.querySelector('.sidearm-schedule-game-coverage-tv img')?.getAttribute('src') ?? null,
			clean(row.getAttribute('data-game-id') ?? row.getAttribute('id') ?? null)
		)
	);
}

/** WMT: .schedule-event-item blocks, server-rendered. */
export function parseWmtSchedule(
	html: string,
	domain: string,
	seasonYear: number
): ParsedScheduleEvent[] {
	const root = parse(html);
	return root.querySelectorAll('.schedule-event-item').map((row) =>
		eventFromRow(
			row,
			domain,
			seasonYear,
			null, // WMT carries no tv string; the carrier comes from the link host
			null,
			clean(
				row.querySelector('[entity-id]')?.getAttribute('entity-id') ??
					row.getAttribute('entity-id') ??
					null
			)
		)
	);
}
