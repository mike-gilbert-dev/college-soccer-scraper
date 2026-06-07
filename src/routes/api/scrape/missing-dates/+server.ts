import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const GET: RequestHandler = async ({ url, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const sportCode  = url.searchParams.get('sport')    ?? 'MSO';
	const division   = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonYear = parseInt(url.searchParams.get('season')   ?? '2025', 10);

	const { data, error: rpcError } = await supabaseAdmin.rpc('get_dates_missing_player_stats', {
		p_sport_code:  sportCode,
		p_division:    division,
		p_season_year: seasonYear
	});

	if (rpcError) error(500, rpcError.message);

	return json(data ?? []);
};
