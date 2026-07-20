// Admin-gated player search for the article tagging picker. Returns up to 20
// players matching the query by name, with a team hint to disambiguate. Gated
// via ADMIN_PATHS.

import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (q.length < 2) return json({ players: [] });

	const { data, error } = await supabaseAdmin
		.from('players')
		.select('id, ncaa_player_id, name, player_seasons(team_seasons(teams(short_name)))')
		.ilike('name', `%${q}%`)
		.limit(20);
	if (error) return json({ players: [], error: error.message }, { status: 500 });

	const players = (data ?? []).map((p) => {
		// Grab the first available team short_name as a disambiguation hint.
		let teamHint: string | null = null;
		const seasons = (p as { player_seasons?: unknown }).player_seasons;
		const arr = Array.isArray(seasons) ? seasons : seasons ? [seasons] : [];
		for (const s of arr as { team_seasons?: unknown }[]) {
			const ts = Array.isArray(s.team_seasons) ? s.team_seasons[0] : s.team_seasons;
			const team = ts && (Array.isArray((ts as { teams?: unknown }).teams)
				? (ts as { teams: { short_name?: string }[] }).teams[0]
				: (ts as { teams?: { short_name?: string } }).teams);
			if (team?.short_name) { teamHint = team.short_name; break; }
		}
		return { id: p.id, ncaa_player_id: p.ncaa_player_id, name: p.name, team_hint: teamHint };
	});

	return json({ players });
};
