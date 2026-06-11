import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchRawBoxScore, sleep } from '$lib/server/ncaa-api';
import { readGameContestIds, saveBoxScoreJson } from '$lib/server/ncaa-archive';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const { sportCode, division, seasonLabel, contestDate, delayMs = 1000 } = await request.json() as {
		sportCode: string;
		division: number;
		seasonLabel: string;
		contestDate: string; // YYYY-MM-DD
		delayMs?: number;
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

	const contestIds = await readGameContestIds(sportCode, division, season.year, contestDate);

	let saved = 0;
	const errors: { contestId: string; message: string }[] = [];

	for (let i = 0; i < contestIds.length; i++) {
		const contestId = contestIds[i];
		try {
			const raw = await fetchRawBoxScore(contestId);
			await saveBoxScoreJson(sportCode, division, season.year, contestId, raw);
			saved++;
		} catch (e) {
			errors.push({ contestId, message: e instanceof Error ? e.message : String(e) });
		}
		if (delayMs > 0 && i < contestIds.length - 1) {
			await sleep(delayMs);
		}
	}

	return json({ contestDate, contestsFound: contestIds.length, saved, errors });
};
