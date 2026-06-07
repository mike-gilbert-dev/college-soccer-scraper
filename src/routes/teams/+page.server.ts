import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ url }) => {
	const sport      = url.searchParams.get('sport')    ?? 'MSO';
	const division   = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonYear = parseInt(url.searchParams.get('season')   ?? '2025', 10);

	const { data: season } = await supabaseAdmin
		.from('seasons')
		.select('id')
		.eq('year', seasonYear)
		.single();

	if (!season) {
		return { teams: [], sport, division, seasonYear };
	}

	const { data: teams } = await supabaseAdmin
		.from('team_seasons')
		.select(`
			id,
			division,
			sport_code,
			team:teams ( id, ncaa_team_id, name, short_name ),
			conference:conferences ( name, short_name )
		`)
		.eq('season_id', season.id)
		.eq('division', division)
		.eq('sport_code', sport)
		.order('name', { referencedTable: 'teams' });

	return {
		teams: (teams ?? []) as unknown as {
			id: number;
			division: number;
			sport_code: string;
			team: { id: number; ncaa_team_id: string; name: string; short_name: string };
			conference: { name: string; short_name: string } | null;
		}[],
		sport,
		division,
		seasonYear
	};
};
