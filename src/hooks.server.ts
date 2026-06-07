import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/supabase';
import { supabaseAdmin } from '$lib/server/supabase-admin';

// Only these paths require an authenticated admin.
// Everything else is public.
const ADMIN_PATHS = ['/admin', '/api/scrape'];

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

	// Always resolve admin status for authenticated users so the navbar can use it.
	const { user } = await event.locals.safeGetSession();

	if (user) {
		const { data: profile } = await supabaseAdmin
			.from('profiles')
			.select('is_admin')
			.eq('id', user.id)
			.single();

		event.locals.isAdmin = profile?.is_admin ?? false;
	}

	// Enforce admin-only access on protected paths.
	const requiresAdmin = ADMIN_PATHS.some(p => event.url.pathname.startsWith(p));

	if (requiresAdmin) {
		if (!user) redirect(303, '/login');
		if (!event.locals.isAdmin) redirect(303, '/login?reason=unauthorized');
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
