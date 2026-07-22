import type { PageServerLoad } from './$types';
import { listPublishedArticles, type ArticleSport } from '$lib/server/articles';

/** Narrow a raw ?sport= query value to a valid sport, else undefined (= All). */
function parseSport(raw: string | null): ArticleSport | undefined {
	return raw === 'MSO' || raw === 'WSO' ? raw : undefined;
}

// News homepage. Featured = most recent published article; the next few stream
// beneath it. RLS (via locals.supabase) ensures only published rows are returned.
const FEATURED = 1;
// Card counts are multiples of 6 so the 1/2/3-column grid never has a ragged
// last row (6 = LCM of 1, 2, 3). "Load more" also fetches 6 (see /api/news).
const INITIAL_CARDS = 6;

export const load: PageServerLoad = async ({ locals, url }) => {
	const sport = parseSport(url.searchParams.get('sport'));

	// Fetch featured + initial cards in one query.
	const { rows, hasMore } = await listPublishedArticles(locals.supabase, {
		offset: 0,
		limit: FEATURED + INITIAL_CARDS,
		sport
	});

	const featured = rows[0] ?? null;
	const cards = rows.slice(1);

	return {
		featured,
		cards,
		hasMore,
		nextOffset: rows.length,
		sport: sport ?? null
	};
};
