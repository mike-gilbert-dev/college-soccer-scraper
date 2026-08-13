import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export type PlayerStat = {
	id: number;
	player_season_id: number;
	starter: boolean;
	minutes_played: number | null;
	goals: number;
	assists: number;
	shots: number;
	shots_on_goal: number;
	fouls_committed: number;
	yellow_cards: number;
	red_cards: number;
	gk_saves: number | null;
	gk_goals_against: number | null;
	gk_shutout: boolean | null;
	jersey_number: number | null;
	position: string | null;
	class_year: string | null;
	headshot_path: string | null;
	team_season_id: number;
	ncaa_player_id: string;
	player_name: string;
};

export const load: PageServerLoad = async ({ params, url, depends }) => {
	// Live games patch `game` (score/status/period) via a direct realtime match
	// on `games`, same as /scores. `player_game_stats` rows need player/team
	// joins the realtime payload doesn't carry, so those re-run this load
	// instead — see the `boxscore:stats` invalidate call in +page.svelte.
	depends('boxscore:stats');

	const sport      = url.searchParams.get('sport')    ?? 'MSO';
	const division   = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonLabel = url.searchParams.get('season') ?? '';
	const fromTeam   = url.searchParams.get('from') ?? null;

	const { data: game } = await supabaseAdmin
		.from('games')
		.select(`
			id,
			ncaa_contest_id,
			contest_date,
			home_score,
			away_score,
			shootout,
			shootout_winner_team_season_id,
			status,
			current_period,
			home_team_season_id,
			away_team_season_id,
			home_team_season:team_seasons!home_team_season_id(
				team:teams(ncaa_team_id, name, logo_url_dark, logo_url_light, team_color)
			),
			away_team_season:team_seasons!away_team_season_id(
				team:teams(ncaa_team_id, name, logo_url_dark, logo_url_light, team_color)
			)
		`)
		.eq('ncaa_contest_id', params.ncaa_contest_id)
		.single();

	if (!game) error(404, 'Game not found');

	const { data: rawStats } = await supabaseAdmin
		.from('player_game_stats')
		.select(`
			id,
			player_season_id,
			starter,
			minutes_played,
			goals,
			assists,
			shots,
			shots_on_goal,
			fouls_committed,
			yellow_cards,
			red_cards,
			gk_saves,
			gk_goals_against,
			gk_shutout,
			player_season:player_seasons(
				jersey_number,
				position,
				class_year,
				headshot_path,
				team_season_id,
				player:players(ncaa_player_id, name)
			)
		`)
		.eq('game_id', game.id);

	const allStats: PlayerStat[] = (rawStats ?? []).map(s => {
		const ps = s.player_season as unknown as {
			jersey_number: number | null;
			position: string | null;
			class_year: string | null;
			headshot_path: string | null;
			team_season_id: number;
			player: { ncaa_player_id: string; name: string };
		};
		return {
			id: s.id,
			player_season_id: s.player_season_id,
			starter: s.starter ?? false,
			minutes_played: s.minutes_played,
			goals: s.goals ?? 0,
			assists: s.assists ?? 0,
			shots: s.shots ?? 0,
			shots_on_goal: s.shots_on_goal ?? 0,
			fouls_committed: s.fouls_committed ?? 0,
			yellow_cards: s.yellow_cards ?? 0,
			red_cards: s.red_cards ?? 0,
			gk_saves: s.gk_saves,
			gk_goals_against: s.gk_goals_against,
			gk_shutout: s.gk_shutout,
			jersey_number: ps.jersey_number,
			position: ps.position,
			class_year: ps.class_year,
			headshot_path: ps.headshot_path,
			team_season_id: ps.team_season_id,
			ncaa_player_id: ps.player.ncaa_player_id,
			player_name: ps.player.name,
		};
	});

	const homeStats = allStats.filter(s => s.team_season_id === game.home_team_season_id);
	const awayStats = allStats.filter(s => s.team_season_id === game.away_team_season_id);

	type GameTeam = { ncaa_team_id: string; name: string; logo_url_dark: string | null; logo_url_light: string | null; team_color: string | null };
	const homeTeam = (game.home_team_season as unknown as { team: GameTeam } | null)?.team ?? null;
	const awayTeam = (game.away_team_season as unknown as { team: GameTeam } | null)?.team ?? null;

	return {
		game: {
			id: game.id,
			ncaa_contest_id: game.ncaa_contest_id,
			contest_date: game.contest_date,
			home_score: game.home_score,
			away_score: game.away_score,
			shootout: game.shootout ?? false,
			home_advanced: game.shootout
				? game.shootout_winner_team_season_id === game.home_team_season_id
				: null,
			away_advanced: game.shootout
				? game.shootout_winner_team_season_id === game.away_team_season_id
				: null,
			status: game.status,
			current_period: game.current_period as string | null,
		},
		homeTeam,
		awayTeam,
		homeStats,
		awayStats,
		fromTeam,
		sport,
		division,
		seasonLabel,
	};
};
