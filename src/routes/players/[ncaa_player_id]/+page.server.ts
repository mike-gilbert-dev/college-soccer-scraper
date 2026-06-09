import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ params, url }) => {
	const sport      = url.searchParams.get('sport')    ?? 'MSO';
	const division   = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonLabel = url.searchParams.get('season') ?? '';

	// Player master record
	const { data: player } = await supabaseAdmin
		.from('players')
		.select('id, ncaa_player_id, name')
		.eq('ncaa_player_id', params.ncaa_player_id)
		.single();

	if (!player) error(404, 'Player not found');

	// All player_seasons for this player, with team + season info
	const { data: playerSeasons } = await supabaseAdmin
		.from('player_seasons')
		.select(`
			id,
			jersey_number,
			position,
			class_year,
			team_season:team_seasons (
				id,
				sport_code,
				division,
				season:seasons ( id, year, label ),
				team:teams ( ncaa_team_id, name, short_name, logo_url_light, logo_url_dark )
			)
		`)
		.eq('player_id', player.id);

	// Career stats per season from the view
	const playerSeasonIds = (playerSeasons ?? []).map(ps => ps.id);

	const { data: careerStats } = playerSeasonIds.length > 0
		? await supabaseAdmin
				.from('player_season_stats')
				.select('*')
				.in('player_season_id', playerSeasonIds)
		: { data: [] };

	// Per-game stats
	const { data: gameStats } = playerSeasonIds.length > 0
		? await supabaseAdmin
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
					game:games (
						id,
						ncaa_contest_id,
						contest_date,
						home_score,
						away_score,
						status,
						sport_code,
						home_team_season:team_seasons!home_team_season_id (
							team:teams ( ncaa_team_id, name, logo_url_light, logo_url_dark )
						),
						away_team_season:team_seasons!away_team_season_id (
							team:teams ( ncaa_team_id, name, logo_url_light, logo_url_dark )
						)
					)
				`)
				.in('player_season_id', playerSeasonIds)
				.order('contest_date', { referencedTable: 'games', ascending: false })
		: { data: [] };

	// Build a map of player_season_id → team ncaa_team_id for opponent lookup
	const psTeamMap: Record<number, string> = {};
	for (const ps of playerSeasons ?? []) {
		const ts = ps.team_season as unknown as { team: { ncaa_team_id: string } } | null;
		if (ts?.team?.ncaa_team_id) psTeamMap[ps.id] = ts.team.ncaa_team_id;
	}

	// Sort career stats by season year descending
	const sortedCareer = [...(careerStats ?? [])].sort((a, b) => {
		const psA = (playerSeasons ?? []).find(ps => ps.id === a.player_season_id);
		const psB = (playerSeasons ?? []).find(ps => ps.id === b.player_season_id);
		const tsA = psA?.team_season as unknown as { season: { year: number } } | null;
		const tsB = psB?.team_season as unknown as { season: { year: number } } | null;
		return (tsB?.season?.year ?? 0) - (tsA?.season?.year ?? 0);
	});

	// Determine most recent team for breadcrumb
	const mostRecentPs = (playerSeasons ?? []).sort((a, b) => {
		const tsA = a.team_season as unknown as { season: { year: number } } | null;
		const tsB = b.team_season as unknown as { season: { year: number } } | null;
		return (tsB?.season?.year ?? 0) - (tsA?.season?.year ?? 0);
	})[0];

	const mostRecentTeam = mostRecentPs
		? (mostRecentPs.team_season as unknown as { team: { ncaa_team_id: string; name: string } } | null)?.team
		: null;

	return {
		player,
		playerSeasons: (playerSeasons ?? []) as unknown as {
			id: number;
			jersey_number: number | null;
			position: string | null;
			class_year: string | null;
			team_season: {
				id: number;
				sport_code: string;
				division: number;
				season: { id: number; year: number; label: string | null };
				team: { ncaa_team_id: string; name: string; short_name: string; logo_url_light: string | null; logo_url_dark: string | null };
			};
		}[],
		careerStats: (sortedCareer ?? []) as unknown as {
			player_season_id: number;
			team_season_id: number;
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
		}[],
		gameStats: (gameStats ?? []) as unknown as {
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
			game: {
				id: number;
				ncaa_contest_id: string;
				contest_date: string;
				home_score: number | null;
				away_score: number | null;
				status: string;
				sport_code: string;
				home_team_season: { team: { ncaa_team_id: string; name: string; logo_url_light: string | null; logo_url_dark: string | null } } | null;
				away_team_season: { team: { ncaa_team_id: string; name: string; logo_url_light: string | null; logo_url_dark: string | null } } | null;
			};
		}[],
		psTeamMap,
		mostRecentTeam,
		sport,
		division,
		seasonLabel
	};
};
