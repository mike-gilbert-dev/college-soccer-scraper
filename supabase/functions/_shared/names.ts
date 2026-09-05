// Name normalization shared by the roster matcher and the schedule matcher.
//
// Extracted from roster-match.ts so schedule-match.ts can reuse the exact same
// comparison without importing the roster matching engine (and, through it, the
// Sidearm roster types) into the webstream pipeline.
//
// roster-match.ts re-exports this, so existing importers are unaffected.

/** Normalize a name for comparison: strip diacritics, lowercase, drop punctuation. */
export function normalizeName(s: string | null | undefined): string {
	return (s ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // combining marks (diacritics)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
		.replace(/\s+/g, ' ')
		.trim();
}
