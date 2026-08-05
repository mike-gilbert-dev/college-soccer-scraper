import type { Handle, HandleServerError } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/supabase';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { getPostHogClient } from '$lib/server/posthog';

// Only these paths require an authenticated admin.
// Everything else is public.
const ADMIN_PATHS = ['/admin', '/api/scrape', '/api/admin'];

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Reverse proxy for PostHog — route /ingest requests to PostHog servers
	if (pathname.startsWith('/ingest')) {
		const useAssetHost = pathname.startsWith('/ingest/static/') || pathname.startsWith('/ingest/array/');
		const hostname = useAssetHost ? 'us-assets.i.posthog.com' : 'us.i.posthog.com';

		const url = new URL(event.request.url);
		url.protocol = 'https:';
		url.hostname = hostname;
		url.port = '443';
		url.pathname = pathname.replace(/^\/ingest/, '');

		const headers = new Headers(event.request.headers);
		headers.set('host', hostname);
		headers.set('accept-encoding', '');

		const clientIp = event.request.headers.get('x-forwarded-for') || event.getClientAddress();
		if (clientIp) {
			headers.set('x-forwarded-for', clientIp);
		}

		const response = await fetch(url.toString(), {
			method: event.request.method,
			headers,
			body: event.request.body,
			// @ts-expect-error - duplex is required for streaming request bodies
			duplex: 'half'
		});

		return response;
	}

	event.locals.supabase = createSupabaseServerClient(event.cookies);
	event.locals.isAdmin = false;
	event.locals.username = null;
	event.locals.usernameIsGenerated = false;

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
			.select('is_admin, username, username_is_generated')
			.eq('id', user.id)
			.single();

		event.locals.isAdmin             = profile?.is_admin ?? false;
		event.locals.username            = profile?.username ?? null;
		event.locals.usernameIsGenerated = profile?.username_is_generated ?? false;
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

export const handleError: HandleServerError = async ({ error, status, message }) => {
	const posthog = getPostHogClient();

	posthog.capture({
		distinctId: 'server',
		event: 'server_error',
		properties: {
			error: error instanceof Error ? error.message : String(error),
			status,
			message
		}
	});

	return { message, status };
};
