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
	const sport      = url.searchParams.get('sport')    ?? 'MSO';
	const division   = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonYear = parseInt(url.searchParams.get('season')   ?? '2025', 10);

	const { data: season } = await supabaseAdmin
		.from('seasons')
		.select('id')
		.eq('year', seasonYear)
		.single();

	if (!season) {
		return { teams: [] as TeamStanding[], conferences: [] as { name: string; short_name: string }[], sport, division, seasonYear };
	}

	const [{ data: teamSeasons }, { data: games }] = await Promise.all([
		supabaseAdmin
			.from('team_seasons')
			.select(`
				id,
				team:teams ( id, ncaa_team_id, name, short_name, logo_url_dark, logo_url_light ),
				conference:conferences ( name, short_name )
			`)
			.eq('season_id', season.id)
			.eq('division', division)
			.eq('sport_code', sport),
		supabaseAdmin
			.from('games')
			.select('home_team_season_id, away_team_season_id, home_score, away_score')
			.eq('season_id', season.id)
			.eq('sport_code', sport)
			.eq('division', division)
			.eq('status', 'final')
			.limit(10000)
	]);

	// Build a standings accumulator keyed by team_season id
	type Accum = { wins: number; losses: number; ties: number; goals_for: number; goals_against: number };
	const map = new Map<number, Accum>();
	for (const ts of teamSeasons ?? []) {
		map.set(ts.id, { wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 });
	}

	for (const g of games ?? []) {
		if (g.home_score == null || g.away_score == null) continue;
		const home = map.get(g.home_team_season_id);
		const away = map.get(g.away_team_season_id);
		if (home) {
			home.goals_for     += g.home_score;
			home.goals_against += g.away_score;
			if      (g.home_score > g.away_score) home.wins++;
			else if (g.home_score < g.away_score) home.losses++;
			else                                   home.ties++;
		}
		if (away) {
			away.goals_for     += g.away_score;
			away.goals_against += g.home_score;
			if      (g.away_score > g.home_score) away.wins++;
			else if (g.away_score < g.home_score) away.losses++;
			else                                   away.ties++;
		}
	}

	const teams: TeamStanding[] = (teamSeasons ?? []).map(ts => {
		const s = map.get(ts.id)!;
		return {
			id:           ts.id,
			team:         ts.team         as TeamStanding['team'],
			conference:   ts.conference   as TeamStanding['conference'],
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

	return { teams, conferences, sport, division, seasonYear };
};
