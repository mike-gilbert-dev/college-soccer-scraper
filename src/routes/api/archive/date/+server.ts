import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchRawContests } from '$lib/server/ncaa-api';
import { saveContestJson } from '$lib/server/ncaa-archive';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const { sportCode, division, seasonLabel, contestDate } = await request.json() as {
		sportCode: string;
		division: number;
		seasonLabel: string;
		contestDate: string; // YYYY-MM-DD
	};

	if (!sportCode || !division || !seasonLabel || !contestDate) {
		error(400, 'sportCode, division, seasonLabel, and contestDate are required');
	}

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.select('year')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) error(400, `Season "${seasonLabel}" not found`);

	const [yyyy, mm, dd] = contestDate.split('-');
	const ncaaDate = `${mm}/${dd}/${yyyy}`;

	const raw = await fetchRawContests({
		contestDate: ncaaDate,
		seasonYear: season.year,
		division,
		sportCode
	});

	const contests = (raw as { data?: { contests?: unknown[] } })?.data?.contests ?? [];

	const { path } = await saveContestJson(sportCode, division, season.year, contestDate, raw);

	return json({ path, gamesCount: contests.length, contestDate });
};
