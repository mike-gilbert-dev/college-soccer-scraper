import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getPublishedArticleBySlug, getArticleForAdmin } from '$lib/server/articles';
import { renderMarkdown } from '$lib/server/markdown';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { slug } = params;

	// Public path: RLS ensures only published rows return.
	let article = await getPublishedArticleBySlug(locals.supabase, slug);
	let isDraftPreview = false;

	// Admin fallback: allow previewing a draft at its real URL.
	if (!article && locals.isAdmin) {
		const draft = await getArticleForAdmin(slug);
		if (draft) {
			article = draft;
			isDraftPreview = draft.status !== 'published';
		}
	}

	// Non-existent (or a draft for a non-admin) → real 404.
	if (!article) throw error(404, 'Article not found');

	const bodyHtml = renderMarkdown(article.body_markdown);

	return { article, bodyHtml, isDraftPreview };
};
