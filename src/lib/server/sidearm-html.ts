// Parser for the OLDER Sidearm platform (ASP.NET + Knockout), which renders the
// roster as server-side .sidearm-roster-player cards instead of exposing the
// NextGen /api/v2/Rosters JSON API. Produces the same ParsedRosterPlayer shape as
// sidearm.ts so the matcher/enrichment pipeline is reused unchanged.
//
// Works in Node (tests) and Deno edge runtime (via `npm:node-html-parser`).

import { parse } from 'node-html-parser';
import { normalizeClassYear, type ParsedRosterPlayer } from './sidearm.ts';

const clean = (s: string | null | undefined): string | null => {
	const t = (s ?? '').replace(/\s+/g, ' ').trim();
	return t.length ? t : null;
};

/** "6'3\"" / "6' 3\"" -> "6-3"; "6-3" stays; else null. */
function normHeight(s: string | null): string | null {
	if (!s) return null;
	const m = s.match(/(\d+)\D+(\d+)/);
	return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Parse an old-Sidearm roster page's HTML into normalized players.
 * @param html  raw roster page HTML
 * @param domain  host (to absolutize relative headshot URLs)
 */
export function parseSidearmHtmlRoster(html: string, domain: string): ParsedRosterPlayer[] {
	const root = parse(html);
	const cards = root.querySelectorAll('.sidearm-roster-player');
	const out: ParsedRosterPlayer[] = [];
	const seen = new Set<string>();

	for (const card of cards) {
		// A real (rendered) card has a player profile link ending in /<id>.
		let id: string | null = null;
		let nameFromLink = '';
		for (const a of card.querySelectorAll('a')) {
			const href = a.getAttribute('href') ?? '';
			const m = href.match(/\/roster\/[^/]+\/(\d+)(?:[/?#]|$)/);
			if (m) {
				id = m[1];
				if (!nameFromLink) nameFromLink = clean(a.text) ?? '';
			}
		}
		if (!id || seen.has(id)) continue; // skip Knockout templates / duplicates

		const nameEl = card.querySelector('.sidearm-roster-player-name');
		let name = nameFromLink || clean(nameEl?.text) || '';
		name = name.replace(/^#?\d+\s+/, '').trim(); // drop any leading jersey
		if (!name) continue;
		seen.add(id);

		const t = (sel: string) => clean(card.querySelector(sel)?.text ?? null);
		const jerseyTxt = t('.sidearm-roster-player-jersey-number') ?? t('.sidearm-roster-player-jersey');
		const jersey = jerseyTxt ? parseInt(jerseyTxt.replace(/[^0-9]/g, ''), 10) : NaN;

		// position text-bold is e.g. "GK" | "Goalkeeper GK" | "GK GK" | "Forward F";
		// the short code is always the last token.
		const posRaw = t('.sidearm-roster-player-position .text-bold');
		const position = posRaw ? posRaw.split(/\s+/).pop()! : null;

		const [firstName, ...rest] = name.split(/\s+/);
		const img = card.querySelector('.sidearm-roster-player-image img') ?? card.querySelector('img');
		let headshot = img?.getAttribute('data-src') ?? img?.getAttribute('src') ?? null;
		if (headshot && headshot.startsWith('/')) headshot = `https://${domain}${headshot}`;

		out.push({
			firstName: firstName ?? '',
			lastName: rest.join(' '),
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
