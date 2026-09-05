import { describe, it, expect } from 'vitest';
import { parseSidearmSchedule, scheduleDate, normalizeSide, cleanOpponent } from './schedule';
import { parseSidearmHtmlSchedule, parseWmtSchedule, dateFromAriaLabel, dateFromText } from './schedule-html';
import { resolveCarrier, isDeepLink, carrierFromName, carrierKey, carrierLabel, CARRIERS, CARRIER_LABELS } from './carriers';
import { matchScheduleEvents, opponentMatches, type CandidateGame } from './schedule-match';

// Fixtures load through Vite's ?raw import so the suite needs no node:fs (and
// so no @types/node, which this project does not install).
import ncstateJson from './__fixtures__/ncstate-schedule.json?raw';
import butlerHtml from './__fixtures__/butler-schedule.html?raw';
import uvaHtml from './__fixtures__/uva-schedule.html?raw';
import clemsonHtml from './__fixtures__/clemson-schedule.html?raw';
import stanfordHtml from './__fixtures__/stanford-schedule.html?raw';
import seattleHtml from './__fixtures__/seattle-schedule.html?raw';
import lmuHtml from './__fixtures__/lmu-schedule.html?raw';
import purdueHtml from './__fixtures__/purdue-schedule.html?raw';
import nauHtml from './__fixtures__/nau-schedule.html?raw';

// ── carriers ────────────────────────────────────────────────────────────────
describe('carrierKey', () => {
	it('normalizes punctuation and case but keeps the + that distinguishes tiers', () => {
		expect(carrierKey('ESPN+')).toBe('espn+');
		expect(carrierKey('  ACC   Network  Extra ')).toBe('acc network extra');
		expect(carrierKey('B1G_plus_Oxx9R')).toBe('b1g plus oxx9r');
	});
});

describe('carrierFromName', () => {
	it('separates a streaming tier from the linear network of the same family', () => {
		expect(carrierFromName('ESPN+')).toEqual({ carrier: 'espn_plus', access: 'subscription' });
		expect(carrierFromName('ACC Network Extra')).toEqual({ carrier: 'accnx', access: 'subscription' });
		expect(carrierFromName('ACC Network')).toEqual({ carrier: 'accn', access: 'tv_authenticated' });
		expect(carrierFromName('Big Ten Network')).toEqual({ carrier: 'btn', access: 'tv_authenticated' });
		expect(carrierFromName('B1G+')).toEqual({ carrier: 'b1g_plus', access: 'subscription' });
	});

	it('collapses the aliases that made 12 strings out of 6 carriers', () => {
		expect(carrierFromName('BTN')).toEqual(carrierFromName('Big Ten Network'));
		expect(carrierFromName('ACCN')).toEqual(carrierFromName('ACC Network'));
		expect(carrierFromName('ACCNX')).toEqual(carrierFromName('ACC Network Extra'));
	});

	it('reads a carrier out of a logo filename when tv is blank', () => {
		expect(carrierFromName('accnx-Logo_l90Hs')).toEqual({ carrier: 'accnx', access: 'subscription' });
		expect(carrierFromName('B1G_plus_Oxx9R')).toEqual({ carrier: 'b1g_plus', access: 'subscription' });
	});

	it('returns null rather than guessing', () => {
		expect(carrierFromName('Wolfpack Sports Network')).toBeNull();
		expect(carrierFromName('')).toBeNull();
		expect(carrierFromName(null)).toBeNull();
	});
});

describe('carrierLabel', () => {
	it('gives one canonical display name per carrier', () => {
		expect(carrierLabel('btn')).toBe('Big Ten Network');
		expect(carrierLabel('accnx')).toBe('ACC Network Extra');
		expect(carrierLabel('espn_plus')).toBe('ESPN+');
		expect(carrierLabel(null)).toBeNull();
		expect(carrierLabel('not_a_carrier')).toBeNull();
	});

	// This is what stops the 12 raw strings reaching games.broadcaster_name.
	it('collapses every alias of a carrier to the same label', () => {
		const label = (raw: string) => carrierLabel(carrierFromName(raw)?.carrier);
		expect(label('BTN')).toBe(label('Big Ten Network'));
		expect(label('ACCNX')).toBe(label('ACC Network Extra'));
		expect(label('ACCN')).toBe(label('ACC Network'));
		expect(label('B1G+')).toBe(label('BTN+'));
	});

	it('labels every carrier the map can produce', () => {
		const produced = new Set(Object.values(CARRIERS).map((c) => c.carrier));
		produced.add('school_stream'); // from carrierFromUrl, not the name map
		for (const c of produced) {
			expect(CARRIER_LABELS[c], `missing label for carrier "${c}"`).toBeTruthy();
		}
	});
});

