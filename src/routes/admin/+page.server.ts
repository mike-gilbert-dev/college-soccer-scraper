import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async () => {
	const [
		{ count: gameCount },
		{ count: teamCount },
		{ count: finalCount },
		{ count: liveCount },
		{ data: recentLog }
	] = await Promise.all([
		supabaseAdmin.from('games').select('*', { count: 'exact', head: true }),
		supabaseAdmin.from('teams').select('*', { count: 'exact', head: true }),
		supabaseAdmin.from('games').select('*', { count: 'exact', head: true }).eq('status', 'final'),
		supabaseAdmin.from('games').select('*', { count: 'exact', head: true }).eq('status', 'live'),
		supabaseAdmin
			.from('scrape_log')
			.select('*')
			.order('fetched_at', { ascending: false })
			.limit(50)
	]);

	return {
		stats: {
			games: gameCount ?? 0,
			teams: teamCount ?? 0,
			finalGames: finalCount ?? 0,
			liveGames: liveCount ?? 0
		},
		recentLog: recentLog ?? []
	};
};
