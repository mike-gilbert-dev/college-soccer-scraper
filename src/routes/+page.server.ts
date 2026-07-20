import type { PageServerLoad } from './$types';
import { listPublishedArticles } from '$lib/server/articles';

// News homepage. Featured = most recent published article; the next few stream
// beneath it. RLS (via locals.supabase) ensures only published rows are returned.
const FEATURED = 1;
const INITIAL_CARDS = 4; // featured + 4, then "load more" fetches 8 (see /api/news)

export const load: PageServerLoad = async ({ locals }) => {
	// Fetch featured + initial cards in one query.
	const { rows, hasMore } = await listPublishedArticles(locals.supabase, {
		offset: 0,
		limit: FEATURED + INITIAL_CARDS
	});

	const featured = rows[0] ?? null;
	const cards = rows.slice(1);

	return {
		featured,
		cards,
		hasMore,
		nextOffset: rows.length
	};
};
