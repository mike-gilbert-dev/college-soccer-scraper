import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ url }) => {
	return { reason: url.searchParams.get('reason') };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const data = await request.formData();
		const email    = data.get('email')    as string;
		const password = data.get('password') as string;

		const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
		if (error) return fail(400, { error: error.message });

		// Verify admin status immediately — don't let non-admins through
		const { data: { user } } = await locals.supabase.auth.getUser();
		if (user) {
			const { data: profile } = await supabaseAdmin
				.from('profiles')
				.select('is_admin')
				.eq('id', user.id)
				.single();

			if (!profile?.is_admin) {
				await locals.supabase.auth.signOut();
				return fail(403, { error: 'Your account does not have permission to access this application.' });
			}
		}

		redirect(303, '/');
	}
};
