import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export type TeamStanding = {
	id: number;
	team: { id: number; ncaa_team_id: string; name: string; short_name: string; logo_url_dark: string | null; logo_url_light: string | null };
	conference: { name: string; short_name: string } | null;
	wins: number;
	losses: number;
	ties: number;
	goals_for: number;
	goals_against: number;
	goal_diff: number;
};

export const load: PageServerLoad = async ({ url }) => {
	const sport        = url.searchParams.get('sport')    ?? 'MSO';
	const division     = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonParam  = url.searchParams.get('season');

	const seasonBase = supabaseAdmin.from('seasons').select('id, label');
	const { data: season } = await (seasonParam
		? seasonBase.eq('label', seasonParam).single()
		: seasonBase.order('start_date', { ascending: false }).limit(1).single());

	const seasonLabel = season?.label ?? seasonParam ?? '';

	if (!season) {
		return { teams: [] as TeamStanding[], conferences: [] as { name: string; short_name: string }[], sport, division, seasonLabel };
	}

	const [{ data: teamSeasons }, { data: standingsRows }] = await Promise.all([
		supabaseAdmin
			.from('team_seasons')
			.select(`
				id,
				team:teams ( id, ncaa_team_id, name, short_name, logo_url_dark, logo_url_light ),
				conference:conferences ( name, short_name )
			`)
			.eq('season_id', season.id)
			.eq('division', division)
			.eq('sport_code', sport)
			.eq('division_member', true),
		supabaseAdmin.rpc('get_standings', {
			p_season_id:  season.id,
			p_sport_code: sport,
			p_division:   division
		})
	]);

	type Accum = { wins: number; losses: number; ties: number; goals_for: number; goals_against: number };
	const map = new Map<number, Accum>();
	for (const row of standingsRows ?? []) {
		map.set(Number(row.ts_id), {
			wins:         Number(row.wins),
			losses:       Number(row.losses),
			ties:         Number(row.ties),
			goals_for:    Number(row.goals_for),
			goals_against: Number(row.goals_against)
		});
	}

	const teams: TeamStanding[] = (teamSeasons ?? []).map(ts => {
		const s = map.get(ts.id) ?? { wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 };
		return {
			id:           ts.id,
			team:         ts.team         as unknown as TeamStanding['team'],
			conference:   ts.conference   as unknown as TeamStanding['conference'],
			wins:         s.wins,
			losses:       s.losses,
			ties:         s.ties,
			goals_for:    s.goals_for,
			goals_against:s.goals_against,
			goal_diff:    s.goals_for - s.goals_against,
		};
	}).sort((a, b) =>
		b.wins       !== a.wins       ? b.wins - a.wins :
		b.goal_diff  !== a.goal_diff  ? b.goal_diff - a.goal_diff :
		b.goals_for  - a.goals_for
	);

	// Unique conferences in alphabetical order for the filter dropdown
	const confSeen = new Set<string>();
	const conferences: { name: string; short_name: string }[] = [];
	for (const t of teams) {
		if (t.conference && !confSeen.has(t.conference.name)) {
			confSeen.add(t.conference.name);
			conferences.push(t.conference);
		}
	}
	conferences.sort((a, b) => a.name.localeCompare(b.name));

	return { teams, conferences, sport, division, seasonLabel };
};
