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
			team:teams ( id, ncaa_team_id, name, short_name, logo_url_dark, logo_url_light ),
			conference:conferences ( name, short_name )
		`)
		.eq('season_id', season.id)
		.eq('division', division)
		.eq('sport_code', sport);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const sorted = (teams ?? []).sort((a, b) =>
		((a.team as any)?.name as string ?? '').localeCompare((b.team as any)?.name as string ?? '')
	);

	return {
		teams: sorted as unknown as {
			id: number;
			division: number;
			sport_code: string;
			team: { id: number; ncaa_team_id: string; name: string; short_name: string; logo_url_dark: string | null; logo_url_light: string | null };
			conference: { name: string; short_name: string } | null;
		}[],
		sport,
		division,
		seasonYear
	};
};