describe('resolveCarrier', () => {
	it('prefers the published name over the logo and the host', () => {
		const r = resolveCarrier({ tv: 'ESPN+', tvImage: '/images/accnx-Logo.png', url: 'https://youtube.com/watch?v=x' });
		expect(r.carrier).toBe('espn_plus');
		expect(r.resolvedFrom).toBe('name');
	});

	it('falls back to the logo, ignoring date fragments in the path', () => {
		const r = resolveCarrier({ tv: '', tvImage: '/images/2025/8/5/accnx-Logo_l90Hs.png' });
		expect(r).toMatchObject({ carrier: 'accnx', access: 'subscription', resolvedFrom: 'logo' });
	});

	it('falls back to the URL host', () => {
		expect(resolveCarrier({ url: 'https://www.bigtenplus.com/en-int/livestream/x/2194669' }))
			.toMatchObject({ carrier: 'b1g_plus', access: 'subscription', resolvedFrom: 'host' });
	});

	it('treats a link on the school domain as a free school-run stream', () => {
		expect(resolveCarrier({ url: '/showcase?Live=7307', domain: 'uconnhuskies.com' }))
			.toMatchObject({ carrier: 'school_stream', access: 'free' });
	});

	it('marks a cable simulcast as tv_authenticated, not a webstream', () => {
		expect(resolveCarrier({ tv: 'Big Ten Network', url: 'https://www.foxsports.com/live/btn' }).access)
			.toBe('tv_authenticated');
	});

	it('leaves an unknown carrier unknown so it surfaces for review', () => {
		expect(resolveCarrier({ tv: 'Some Regional Net' })).toMatchObject({ carrier: '', access: 'unknown', resolvedFrom: 'none' });
	});
});

describe('isDeepLink', () => {
	it('accepts per-game URLs across providers', () => {
		expect(isDeepLink('https://www.espn.com/watch/player/_/id/3d460c90-f551-485b-ba5e-0f8fdd8a1913')).toBe(true);
		// The case a host-pattern heuristic got wrong: B1G+ per-game livestreams.
		expect(isDeepLink('https://www.bigtenplus.com/en-int/livestream/indiana-at-michigan/2194877')).toBe(true);
		expect(isDeepLink('https://www.youtube.com/watch?v=chKJU3ewT4M')).toBe(true);
		expect(isDeepLink('https://www.youtube.com/live/mHM6smjfLcw')).toBe(true);
		expect(isDeepLink('/showcase?Live=7307')).toBe(true);
	});

	it('rejects landing pages, which are the majority of "links"', () => {
		expect(isDeepLink('https://plus.espn.com')).toBe(false);
		expect(isDeepLink('https://www.bigtenplus.com/en-int/page/home')).toBe(false);
		expect(isDeepLink('https://www.foxsports.com/live/btn')).toBe(false);
		expect(isDeepLink('https://www.espn.com/watch/')).toBe(false);
		expect(isDeepLink('https://www.espn.com/search/_/q/butler/o/watch/appearance/dark')).toBe(false);
		expect(isDeepLink('https://www.youtube.com/@ncstateathletics')).toBe(false);
		expect(isDeepLink(null)).toBe(false);
	});
});

// ── date + side helpers ─────────────────────────────────────────────────────
describe('scheduleDate', () => {
	it('keeps the calendar date and drops the zoneless wall-clock time', () => {
		expect(scheduleDate('2026-08-20T19:30:00')).toBe('2026-08-20');
		expect(scheduleDate('2026-08-20')).toBe('2026-08-20');
	});
	it('returns null on junk instead of throwing', () => {
		expect(scheduleDate('TBA')).toBeNull();
		expect(scheduleDate(null)).toBeNull();
	});
});

