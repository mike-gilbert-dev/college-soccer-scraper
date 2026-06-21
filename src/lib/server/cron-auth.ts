import { env } from '$env/dynamic/private';

/**
 * Authorizes a request coming from Vercel Cron (or a manual trigger).
 *
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on scheduled
 * invocations when the CRON_SECRET env var is set. We require that secret so the
 * pipeline endpoints can run without an interactive Supabase session while staying
 * closed to the public.
 *
 * Returns null when authorized, or an HTTP status code to respond with otherwise.
 */
export function authorizeCron(request: Request): number | null {
	const secret = env.CRON_SECRET;
	if (!secret) {
		// Misconfiguration — fail closed rather than allow unauthenticated runs.
		return 503;
	}
	const auth = request.headers.get('authorization');
	if (auth !== `Bearer ${secret}`) return 401;
	return null;
}
