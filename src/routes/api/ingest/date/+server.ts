import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ingestDate } from '$lib/server/ingest';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const { sportCode, division, seasonLabel, contestDate } = await request.json() as {
		sportCode: string;
		division: number;
		seasonLabel: string;
		contestDate: string;
	};

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.select('id, year')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) {
		return json({ error: `Season not found: ${seasonLabel}` }, { status: 400 });
	}

	const results = await ingestDate({
		sportCode,
		division,
		seasonId: season.id,
		seasonYear: season.year,
		contestDate
	});

	return json(results);
};
