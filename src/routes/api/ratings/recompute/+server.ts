import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { recomputeRatings } from '$lib/server/ratings/recompute';
import type { RatingSystem } from '$lib/server/ratings/types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const { sportCode, division, seasonLabel, systems } = (await request.json()) as {
		sportCode: string;
		division: number;
		seasonLabel: string;
		systems?: RatingSystem[];
	};

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.select('id')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) {
		return json({ error: `Season not found: ${seasonLabel}` }, { status: 400 });
	}

	try {
		const result = await recomputeRatings({
			sportCode,
			division,
			seasonId: season.id,
			systems: systems && systems.length > 0 ? systems : ['elo']
		});
		return json(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return json({ error: message }, { status: 500 });
	}
};
