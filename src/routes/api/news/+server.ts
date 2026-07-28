// Public "load more" endpoint for the news homepage. RLS-gated via
// locals.supabase (publishable key) → only published articles return.

import { json } from '@sveltejs/kit';
import {
	listPublishedArticles,
	listPublishedArticlesForTeam,
	type ArticleSport
} from '$lib/server/articles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
	const rawLimit = parseInt(url.searchParams.get('limit') ?? '6', 10) || 6;
	const limit = Math.min(24, Math.max(1, rawLimit)); // clamp 1..24
	const sportRaw = url.searchParams.get('sport');
	const sport: ArticleSport | undefined = sportRaw === 'MSO' || sportRaw === 'WSO' ? sportRaw : undefined;

	// ?team=<internal teams.id> scopes the feed to one team's tagged articles
	// (used by the News tab on team pages); otherwise the site-wide news feed.
	const teamRaw = url.searchParams.get('team');
	const teamId = teamRaw ? parseInt(teamRaw, 10) : NaN;

	const { rows, hasMore } = Number.isFinite(teamId)
		? await listPublishedArticlesForTeam(locals.supabase, { teamId, offset, limit, sport })
		: await listPublishedArticles(locals.supabase, { offset, limit, sport });
	return json({ articles: rows, hasMore, nextOffset: offset + rows.length });
};
