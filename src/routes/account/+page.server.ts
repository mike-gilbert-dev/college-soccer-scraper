import { fail, redirect } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { validateUsername, usernameErrorMessage } from '$lib/username';
import type { Actions, PageServerLoad } from './$types';

const COOLDOWN_DAYS = 30;

/** When the next username change becomes allowed, or null if it already is. */
function cooldownUntil(changedAt: string | null, isGenerated: boolean): string | null {
	if (isGenerated || !changedAt) return null;
	const unlocks = new Date(changedAt);
	unlocks.setDate(unlocks.getDate() + COOLDOWN_DAYS);
	return unlocks > new Date() ? unlocks.toISOString() : null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) redirect(303, '/login');

	const { data: profile } = await supabaseAdmin
		.from('profiles')
		.select('username, username_changed_at, username_is_generated')
		.eq('id', user.id)
		.single();

	return {
		email: user.email ?? '',
		username: profile?.username ?? '',
		usernameIsGenerated: profile?.username_is_generated ?? false,
		cooldownUntil: cooldownUntil(
			profile?.username_changed_at ?? null,
			profile?.username_is_generated ?? false
		)
	};
};

export const actions: Actions = {
	username: async ({ request, locals }) => {
		const { user } = await locals.safeGetSession();
		if (!user) redirect(303, '/login');

		const username = ((await request.formData()).get('username') as string ?? '').trim();

		const formatError = validateUsername(username);
		if (formatError) {
			return fail(400, { section: 'username', error: usernameErrorMessage(formatError) });
		}

		// set_username is the only write path for profiles.username — it enforces
		// the cooldown, the reserved list and the history hold atomically.
		const { data: result, error } = await locals.supabase.rpc('set_username', {
			p_username: username
		});

		if (error) {
			return fail(500, { section: 'username', error: 'Could not update your username.' });
		}

		switch (result) {
			case 'ok':
				return { section: 'username', message: `Username updated to ${username}.` };
			case 'taken':
				return fail(400, { section: 'username', error: 'That username is already taken.' });
			case 'reserved':
				return fail(400, {
					section: 'username',
					error: 'That username is reserved or was recently in use.'
				});
			case 'cooldown':
				return fail(400, {
					section: 'username',
					error: `You can only change your username once every ${COOLDOWN_DAYS} days.`
				});
			case 'unauthenticated':
				redirect(303, '/login');
			default:
				return fail(400, { section: 'username', error: 'That username is not valid.' });
		}
	},

	email: async ({ request, locals }) => {
		const { user } = await locals.safeGetSession();
		if (!user) redirect(303, '/login');

		const email = ((await request.formData()).get('email') as string ?? '').trim();
		if (!email) {
			return fail(400, { section: 'email', error: 'Enter an email address.' });
		}

		const { error } = await locals.supabase.auth.updateUser({ email });
		if (error) {
			return fail(400, { section: 'email', error: error.message });
		}

		return {
			section: 'email',
			message: `Confirmation sent to ${email}. Your address changes once you click that link.`
		};
	},

	password: async ({ request, locals }) => {
		const { user } = await locals.safeGetSession();
		if (!user) redirect(303, '/login');

		const password = (await request.formData()).get('password') as string;
		if (!password || password.length < 8) {
			return fail(400, { section: 'password', error: 'Password must be at least 8 characters.' });
		}

		const { error } = await locals.supabase.auth.updateUser({ password });
		if (error) {
			return fail(400, { section: 'password', error: error.message });
		}

		return { section: 'password', message: 'Password updated.' };
	}
};
