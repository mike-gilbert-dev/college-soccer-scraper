import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const data = await request.formData();
		const email = data.get('email') as string;

		const { error } = await locals.supabase.auth.resetPasswordForEmail(email, {
			redirectTo: `${url.origin}/reset-password`
		});

		if (error) return fail(400, { error: error.message });

		return { sent: true };
	}
};
