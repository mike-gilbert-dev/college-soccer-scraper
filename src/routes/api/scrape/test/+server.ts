import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchRawContests } from '$lib/server/ncaa-api';

// GET /api/scrape/test?date=2025-10-11&seasonYear=2025&division=1
// Returns the raw NCAA API response so we can verify the actual field names.
export const GET: RequestHandler = async ({ url, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const dateParam   = url.searchParams.get('date');
	const seasonYear  = parseInt(url.searchParams.get('seasonYear') ?? '2025');
	const division    = parseInt(url.searchParams.get('division')   ?? '1');

	if (!dateParam) error(400, 'date param required (YYYY-MM-DD)');

	// Convert YYYY-MM-DD → MM/DD/YYYY
	const [y, m, d] = dateParam.split('-');
	const ncaaDate = `${m}/${d}/${y}`;

	const raw = await fetchRawContests({ contestDate: ncaaDate, seasonYear, division });
	return json(raw);
};