describe('normalizeSide', () => {
	it('maps the published indicator', () => {
		expect(normalizeSide('H')).toBe('H');
		expect(normalizeSide('away')).toBe('A');
		expect(normalizeSide('N')).toBe('N');
		expect(normalizeSide('?')).toBeNull();
	});
});

describe('dateFromAriaLabel', () => {
	it('reads the date old-Sidearm writes into its aria-labels', () => {
		expect(dateFromAriaLabel("Watch (ESPN+) Video for Men's Soccer vs Lindenwood on September 4, 2026 at 7PM"))
			.toBe('2026-09-04');
	});
	it('returns null for WMT labels, which carry no date', () => {
		expect(dateFromAriaLabel('Live Stats - Virginia Cavaliers vs. Boston College')).toBeNull();
	});
});

// ── parsers, against real archived pages ────────────────────────────────────
describe('parseSidearmSchedule (NextGen JSON)', () => {
	const events = parseSidearmSchedule(JSON.parse(ncstateJson), 'gopack.com');

	it('parses every game in the payload', () => {
		expect(events.length).toBe(4);
	});

	it('extracts date, side, opponent and the watch link', () => {
		const opener = events[0];
		expect(opener.date).toBe('2026-08-20');
		expect(opener.locationSide).toBe('H');
		expect(opener.opponentName).toBe('Coastal Carolina');
		const video = opener.links.find((l) => l.kind === 'video');
		expect(video?.url).toContain('espn.com/watch/player');
		expect(video?.isDeepLink).toBe(true);
	});

	it('resolves the carrier from tvImage when tv is empty', () => {
		// NC State ships tv:"" with an ACCNX logo — the logo is the only signal.
		const video = events[0].links.find((l) => l.kind === 'video');
		expect(video?.carrier).toBe('accnx');
		expect(video?.access).toBe('subscription');
	});

	it('keeps the live-stats link as a separate kind', () => {
		const stats = events[0].links.find((l) => l.kind === 'stats');
		expect(stats?.url).toContain('statbroadcast.com');
	});

	// The event's tv/tvImage describe the video broadcast. Applying them to every
	// link labelled 23 of 34 stats rows as "accnx" on the first live run.
	it('does not attribute the TV carrier to a non-video link', () => {
		const opener = events[0];
		expect(opener.links.find((l) => l.kind === 'video')?.carrier).toBe('accnx');
		const stats = opener.links.find((l) => l.kind === 'stats');
		expect(stats?.carrier).toBe('statbroadcast');
		expect(stats?.access).toBe('free');
	});

	it('reads an away fixture', () => {
		const away = events.find((e) => e.locationSide === 'A');
		expect(away).toBeDefined();
		expect(away!.opponentName).toBeTruthy();
	});

	it('is total: never throws on missing media', () => {
		expect(() => parseSidearmSchedule({ games: [{ id: 1 }] }, 'x.com')).not.toThrow();
		expect(parseSidearmSchedule({}, 'x.com')).toEqual([]);
		expect(parseSidearmSchedule(null, 'x.com')).toEqual([]);
	});
});

describe('parseSidearmHtmlSchedule (old Sidearm)', () => {
	const events = parseSidearmHtmlSchedule(butlerHtml, 'butlersports.com', 2026);

	it('finds the event rows', () => {
		expect(events.length).toBeGreaterThan(0);
	});

	it('extracts a video link and flags Butler-style generic ESPN search URLs as shallow', () => {
		const withVideo = events.find((e) => e.links.some((l) => l.kind === 'video' && l.url));
		expect(withVideo).toBeDefined();
		const video = withVideo!.links.find((l) => l.kind === 'video')!;
		expect(video.url).toContain('espn.com');
		// Butler points every game at an ESPN search page: storable, not clickable.
		expect(video.isDeepLink).toBe(false);
	});

	it('recovers a date, from the row or the aria-label', () => {
		expect(events.some((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ''))).toBe(true);
	});
});

