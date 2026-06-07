import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	fetchContests,
	fetchBoxScore,
	normalizeStatus,
	formatNcaaDate,
	dateRange,
	sleep,
	syntheticPlayerId,
	type NcaaContestTeam
} from '$lib/server/ncaa-api';
import { supabaseAdmin } from '$lib/server/supabase-admin';

const DELAY_MS = 2000;
const BOX_SCORE_DELAY_MS = 1000;

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const body = await request.json();
	const {
		startDate,
		endDate,
		seasonYear = 2025,
		division = 1,
		sportCode = 'MSO',
		limit = 30,
		includePlayerStats = false
	} = body as {
		startDate: string;
		endDate: string;
		seasonYear?: number;
		division?: number;
		sportCode?: string;
		limit?: number;
		includePlayerStats?: boolean;
	};

	if (!startDate || !endDate) {
		error(400, 'startDate and endDate are required (YYYY-MM-DD)');
	}

	const { data: season, error: seasonErr } = await supabaseAdmin
		.from('seasons')
		.upsert(
			{ year: seasonYear, start_date: `${seasonYear}-08-01`, end_date: `${seasonYear}-12-15` },
			{ onConflict: 'year' }
		)
		.select('id')
		.single();

	if (seasonErr || !season) {
		error(500, `Failed to upsert season ${seasonYear}: ${seasonErr?.message}`);
	}

	const results = {
		processed: 0,
		gamesUpserted: 0,
		teamsUpserted: 0,
		playersUpserted: 0,
		playerStatsUpserted: 0,
		errors: [] as { date: string; message: string }[],
		nextDate: null as string | null
	};

	// Upsert a team + its conference into team_seasons; return team_season id.
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
				{ onConflict: 'team_id,season_id' }
			)
			.select('id')
			.single();

		return teamSeason?.id ?? null;
	}

	// Fetch box score and upsert player data for a single game.
	async function upsertPlayerGameStats(
		contestId: string,
		gameDbId: number,
		homeTeamSeasonId: number,
		awayTeamSeasonId: number
	): Promise<{ playersUpserted: number; statsUpserted: number }> {
		const p = (s: string) => parseInt(s || '0', 10) || 0;

		const boxScore = await fetchBoxScore(contestId);
		let playersUpserted = 0;
		let statsUpserted = 0;

		for (const teamDetail of boxScore.teamBoxscore) {
			// Match this teamBoxscore entry to home or away via the teams identity array.
			const teamIdentity = boxScore.teams.find(
				t => String(t.teamId) === String(teamDetail.teamId)
			);
			if (!teamIdentity) continue;

			const teamSeasonId = teamIdentity.isHome ? homeTeamSeasonId : awayTeamSeasonId;

			// Find GKs who played — GK stats are team-level, attributed only to a sole GK.
			const participatingGks = teamDetail.playerStats.filter(
				pl => pl.participated && pl.position === 'GK'
			);
			const soleGkName =
				participatingGks.length === 1
					? `${participatingGks[0].firstName} ${participatingGks[0].lastName}`
					: null;

			for (const pl of teamDetail.playerStats) {
				if (!pl.participated) continue;

				const ncaaPlayerId = syntheticPlayerId(
					teamDetail.teamId,
					pl.firstName,
					pl.lastName
				);
				const fullName = `${pl.firstName} ${pl.lastName}`;

				// Upsert master player record
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

				// Upsert player_season (enrollment for this team/season)
				const { data: playerSeason } = await supabaseAdmin
					.from('player_seasons')
					.upsert(
						{
							player_id: playerRow.id,
							team_season_id: teamSeasonId,
							jersey_number: pl.number,
							position: pl.position ?? null,
							class_year: null // not in box score API
						},
						{ onConflict: 'player_id,team_season_id' }
					)
					.select('id')
					.single();
				if (!playerSeason) continue;

				// GK stats: only populate when this player is the sole GK who played.
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

	for (const date of dateRange(startDate, endDate)) {
		if (results.processed >= limit) {
			results.nextDate = date.toISOString().slice(0, 10);
			break;
		}

		const ncaaDate = formatNcaaDate(date);

		try {
			const contests = await fetchContests({ contestDate: ncaaDate, seasonYear, division, sportCode });

			for (const contest of contests) {
				const homeData = contest.teams.find(t => t.isHome);
				const awayData = contest.teams.find(t => !t.isHome);
				if (!homeData || !awayData) continue;

				const [homeTeamSeasonId, awayTeamSeasonId] = await Promise.all([
					upsertTeamSeason(homeData, season.id),
					upsertTeamSeason(awayData, season.id)
				]);

				if (!homeTeamSeasonId || !awayTeamSeasonId) continue;
				results.teamsUpserted += 2;

				const startTime = contest.startTimeEpoch
					? new Date(contest.startTimeEpoch * 1000).toISOString()
					: null;

				const { data: gameRow, error: gameErr } = await supabaseAdmin
					.from('games')
					.upsert(
						{
							ncaa_contest_id: String(contest.contestId),
							season_id: season.id,
							contest_date: date.toISOString().slice(0, 10),
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

				if (!gameErr) results.gamesUpserted++;

				// Optionally fetch player box score for final games.
				if (
					includePlayerStats &&
					gameRow &&
					normalizeStatus(contest.statusCodeDisplay) === 'final'
				) {
					try {
						const { playersUpserted, statsUpserted } = await upsertPlayerGameStats(
							String(contest.contestId),
							gameRow.id,
							homeTeamSeasonId,
							awayTeamSeasonId
						);
						results.playersUpserted += playersUpserted;
						results.playerStatsUpserted += statsUpserted;
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						results.errors.push({
							date: ncaaDate,
							message: `Box score ${contest.contestId}: ${msg}`
						});
						await supabaseAdmin.from('scrape_log').insert({
							endpoint: 'NCAA_GetGamecenterBoxscoreSoccerById_web',
							contest_date: date.toISOString().slice(0, 10),
							status: 'error',
							error_message: `contestId=${contest.contestId}: ${msg}`
						});
					}
					await sleep(BOX_SCORE_DELAY_MS);
				}
			}

			await supabaseAdmin.from('scrape_log').insert({
				endpoint: 'GetContests_web',
				contest_date: date.toISOString().slice(0, 10),
				http_status: 200,
				status: 'success',
				games_upserted: contests.length
			});

		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			results.errors.push({ date: ncaaDate, message });

			await supabaseAdmin.from('scrape_log').insert({
				endpoint: 'GetContests_web',
				contest_date: date.toISOString().slice(0, 10),
				status: 'error',
				error_message: message
			});
		}

		results.processed++;
		await sleep(DELAY_MS);
	}

	return json(results);
};
