import type { PageServerLoad, Actions } from './$types';
import { error, redirect, fail } from '@sveltejs/kit';
import { getArticleForAdmin, deleteArticle } from '$lib/server/articles';
import { loadAllTeams } from '$lib/server/article-teams-load';
import { saveArticleFromForm, toFail } from '$lib/server/article-form';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');
	const article = await getArticleForAdmin(id);
	if (!article) throw error(404, 'Article not found');
	const allTeams = await loadAllTeams();
	return { article, allTeams };
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const id = Number(params.id);
		const result = await saveArticleFromForm(request, id);
		if (!result.ok) return toFail(result);
		redirect(303, `/admin/news/${result.id}?saved=1`);
	},
	delete: async ({ params }) => {
		const id = Number(params.id);
		if (!id) return fail(400, { error: 'missing id' });
		try {
			await deleteArticle(id);
		} catch (e) {
			return fail(500, { error: e instanceof Error ? e.message : String(e) });
		}
		redirect(303, '/admin/news');
	}
};
