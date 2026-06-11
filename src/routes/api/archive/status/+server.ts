import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listArchivedDates } from '$lib/server/ncaa-archive';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const GET: RequestHandler = async ({ url, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const sportCode   = url.searchParams.get('sportCode')   ?? 'MSO';
	const division    = Number(url.searchParams.get('division') ?? 1);
	const seasonLabel = url.searchParams.get('seasonLabel') ?? '';

	if (!seasonLabel) error(400, 'seasonLabel is required');

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.select('year, start_date, end_date')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) error(400, `Season "${seasonLabel}" not found`);

	const archivedDates = await listArchivedDates(sportCode, division, season.year);

	return json({
		archivedDates,
		seasonYear: season.year,
		startDate:  season.start_date,
		endDate:    season.end_date
	});
};
