// Public "load more" endpoint for the news homepage. RLS-gated via
// locals.supabase (publishable key) → only published articles return.

import { json } from '@sveltejs/kit';
import { listPublishedArticles, type ArticleSport } from '$lib/server/articles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
	const rawLimit = parseInt(url.searchParams.get('limit') ?? '6', 10) || 6;
	const limit = Math.min(24, Math.max(1, rawLimit)); // clamp 1..24
	const sportRaw = url.searchParams.get('sport');
	const sport: ArticleSport | undefined = sportRaw === 'MSO' || sportRaw === 'WSO' ? sportRaw : undefined;

	const { rows, hasMore } = await listPublishedArticles(locals.supabase, { offset, limit, sport });
	return json({ articles: rows, hasMore, nextOffset: offset + rows.length });
};
