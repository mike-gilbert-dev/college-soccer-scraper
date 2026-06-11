import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	readGameContests,
	readStoredBoxScore
} from '$lib/server/ncaa-archive';
import {
	normalizeStatus,
	syntheticPlayerId,
	type NcaaContestTeam,
	type NcaaBoxScore
} from '$lib/server/ncaa-api';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const { sportCode, division, seasonLabel, contestDate } = await request.json() as {
		sportCode: string;
		division: number;
		seasonLabel: string;
		contestDate: string;
	};

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.select('id, year')
		.eq('label', seasonLabel)
		.single();

	if (seasonErr || !season) {
		return json({ error: `Season not found: ${seasonLabel}` }, { status: 400 });
	}

	const contests = await readGameContests(sportCode, division, season.year, contestDate);

	if (contests.length === 0) {
		return json({
			contestDate,
			contestsFound: 0,
			gamesUpserted: 0,
			teamsUpserted: 0,
			playerStatsUpserted: 0,
			boxScoresCleared: 0,
			errors: []
		});
	}

	const results = {
		contestDate,
		contestsFound: contests.length,
		gamesUpserted: 0,
		teamsUpserted: 0,
		playerStatsUpserted: 0,
		boxScoresCleared: 0,
		errors: [] as { contestId: string; message: string }[]
	};

	async function upsertTeamSeason(
		teamData: NcaaContestTeam,
		seasonId: number
	): Promise<number | null> {
		const [{ data: conf }, { data: team }] = await Promise.all([
			teamData.conferenceSeo
				? supabaseAdmin
						.from('conferences')
						.upsert(
							{
								ncaa_conference_id: teamData.conferenceSeo,
								season_id: seasonId,
								name: teamData.conferenceSeo,
								short_name: teamData.conferenceSeo,
								division
							},
							{ onConflict: 'ncaa_conference_id,season_id' }
						)
						.select('id')
						.single()
				: Promise.resolve({ data: null, error: null }),

			supabaseAdmin
				.from('teams')
				.upsert(
					{
						ncaa_team_id: teamData.seoname,
						name: teamData.nameShort,
						short_name: teamData.name6Char || teamData.nameShort
					},
					{ onConflict: 'ncaa_team_id' }
				)
				.select('id')
				.single()
		]);

		if (!team) return null;

		const { data: teamSeason } = await supabaseAdmin
			.from('team_seasons')
			.upsert(
				{
					team_id: team.id,
					season_id: seasonId,
					division,
					conference_id: conf?.id ?? null,
					sport_code: sportCode
				},
				{ onConflict: 'team_id,season_id,sport_code' }
			)
			.select('id')
			.single();

		return teamSeason?.id ?? null;
	}

	async function captureTeamColorsFromBoxScore(boxScore: NcaaBoxScore): Promise<void> {
		await Promise.all(
			boxScore.teams
				.filter((t) => t.color)
				.map((t) =>
					supabaseAdmin
						.from('teams')
						.update({ team_color: t.color })
						.eq('ncaa_team_id', t.seoname)
						.is('team_color', null)
				)
		);
	}

	async function upsertPlayerGameStats(
		boxScore: NcaaBoxScore,
		gameDbId: number,
		homeTeamSeasonId: number,
		awayTeamSeasonId: number
	): Promise<{ playersUpserted: number; statsUpserted: number }> {
		const p = (s: string) => parseInt(s || '0', 10) || 0;
		let playersUpserted = 0;
		let statsUpserted = 0;

		for (const teamDetail of boxScore.teamBoxscore) {
			const teamIdentity = boxScore.teams.find(
				(t) => String(t.teamId) === String(teamDetail.teamId)
			);
			if (!teamIdentity) continue;

			const teamSeasonId = teamIdentity.isHome ? homeTeamSeasonId : awayTeamSeasonId;

			const participatingGks = teamDetail.playerStats.filter(
				(pl) => pl.participated && pl.position === 'GK'
			);
			const soleGkName =
				participatingGks.length === 1
					? `${participatingGks[0].firstName} ${participatingGks[0].lastName}`
					: null;

			for (const pl of teamDetail.playerStats) {
				if (!pl.participated) continue;

				const ncaaPlayerId = syntheticPlayerId(teamDetail.teamId, pl.firstName, pl.lastName);
				const fullName = `${pl.firstName} ${pl.lastName}`;

				const { data: playerRow } = await supabaseAdmin
					.from('players')
					.upsert(
						{ ncaa_player_id: ncaaPlayerId, name: fullName },
						{ onConflict: 'ncaa_player_id' }
					)
					.select('id')
					.single();
				if (!playerRow) continue;
				playersUpserted++;

				const { data: playerSeason } = await supabaseAdmin
					.from('player_seasons')
					.upsert(
						{
							player_id: playerRow.id,
							team_season_id: teamSeasonId,
							jersey_number: pl.number,
							position: pl.position ?? null,
							class_year: null
						},
						{ onConflict: 'player_id,team_season_id' }
					)
					.select('id')
					.single();
				if (!playerSeason) continue;

				const isSoleGk = pl.position === 'GK' && fullName === soleGkName;
				const gk = teamDetail.teamStats.goalie;

				const { error: statsErr } = await supabaseAdmin
					.from('player_game_stats')
					.upsert(
						{
							player_season_id: playerSeason.id,
							game_id: gameDbId,
							starter: pl.starter,
							minutes_played: p(pl.minutesPlayed),
							goals: p(pl.goals),
							assists: p(pl.assists),
							shots: p(pl.shots),
							shots_on_goal: p(pl.shotsOnGoal),
							fouls_committed: p(pl.penalties.fouls),
							yellow_cards: p(pl.penalties.yellowCards),
							red_cards: p(pl.penalties.redCards),
							green_cards: p(pl.penalties.greenCards),
							penalty_shot_goals: p(pl.penaltyShotGoals),
							penalty_shot_attempts: p(pl.penaltyShotAttempts),
							gk_saves: isSoleGk ? p(gk.saves) : null,
							gk_goals_against: isSoleGk ? p(gk.goalsAllowed) : null,
							gk_shutout: isSoleGk ? p(gk.shutouts) > 0 : null
						},
						{ onConflict: 'player_season_id,game_id' }
					);
				if (!statsErr) statsUpserted++;
			}
		}

		return { playersUpserted, statsUpserted };
	}

	for (const contest of contests) {
		const homeData = contest.teams.find((t) => t.isHome);
		const awayData = contest.teams.find((t) => !t.isHome);
		if (!homeData || !awayData) continue;

		try {
			const [homeTeamSeasonId, awayTeamSeasonId] = await Promise.all([
				upsertTeamSeason(homeData, season.id),
				upsertTeamSeason(awayData, season.id)
			]);
			if (!homeTeamSeasonId || !awayTeamSeasonId) continue;
			results.teamsUpserted += 2;

			const startTime = contest.startTimeEpoch
				? new Date(contest.startTimeEpoch * 1000).toISOString()
				: null;

			const { data: gameRow } = await supabaseAdmin
				.from('games')
				.upsert(
					{
						ncaa_contest_id: String(contest.contestId),
						season_id: season.id,
						contest_date: contestDate,
						start_time: startTime,
						home_team_season_id: homeTeamSeasonId,
						away_team_season_id: awayTeamSeasonId,
						home_score: homeData.score,
						away_score: awayData.score,
						status: normalizeStatus(contest.statusCodeDisplay),
						neutral_site: false,
						sport_code: sportCode,
						division,
						broadcaster_name: contest.broadcasterName ?? null,
						round_description: contest.roundDescription ?? null,
						last_fetched_at: new Date().toISOString()
					},
					{ onConflict: 'ncaa_contest_id' }
				)
				.select('id')
				.single();

			if (gameRow) results.gamesUpserted++;
			if (!gameRow) continue;

			const bsResult = await readStoredBoxScore(
				sportCode,
				division,
				season.year,
				String(contest.contestId)
			);

			if (!bsResult.fileFound) {
				// No box score archived yet — skip player stats, leave DB unchanged
			} else if (!bsResult.boxScore) {
				// File exists but data.boxscore is null — delete stale player_game_stats
				await supabaseAdmin.from('player_game_stats').delete().eq('game_id', gameRow.id);
				results.boxScoresCleared++;
			} else {
				await captureTeamColorsFromBoxScore(bsResult.boxScore);
				const { statsUpserted } = await upsertPlayerGameStats(
					bsResult.boxScore,
					gameRow.id,
					homeTeamSeasonId,
					awayTeamSeasonId
				);
				results.playerStatsUpserted += statsUpserted;
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			results.errors.push({ contestId: String(contest.contestId), message: msg });
		}
	}

	return json(results);
};
