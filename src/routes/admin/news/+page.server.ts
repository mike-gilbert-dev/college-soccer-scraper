import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { listArticlesForAdmin, deleteArticle } from '$lib/server/articles';

// Admin-only (enforced in hooks.server.ts for all /admin paths).
export const load: PageServerLoad = async () => {
	const articles = await listArticlesForAdmin();
	return { articles };
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'missing id' });
		try {
			await deleteArticle(id);
		} catch (e) {
			return fail(500, { error: e instanceof Error ? e.message : String(e) });
		}
		return { success: `Deleted article ${id}` };
	}
};
