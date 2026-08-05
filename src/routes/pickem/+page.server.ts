import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;

// Not exported: SvelteKit only allows specific named exports from +page.server.ts
// (load, actions, prerender, ssr, csr, …) and throws on anything else.
// The qualifier is passed to the RPC as a parameter so it can be retuned freely.
const MIN_PICKS = 25;

export const load: PageServerLoad = async ({ url, locals }) => {
	const supabase = locals.supabase;

	const board = url.searchParams.get('board') === 'pct' ? 'pct' : 'wins';
	const sportCode = url.searchParams.get('sport') === 'WSO' ? 'WSO' : 'MSO';
	const pageNum = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1);
	const seasonParam = url.searchParams.get('season');

	const { data: seasons } = await supabase
		.from('seasons')
		.select('id, label')
		.order('start_date', { ascending: false });

	const seasonBase = supabase.from('seasons').select('id, label');
	const { data: season } = await (seasonParam
		? seasonBase.eq('label', seasonParam).single()
		: seasonBase.order('start_date', { ascending: false }).limit(1).single());

	if (!season) {
		return {
			rows: [],
			seasons: seasons ?? [],
			seasonLabel: seasonParam ?? '',
			sportCode,
			board,
			page: pageNum,
			pageSize: PAGE_SIZE,
			minPicks: MIN_PICKS,
			position: null
		};
	}

	// Explicit limit/offset: PostgREST caps responses at 1000 rows and truncates
	// silently, so pagination is a correctness requirement, not polish.
	const { data: rows } = await supabase.rpc('get_leaderboard', {
		p_season_id: season.id,
		p_sport_code: sportCode,
		p_board: board,
		p_min_picks: MIN_PICKS,
		p_limit: PAGE_SIZE,
		p_offset: (pageNum - 1) * PAGE_SIZE
	});

	// Personal strip: where the signed-in user stands, even if unqualified.
	let position = null;
	if (locals.username) {
		const { data } = await supabase.rpc('get_user_leaderboard_position', {
			p_username: locals.username,
			p_season_id: season.id,
			p_sport_code: sportCode,
			p_board: board,
			p_min_picks: MIN_PICKS
		});
		position = data?.[0] ?? null;
	}

	return {
		rows: rows ?? [],
		seasons: seasons ?? [],
		seasonLabel: season.label,
		sportCode,
		board,
		page: pageNum,
		pageSize: PAGE_SIZE,
		minPicks: MIN_PICKS,
		position
	};
};
