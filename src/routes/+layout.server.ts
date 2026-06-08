import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('supabase:auth');
	const { session, user } = await locals.safeGetSession();

	const { data: seasonsData } = await locals.supabase
		.from('seasons')
		.select('id, label, start_date, end_date')
		.order('start_date', { ascending: false });

	return {
		session,
		user,
		isAdmin: locals.isAdmin,
		seasons: (seasonsData ?? []) as { id: number; label: string; start_date: string; end_date: string }[]
	};
};
