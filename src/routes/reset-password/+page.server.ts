import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	if (!code) return { error: 'Missing or invalid reset link.' };

	const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
	if (error) return { error: 'This reset link has expired or already been used.' };

	return {};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const data = await request.formData();
		const password = data.get('password') as string;
		const confirm  = data.get('confirm')  as string;

		if (password !== confirm) return fail(400, { error: 'Passwords do not match.' });
		if (password.length < 6)  return fail(400, { error: 'Password must be at least 6 characters.' });

		const { error } = await locals.supabase.auth.updateUser({ password });
		if (error) return fail(400, { error: error.message });

		await locals.supabase.auth.signOut();
		redirect(303, '/login?reason=password-updated');
	}
};
