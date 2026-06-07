import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async () => {
	const [
		{ count: gameCount },
		{ count: teamCount },
		{ count: finalCount },
		{ count: liveCount },
		{ data: recentLog },
		{ data: allTeams }
	] = await Promise.all([
		supabaseAdmin.from('games').select('*', { count: 'exact', head: true }),
		supabaseAdmin.from('teams').select('*', { count: 'exact', head: true }),
		supabaseAdmin.from('games').select('*', { count: 'exact', head: true }).eq('status', 'final'),
		supabaseAdmin.from('games').select('*', { count: 'exact', head: true }).eq('status', 'live'),
		supabaseAdmin
			.from('scrape_log')
			.select('*')
			.order('fetched_at', { ascending: false })
			.limit(50),
		supabaseAdmin
			.from('teams')
			.select('id, ncaa_team_id, name, short_name, ncaa_logo_slug, logo_url_dark, logo_url_light')
			.order('name')
	]);

	return {
		stats: {
			games: gameCount ?? 0,
			teams: teamCount ?? 0,
			finalGames: finalCount ?? 0,
			liveGames: liveCount ?? 0
		},
		recentLog: recentLog ?? [],
		allTeams: (allTeams ?? []) as {
			id: number;
			ncaa_team_id: string;
			name: string;
			short_name: string;
			ncaa_logo_slug: string | null;
			logo_url_dark:  string | null;
			logo_url_light: string | null;
		}[]
	};
};
