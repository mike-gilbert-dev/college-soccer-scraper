import { fail } from '@sveltejs/kit';
import { validateUsername, usernameErrorMessage } from '$lib/username';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const data = await request.formData();
		const email = data.get('email') as string;
		const password = data.get('password') as string;
		const username = ((data.get('username') as string) ?? '').trim();

		// Format + reserved-word check first, so an obviously bad name never costs
		// a round trip. The SQL check constraint is the real backstop.
		const formatError = validateUsername(username);
		if (formatError) {
			return fail(400, { error: usernameErrorMessage(formatError), email, username });
		}

		const { data: available, error: availabilityError } = await locals.supabase.rpc(
			'username_available',
			{ p_username: username }
		);

		if (availabilityError) {
			return fail(500, { error: 'Could not check that username. Try again.', email, username });
		}

		if (!available) {
			return fail(400, { error: 'That username is already taken.', email, username });
		}

		// The username rides along as user metadata; handle_new_user() reads it off
		// raw_user_meta_data and writes the profile row.
		const { error } = await locals.supabase.auth.signUp({
			email,
			password,
			options: { data: { username } }
		});

		if (error) {
			// Small race between the availability check above and the insert: another
			// signup could have claimed the name in between. Surface it readably
			// rather than leaking a Postgres unique-violation.
			const message = /duplicate key|unique constraint|23505/i.test(error.message)
				? 'That username was just taken — try another.'
				: error.message;
			return fail(400, { error: message, email, username });
		}

		return { message: 'Check your email to confirm your account.' };
	}
};
