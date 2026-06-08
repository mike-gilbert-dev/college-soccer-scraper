import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

type PlayerSeasonStat = {
	player_season_id: number;
	player_id: number;
	ncaa_player_id: string;
	player_name: string;
	team_season_id: number;
	jersey_number: number | null;
	position: string | null;
	class_year: string | null;
	games_played: number;
	minutes_played: number;
	goals: number;
	assists: number;
	points: number;
	shots: number;
	shots_on_goal: number;
	fouls: number;
	yellow_cards: number;
	red_cards: number;
	gk_saves: number | null;
	gk_goals_against: number | null;
	gk_shutouts: number;
};

export type ScheduleGame = {
	ncaa_contest_id: string;
	contest_date: string;
	home_score: number | null;
	away_score: number | null;
	status: string;
	home_team_season_id: number;
	away_team_season_id: number;
	home_team_season: { team: { ncaa_team_id: string; name: string; logo_url_dark: string | null; logo_url_light: string | null } } | null;
	away_team_season: { team: { ncaa_team_id: string; name: string; logo_url_dark: string | null; logo_url_light: string | null } } | null;
};

export const load: PageServerLoad = async ({ params, url }) => {
	const sport        = url.searchParams.get('sport')    ?? 'MSO';
	const division     = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonParam  = url.searchParams.get('season');

	const { data: team } = await supabaseAdmin
		.from('teams')
		.select('id, ncaa_team_id, name, short_name, logo_url_dark, logo_url_light, team_color')
		.eq('ncaa_team_id', params.ncaa_team_id)
		.single();

	if (!team) error(404, 'Team not found');

	const seasonBase = supabaseAdmin.from('seasons').select('id, label');
	const { data: season } = await (seasonParam
		? seasonBase.eq('label', seasonParam).single()
		: seasonBase.order('start_date', { ascending: false }).limit(1).single());

	const seasonLabel = season?.label ?? seasonParam ?? '';

	const empty = { team, teamSeason: null, conferenceName: null, players: [] as PlayerSeasonStat[], schedule: [] as ScheduleGame[], sport, division, seasonLabel };
	if (!season) return empty;

	const { data: ts } = await supabaseAdmin
		.from('team_seasons')
		.select('id, conference:conferences(name)')
		.eq('team_id', team.id)
		.eq('season_id', season.id)
		.single();

	if (!ts) return empty;

	const conf = ts.conference as unknown as { name: string } | null;
	const conferenceName = conf?.name ?? null;

	const [{ data: roster }, { data: schedule }] = await Promise.all([
		supabaseAdmin
			.from('player_season_stats')
			.select('*')
			.eq('team_season_id', ts.id),
		supabaseAdmin
			.from('games')
			.select(`
				ncaa_contest_id,
				contest_date,
				home_score,
				away_score,
				status,
				home_team_season_id,
				away_team_season_id,
				home_team_season:team_seasons!home_team_season_id(
					team:teams(ncaa_team_id, name, logo_url_dark, logo_url_light)
				),
				away_team_season:team_seasons!away_team_season_id(
					team:teams(ncaa_team_id, name, logo_url_dark, logo_url_light)
				)
			`)
			.or(`home_team_season_id.eq.${ts.id},away_team_season_id.eq.${ts.id}`)
			.order('contest_date', { ascending: true })
	]);

	return {
		team,
		teamSeason: { id: ts.id },
		conferenceName,
		players: (roster ?? []) as PlayerSeasonStat[],
		schedule: (schedule ?? []) as unknown as ScheduleGame[],
		sport,
		division,
		seasonLabel
	};
};
