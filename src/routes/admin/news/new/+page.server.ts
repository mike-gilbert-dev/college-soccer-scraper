import type { PageServerLoad, Actions } from './$types';
import { redirect } from '@sveltejs/kit';
import { loadAllTeams } from '$lib/server/article-teams-load';
import { saveArticleFromForm, toFail } from '$lib/server/article-form';

export const load: PageServerLoad = async () => {
	return { allTeams: await loadAllTeams() };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const result = await saveArticleFromForm(request, null);
		if (!result.ok) return toFail(result);
		redirect(303, `/admin/news/${result.id}?saved=1`);
	}
};