describe('parseWmtSchedule', () => {
	const events = parseWmtSchedule(uvaHtml, 'virginiasports.com', 2026);

	it('finds the event rows without walking the __NUXT_DATA__ graph', () => {
		expect(events.length).toBeGreaterThan(0);
	});

	it('extracts the ESPN+ deep links UVA publishes', () => {
		const urls = events.flatMap((e) => e.links.map((l) => l.url ?? ''));
		expect(urls.some((u) => u.includes('espn.com/watch/player'))).toBe(true);
	});

	it('classifies a statbroadcast link as stats, not video', () => {
		const stats = events.flatMap((e) => e.links).filter((l) => (l.url ?? '').includes('statbroadcast'));
		for (const s of stats) expect(s.kind).toBe('stats');
	});

	// WMT has no datetime attribute and no opponent/indicator elements of the
	// names the other platforms use; an earlier cut of this parser returned
	// links with no date or opponent at all, which is useless to the matcher.
	it('reads the date from the month-day box', () => {
		expect(events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ''))).toBe(true);
	});

	it('reads the opponent and strips the AP ranking prefix', () => {
		expect(events.every((e) => !!e.opponentName)).toBe(true);
		expect(events.some((e) => (e.opponentName ?? '').startsWith('#'))).toBe(false);
	});

	it('reads home/away from the trailing word of the location block', () => {
		expect(events.some((e) => e.locationSide === 'H' || e.locationSide === 'A')).toBe(true);
	});
});

// WMT is not one markup. The first ACC run found three variants that disagree on
// every class name that matters: Clemson matched 0 of 16 events (no date), and
// Stanford produced 0 links despite matching 15 (different anchor class).
describe('parseWmtSchedule — Clemson variant', () => {
	const events = parseWmtSchedule(clemsonHtml, 'clemsontigers.com', 2026);

	it('reads the date from a <time> with no datetime attribute', () => {
		// The row text runs the day into the venue type ("Aug 23home"), which a
		// \b guard rejects — a digit-to-letter join is not a word boundary.
		expect(events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ''))).toBe(true);
	});

	it('reads the opponent from schedule-event-default__name', () => {
		// Note: Virginia uses schedule-DEFAULT-EVENT__name. Words transposed.
		expect(events.every((e) => !!e.opponentName)).toBe(true);
	});

	it('reads home/away from the venue-type element', () => {
		expect(events.every((e) => e.locationSide !== null)).toBe(true);
	});

	it('extracts the watch links', () => {
		expect(events.some((e) => e.links.some((l) => l.kind === 'video' && l.url))).toBe(true);
	});
});

describe('parseWmtSchedule — Stanford variant', () => {
	const events = parseWmtSchedule(stanfordHtml, 'gostanford.com', 2026);

	it('extracts links classed schedule-event-links__link', () => {
		// Not `schedule-event-ITEM-links__link` like Virginia and Clemson. Missing
		// this cost every Stanford link on the first run.
		const urls = events.flatMap((e) => e.links.filter((l) => l.kind === 'video').map((l) => l.url));
		expect(urls.filter(Boolean).length).toBeGreaterThan(0);
	});

	it('reads date, opponent and side from its own class names', () => {
		expect(events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ''))).toBe(true);
		expect(events.every((e) => !!e.opponentName)).toBe(true);
		expect(events.every((e) => e.locationSide !== null)).toBe(true);
	});

	it('does not mistake the ran-together date block for a day number', () => {
		// The coarse wrapper reads "WedAug 124:00 PM"; taking it would yield day 124.
		expect(events.every((e) => Number((e.date ?? '9999-99-99').slice(8)) <= 31)).toBe(true);
	});
});

// Second conference (WCC) added two more variants. The extraction is now
// position-independent — a real month name anywhere in the row's text, and
// anchors classified by href rather than class — because a per-field fallback
// chain gained a case every conference and was not converging.
describe('parseWmtSchedule — Seattle variant', () => {
	const events = parseWmtSchedule(seattleHtml, 'goseattleu.com', 2026);

	it('takes the opponent, not the scraping school', () => {
		// Seattle renders BOTH teams as .schedule-default-event__name, itself
		// first, so a plain querySelector returned "Seattle U" for every row.
		expect(events.every((e) => e.opponentName && !/seattle u/i.test(e.opponentName))).toBe(true);
	});

	it('reads a date the old month-name-agnostic regex could not', () => {
		// Row text runs together as "FriAug 14Seattle U…"; anchoring on a real
		// month name is what makes "Aug 14" findable in that.
		expect(events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ''))).toBe(true);
	});

	it('finds watch links', () => {
		expect(events.some((e) => e.links.some((l) => l.kind === 'video' && l.url))).toBe(true);
	});
});

