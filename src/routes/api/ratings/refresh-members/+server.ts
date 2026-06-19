import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const { sportCode, division, seasonLabel } = (await request.json()) as {
		sportCode: string;
		division: number;
		seasonLabel: string;
	};

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.select('id')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) {
		return json({ error: `Season not found: ${seasonLabel}` }, { status: 400 });
	}

	const { data, error: rpcErr } = await supabaseAdmin.rpc('refresh_division_members', {
		p_sport_code: sportCode,
		p_division: division,
		p_season_id: season.id
	});

	if (rpcErr) {
		return json({ error: rpcErr.message }, { status: 500 });
	}

	// refresh_division_members RETURNS TABLE, so data is an array with one row.
	const row = Array.isArray(data) ? data[0] : data;
	return json({
		members: Number(row?.members ?? 0),
		nonMembers: Number(row?.non_members ?? 0)
	});
};
