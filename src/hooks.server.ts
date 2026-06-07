import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/supabase';
import { supabaseAdmin } from '$lib/server/supabase-admin';

// Routes that do not require authentication or admin status
const PUBLIC_PATHS = ['/login', '/register', '/logout'];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createSupabaseServerClient(event.cookies);
	event.locals.isAdmin = false;

	event.locals.safeGetSession = async () => {
		const { data: { session } } = await event.locals.supabase.auth.getSession();
		if (!session) return { session: null, user: null };

		const { data: { user }, error } = await event.locals.supabase.auth.getUser();
		if (error) return { session: null, user: null };

		return { session, user };
	};

	const isPublicPath = PUBLIC_PATHS.some(p => event.url.pathname.startsWith(p));

	if (!isPublicPath) {
		const { user } = await event.locals.safeGetSession();

		if (!user) {
			redirect(303, '/login');
		}

		const { data: profile } = await supabaseAdmin
			.from('profiles')
			.select('is_admin')
			.eq('id', user.id)
			.single();

		if (!profile?.is_admin) {
			redirect(303, '/login?reason=unauthorized');
		}

		event.locals.isAdmin = true;
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