describe('parseSidearmHtmlSchedule — LMU variant', () => {
	const events = parseSidearmHtmlSchedule(lmuHtml, 'lmulions.com', 2026);

	it('parses rows that yielded no links at all before', () => {
		expect(events.length).toBeGreaterThan(0);
		expect(events.every((e) => e.date && e.opponentName)).toBe(true);
	});

	it('never returns a link label or a crest filename as the opponent', () => {
		// Structural fallbacks produce "History" (opponent-history link text) and
		// "TigerPaw_Orange_Logo" (the school's own crest) if trusted over the
		// named elements, which is why named elements come first.
		for (const e of events) {
			expect(e.opponentName).not.toMatch(/^history$/i);
			expect(e.opponentName).not.toMatch(/_logo|logo_/i);
		}
	});
});

// The full 578-source sweep produced exactly two parser gaps. Both are covered
// here so the long tail stays covered as templates churn.
describe('parseWmtSchedule — Purdue variant', () => {
	const events = parseWmtSchedule(purdueHtml, 'purduesports.com', 2026);

	it('reads the opponent from schedule-default-event__title', () => {
		// The sweep's ONLY genuine parser gap: 21 rows, 0 usable, because the
		// opponent sits in a __title element no other variant uses.
		expect(events.length).toBeGreaterThan(0);
		expect(events.every((e) => e.date && e.opponentName)).toBe(true);
	});
});

describe('parseSidearmHtmlSchedule — bare .sidearm-schedule-game rows', () => {
	const events = parseSidearmHtmlSchedule(nauHtml, 'stallions.na.edu', 2026);

	it('falls back when rows lack the -row suffix', () => {
		expect(events.length).toBeGreaterThan(0);
		expect(events.every((e) => e.date && e.opponentName)).toBe(true);
	});

	it('does not double-count sites that mark rows both ways', () => {
		// The fallback only fires when the specific class matches nothing, so a
		// page using .sidearm-schedule-game-row is unaffected.
		const butler = parseSidearmHtmlSchedule(butlerHtml, 'butlersports.com', 2026);
		expect(butler.length).toBe(3); // the fixture's row count, not doubled
	});
});

describe('dateFromText', () => {
	it('finds the date in the run-together text these pages produce', () => {
		expect(dateFromText('Aug 10 (Mon)', 2026)).toBe('2026-08-10');
		expect(dateFromText('Sun, Aug 23', 2026)).toBe('2026-08-23');
		expect(dateFromText('Aug 23home', 2026)).toBe('2026-08-23');
		expect(dateFromText('TueAug 11', 2026)).toBe('2026-08-11');
		expect(dateFromText('September 4', 2026)).toBe('2026-09-04');
	});

	it('refuses a day that has run into a kickoff time, rather than guessing', () => {
		// Stanford's coarse date wrapper reads "WedAug 124:00 PM" — Aug 12 at
		// 4:00 PM, but "124" could equally be day 1 + "24:00". The old pattern
		// confidently returned day 124. Null is the deliberate outcome: a wrong
		// date attaches a link to the WRONG game, whereas null just queues the
		// event for review. The narrow-selector-first ordering in dateFromRow
		// means we almost never fall through to text this coarse.
		expect(dateFromText('WedAug 124:00 PM', 2026)).toBeNull();
	});

	it('returns null on text with no month', () => {
		expect(dateFromText('TBD', 2026)).toBeNull();
		expect(dateFromText('12 34', 2026)).toBeNull();
		expect(dateFromText(null, 2026)).toBeNull();
	});

	it('rejects an impossible calendar date', () => {
		expect(dateFromText('Feb 30', 2026)).toBeNull();
	});
});

describe('cleanOpponent', () => {
	it('strips the decoration schools add around a team name', () => {
		expect(cleanOpponent('#16 High Point')).toBe('High Point');
		expect(cleanOpponent('Boston College (ACC)')).toBe('Boston College');
		expect(cleanOpponent('#1 Duke (ACC)')).toBe('Duke');
		expect(cleanOpponent('at Notre Dame')).toBe('Notre Dame');
	});
	it('leaves a plain name alone and handles empties', () => {
		expect(cleanOpponent('Coastal Carolina')).toBe('Coastal Carolina');
		expect(cleanOpponent('')).toBeNull();
		expect(cleanOpponent(null)).toBeNull();
	});
});

