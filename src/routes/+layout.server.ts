import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('supabase:auth');
	const { session, user } = await locals.safeGetSession();

	const [
		{ data: seasonsData },
		{ count: teamCount },
		{ count: gameCount },
		{ count: playerCount }
	] = await Promise.all([
		locals.supabase
			.from('seasons')
			.select('id, label, start_date, end_date')
			.order('start_date', { ascending: false }),
		locals.supabase.from('teams').select('*', { count: 'exact', head: true }),
		locals.supabase.from('games').select('*', { count: 'exact', head: true }),
		locals.supabase.from('players').select('*', { count: 'exact', head: true })
	]);

	return {
		session,
		user,
		isAdmin: locals.isAdmin,
		username: locals.username,
		usernameIsGenerated: locals.usernameIsGenerated,
		seasons: (seasonsData ?? []) as { id: number; label: string; start_date: string; end_date: string }[],
		teamCount:   teamCount   ?? 0,
		gameCount:   gameCount   ?? 0,
		playerCount: playerCount ?? 0
	};
};
