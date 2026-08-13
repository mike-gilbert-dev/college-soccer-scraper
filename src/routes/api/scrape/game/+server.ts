import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchBoxScore, syntheticPlayerId, normalizePosition } from '$lib/server/ncaa-api';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const { ncaaContestId } = await request.json() as { ncaaContestId: string };
	if (!ncaaContestId) error(400, 'ncaaContestId is required');

	const { data: game, error: gameErr } = await supabaseAdmin
		.from('games')
		.select('id, status, home_team_season_id, away_team_season_id')
		.eq('ncaa_contest_id', String(ncaaContestId))
		.single();

	if (gameErr || !game) error(404, 'Game not found in database');
	if (game.status !== 'final') error(400, `Game status is "${game.status}" — can only scrape final games`);

	const boxScore = await fetchBoxScore(String(ncaaContestId));

	// Capture team colors (only fills nulls)
	await Promise.all(
		boxScore.teams
			.filter(t => t.color)
			.map(t =>
				supabaseAdmin
					.from('teams')
					.update({ team_color: t.color })
					.eq('ncaa_team_id', t.seoname)
					.is('team_color', null)
			)
	);

	// Upsert player stats
	const p = (s: string) => parseInt(s || '0', 10) || 0;
	let playersUpserted = 0;
	let statsUpserted   = 0;

	for (const teamDetail of boxScore.teamBoxscore) {
		const teamIdentity = boxScore.teams.find(
			t => String(t.teamId) === String(teamDetail.teamId)
		);
		if (!teamIdentity) continue;

		const teamSeasonId = teamIdentity.isHome
			? game.home_team_season_id
			: game.away_team_season_id;

		const participatingGks = teamDetail.playerStats.filter(
			pl => pl.participated && normalizePosition(pl.position) === 'GK'
		);
		const soleGkName = participatingGks.length === 1
			? `${participatingGks[0].firstName} ${participatingGks[0].lastName}`
			: null;

		for (const pl of teamDetail.playerStats) {
			if (!pl.participated) continue;

			const ncaaPlayerId = syntheticPlayerId(teamDetail.teamId, pl.firstName, pl.lastName);
			const fullName = `${pl.firstName} ${pl.lastName}`;
			const position = normalizePosition(pl.position);

			const { data: playerRow } = await supabaseAdmin
				.from('players')
				.upsert({ ncaa_player_id: ncaaPlayerId, name: fullName }, { onConflict: 'ncaa_player_id' })
				.select('id')
				.single();
			if (!playerRow) continue;
			playersUpserted++;

			const { data: playerSeason } = await supabaseAdmin
				.from('player_seasons')
				.upsert(
					{
						player_id:      playerRow.id,
						team_season_id: teamSeasonId,
						jersey_number:  pl.number,
						position,
						class_year:     null
					},
					{ onConflict: 'player_id,team_season_id' }
				)
				.select('id')
				.single();
			if (!playerSeason) continue;

			const isSoleGk = position === 'GK' && fullName === soleGkName;
			const gk = teamDetail.teamStats.goalie;

			const { error: statsErr } = await supabaseAdmin
				.from('player_game_stats')
				.upsert(
					{
						player_season_id:       playerSeason.id,
						game_id:                game.id,
						starter:                pl.starter,
						minutes_played:         p(pl.minutesPlayed),
						goals:                  p(pl.goals),
						assists:                p(pl.assists),
						shots:                  p(pl.shots),
						shots_on_goal:          p(pl.shotsOnGoal),
						fouls_committed:        p(pl.penalties.fouls),
						yellow_cards:           p(pl.penalties.yellowCards),
						red_cards:              p(pl.penalties.redCards),
						green_cards:            p(pl.penalties.greenCards),
						penalty_shot_goals:     p(pl.penaltyShotGoals),
						penalty_shot_attempts:  p(pl.penaltyShotAttempts),
						gk_saves:               isSoleGk ? p(gk.saves)        : null,
						gk_goals_against:       isSoleGk ? p(gk.goalsAllowed) : null,
						gk_shutout:             isSoleGk ? p(gk.shutouts) > 0 : null
					},
					{ onConflict: 'player_season_id,game_id' }
				);
			if (!statsErr) statsUpserted++;
		}
	}

	return json({ playersUpserted, statsUpserted });
};
