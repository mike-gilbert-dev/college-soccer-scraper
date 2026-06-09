import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const GET: RequestHandler = async ({ url, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const sportCode   = url.searchParams.get('sport')    ?? 'MSO';
	const division    = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonLabel = url.searchParams.get('season') ?? '';

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.select('id')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) error(400, `Season "${seasonLabel}" not found`);

	const { data, error: rpcError } = await supabaseAdmin.rpc('get_games_missing_player_stats', {
		p_sport_code: sportCode,
		p_division:   division,
		p_season_id:  season.id
	});

	if (rpcError) error(500, rpcError.message);

	return json(data ?? []);
};
