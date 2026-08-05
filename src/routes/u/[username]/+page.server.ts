import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const RECENT_PICKS_LIMIT = 25;

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const supabase = locals.supabase;
	const username = params.username;

	// public_profiles withholds un-confirmed generated usernames, so those 404 —
	// an email-derived name must never be reachable before its owner has seen it.
	const { data: profile } = await supabase
		.from('public_profiles')
		.select('id, username')
		.ilike('username', username)
		.maybeSingle();

	if (!profile) error(404, 'No such user');

	const sportCode = url.searchParams.get('sport') === 'WSO' ? 'WSO' : 'MSO';

	const seasonParam = url.searchParams.get('season');
	const seasonBase = supabase.from('seasons').select('id, label');
	const { data: season } = await (seasonParam
		? seasonBase.eq('label', seasonParam).single()
		: seasonBase.order('start_date', { ascending: false }).limit(1).single());

	const { data: seasons } = await supabase
		.from('seasons')
		.select('id, label')
		.order('start_date', { ascending: false });

	if (!season) {
		return {
			profileUsername: profile.username,
			summary: null,
			timeline: [],
			recentPicks: [],
			seasons: seasons ?? [],
			seasonLabel: seasonParam ?? '',
			sportCode
		};
	}

	// All three go through SECURITY DEFINER functions. A direct read of `picks`
	// would return nothing here: RLS lets a user select only their OWN picks, so
	// a visitor (or anon) looking at someone else's profile sees zero rows.
	// get_recent_picks is filtered to graded picks, so an unstarted game's pick
	// is never exposed.
	const [{ data: summaryRows }, { data: timeline }, { data: recentPicks }] = await Promise.all([
		supabase.rpc('get_user_pick_summary', {
			p_username: profile.username,
			p_season_id: season.id,
			p_sport_code: sportCode
		}),
		supabase.rpc('get_pick_timeline', {
			p_username: profile.username,
			p_season_id: season.id,
			p_sport_code: sportCode
		}),
		supabase.rpc('get_recent_picks', {
			p_username: profile.username,
			p_season_id: season.id,
			p_sport_code: sportCode,
			p_limit: RECENT_PICKS_LIMIT
		})
	]);

	return {
		profileUsername: profile.username,
		summary: summaryRows?.[0] ?? null,
		timeline: timeline ?? [],
		recentPicks: recentPicks ?? [],
		seasons: seasons ?? [],
		seasonLabel: season.label,
		sportCode
	};
};
