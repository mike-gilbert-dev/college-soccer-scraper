import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listArchivedDates, listArchivedBoxScoreIds } from '$lib/server/ncaa-archive';
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
		.select('id, year, start_date, end_date')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) error(400, `Season "${seasonLabel}" not found`);

	const [archivedDates, archivedBoxScoreIds, { count: dbGamesCount }] = await Promise.all([
		listArchivedDates(sportCode, division, season.year),
		listArchivedBoxScoreIds(sportCode, division, season.year),
		supabaseAdmin
			.from('games')
			.select('*', { count: 'exact', head: true })
			.eq('season_id', season.id)
			.eq('sport_code', sportCode)
			.eq('division', division)
	]);

	return json({
		archivedGameFiles: archivedDates.length,
		archivedBoxScores: archivedBoxScoreIds.length,
		dbGamesCount:      dbGamesCount ?? 0,
		seasonYear:        season.year,
		startDate:         season.start_date,
		endDate:           season.end_date
	});
};
