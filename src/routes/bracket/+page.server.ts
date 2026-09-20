import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { buildBracket, toBracketGame, bracketChampion, type BracketGameRow } from '$lib/bracket';

export const load: PageServerLoad = async ({ url }) => {
	const gender = url.searchParams.get('gender') ?? 'M';
	const sportCode = gender === 'W' ? 'WSO' : 'MSO';
	const division = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonParam = url.searchParams.get('season');

	const { data: seasons } = await supabaseAdmin
		.from('seasons')
		.select('id, label, start_date')
		.order('start_date', { ascending: false });

	const seasonList = (seasons ?? []) as { id: number; label: string; start_date: string }[];

	// Which seasons have a bracket at all — drives both the season picker and the
	// default below. Same gate the scoreboard link uses.
	const availability = await Promise.all(
		seasonList.map(async (s) => {
			const { data } = await supabaseAdmin.rpc('bracket_is_released', {
				p_season_id: s.id,
				p_sport_code: sportCode,
				p_division: division
			});
			return { label: s.label, released: data === true };
		})
	);

	// An explicit ?season= always wins, even when it has no bracket — a link to a
	// specific year should never silently show a different one. With no param we
	// default to the most recent season that actually HAS a bracket, not simply the
	// most recent season: through most of the year the current season is in progress
	// with no field announced, and defaulting to it would serve an empty page (and
	// index one, since bare /bracket is what the sitemap lists).
	const released = new Set(availability.filter((a) => a.released).map((a) => a.label));
	const season = seasonParam
		? seasonList.find((s) => s.label === seasonParam)
		: (seasonList.find((s) => released.has(s.label)) ?? seasonList[0]);

	if (!season) throw error(404, 'Season not found');

	const { data: rows, error: rpcError } = await supabaseAdmin.rpc('get_bracket_games', {
		p_season_id: season.id,
		p_sport_code: sportCode,
		p_division: division
	});
	if (rpcError) throw error(500, 'Could not load the bracket');

	const games = ((rows ?? []) as BracketGameRow[]).map(toBracketGame);
	const rounds = buildBracket(games);

	return {
		rounds,
		champion: bracketChampion(rounds),
		gender,
		division,
		seasonLabel: season.label,
		seasons: availability
	};
};