// ── matcher ─────────────────────────────────────────────────────────────────
const game = (id: number, contestDate: string, opponentNames: string[], side: 'home' | 'away' = 'home'): CandidateGame =>
	({ id, contestDate, opponentNames, side });

const event = (date: string | null, opponentName: string | null): never extends never ? Parameters<typeof matchScheduleEvents>[0][number] : never =>
	({ externalEventId: null, date, locationSide: null, opponentName, carrierRaw: null, links: [] });

describe('opponentMatches', () => {
	it('accepts exact and containment forms', () => {
		expect(opponentMatches('Coastal Carolina', ['Coastal Carolina'])).toBe(true);
		expect(opponentMatches('Duke', ['Duke Blue Devils'])).toBe(true);
		expect(opponentMatches('North Carolina State', ['NC State', 'North Carolina State'])).toBe(true);
	});
	it('rejects a genuinely different opponent', () => {
		expect(opponentMatches('Duke', ['North Carolina'])).toBe(false);
		expect(opponentMatches(null, ['Duke'])).toBe(false);
	});
});

describe('matchScheduleEvents', () => {
	it('matches on date alone when the date is unique, which is the 99.8% case', () => {
		const r = matchScheduleEvents([event('2026-09-05', 'Virginia Tech')], [game(11, '2026-09-05', ['Virginia Tech'])]);
		expect(r[0]).toMatchObject({ status: 'matched', gameId: 11, sourceSide: 'home' });
		expect(r[0].reason).toBe('date + opponent');
	});

	it('still matches when the school abbreviates an opponent we do not recognize', () => {
		const r = matchScheduleEvents([event('2026-09-05', 'VT')], [game(11, '2026-09-05', ['Virginia Tech'])]);
		expect(r[0].status).toBe('matched');
		expect(r[0].reason).toContain('opponent name unrecognized');
	});

	it('uses the opponent to split a doubleheader', () => {
		const games = [game(1, '2026-09-05', ['Duke']), game(2, '2026-09-05', ['Elon'])];
		const r = matchScheduleEvents([event('2026-09-05', 'Elon')], games);
		expect(r[0]).toMatchObject({ status: 'matched', gameId: 2 });
	});

	it('flags a doubleheader it cannot split rather than picking one', () => {
		const games = [game(1, '2026-09-05', ['Duke']), game(2, '2026-09-05', ['Elon'])];
		const r = matchScheduleEvents([event('2026-09-05', 'Someone Else')], games);
		expect(r[0].status).toBe('ambiguous');
		expect(r[0].gameId).toBeNull();
		expect(r[0].suggestedGameId).toBe(1);
	});

	it('recovers a date that is off by one, but only with an opponent confirmation', () => {
		const games = [game(7, '2026-09-06', ['Hawaii'])];
		expect(matchScheduleEvents([event('2026-09-05', 'Hawaii')], games)[0])
			.toMatchObject({ status: 'matched', gameId: 7 });
		// Without the opponent confirming, the neighbouring date is not enough.
		expect(matchScheduleEvents([event('2026-09-05', 'Someone Else')], games)[0].status)
			.toBe('unmatched');
	});

	it('never invents a game', () => {
		const r = matchScheduleEvents([event('2026-12-25', 'Nobody')], [game(1, '2026-09-05', ['Duke'])]);
		expect(r[0]).toMatchObject({ status: 'unmatched', gameId: null });
	});

	it('handles an undateable event', () => {
		expect(matchScheduleEvents([event(null, 'Duke')], [game(1, '2026-09-05', ['Duke'])])[0])
			.toMatchObject({ status: 'unmatched' });
	});

	it('returns exactly one result per event, in order', () => {
		const events = [event('2026-09-05', 'A'), event(null, 'B'), event('2026-12-25', 'C')];
		const r = matchScheduleEvents(events, [game(1, '2026-09-05', ['A'])]);
		expect(r.length).toBe(3);
		expect(r.map((x) => x.event.opponentName)).toEqual(['A', 'B', 'C']);
	});
});
