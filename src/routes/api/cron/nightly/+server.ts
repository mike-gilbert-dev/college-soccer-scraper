import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeCron } from '$lib/server/cron-auth';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { fetchRawContests, fetchRawBoxScore, sleep } from '$lib/server/ncaa-api';
import {
	saveContestJson,
	saveBoxScoreJson,
	readGameContestIds
} from '$lib/server/ncaa-archive';
import { ingestDate } from '$lib/server/ingest';
import { recomputeRatings } from '$lib/server/ratings/recompute';
import type { RatingSystem } from '$lib/server/ratings/types';

// Vercel Hobby caps function duration at 60s. Box scores are off by default to stay
// under that; pass ?boxscores=1 for an on-demand player-stats pass (best on Pro / a
// narrow window). Bump this to 300 if you upgrade to Pro.
export const config = { maxDuration: 60 };

// Which sport + division combinations to refresh each night.
const DEFAULT_TARGETS: { sportCode: string; division: number }[] = [
	{ sportCode: 'MSO', division: 1 },
	{ sportCode: 'WSO', division: 1 }
];

const RATING_SYSTEMS: RatingSystem[] = ['elo', 'rpi', 'power'];

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → MM/DD/YYYY for the NCAA API. */
function toNcaaDate(iso: string): string {
	const [y, m, d] = iso.split('-');
	return `${m}/${d}/${y}`;
}

export const GET: RequestHandler = async ({ request, url }) => {
	const denied = authorizeCron(request);
	if (denied) return json({ error: 'Unauthorized' }, { status: denied });

	// ── Tunable knobs (all optional) ────────────────────────────────
	const days = Math.max(1, parseInt(url.searchParams.get('days') ?? '2', 10) || 2);
	// Default OFF for Hobby's 60s budget — scores-only. Pass ?boxscores=1 to include player stats.
	const boxScores = url.searchParams.get('boxscores') === '1';
	const bsDelay = Math.max(0, parseInt(url.searchParams.get('bsDelay') ?? '400', 10) || 0);
	const forcedDate = url.searchParams.get('date'); // YYYY-MM-DD, overrides the window
	const sportParam = url.searchParams.get('sport');
	const divisionParam = url.searchParams.get('division');

	const targets =
		sportParam && divisionParam
			? [{ sportCode: sportParam, division: parseInt(divisionParam, 10) }]
			: DEFAULT_TARGETS;

	const today = isoDay(new Date());
	// For a normal nightly run we anchor on today; a forced ?date= anchors on that date
	// so manual backfills resolve the season that contains the target date, year-round.
	const anchor = forcedDate ?? today;

	// ── Resolve the season whose range contains the anchor date ──
	const { data: activeSeason } = await supabaseAdmin
		.from('seasons')
		.select('id, year, label, start_date, end_date')
		.lte('start_date', anchor)
		.gte('end_date', anchor)
		.order('start_date', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (!activeSeason) {
		// Off-season (or no season row covers the anchor) — nothing to do, but report it.
		return json({
			ran: false,
			reason: forcedDate
				? `No season covers ${forcedDate}`
				: 'No active season covers today',
			anchor
		});
	}

	// ── Build the date window, clamped to the season start ──────────
	const dates: string[] = [];
	if (forcedDate) {
		dates.push(forcedDate);
	} else {
		const start = new Date(`${today}T00:00:00Z`);
		for (let i = 0; i < days; i++) {
			const d = new Date(start);
			d.setUTCDate(d.getUTCDate() - i);
			const iso = isoDay(d);
			if (iso < activeSeason.start_date) break; // don't reach before the season
			dates.push(iso);
		}
		dates.reverse(); // chronological
	}

	const summary = {
		ran: true,
		season: activeSeason.label,
		today,
		boxScores,
		targets: [] as unknown[]
	};

	for (const target of targets) {
		const { sportCode, division } = target;
		const targetResult = {
			sportCode,
			division,
			dates: [] as unknown[],
			ratings: null as unknown,
			error: null as string | null
		};

		try {
			for (const contestDate of dates) {
				const dateResult: Record<string, unknown> = { date: contestDate };
				try {
					// 1. Archive raw games (captures both schedules and final scores)
					const raw = await fetchRawContests({
						contestDate: toNcaaDate(contestDate),
						seasonYear: activeSeason.year,
						division,
						sportCode
					});
					await saveContestJson(sportCode, division, activeSeason.year, contestDate, raw);
					const contests =
						(raw as { data?: { contests?: unknown[] } })?.data?.contests ?? [];
					dateResult.games = contests.length;

					await supabaseAdmin.from('scrape_log').insert({
						endpoint: 'GetContests_web',
						contest_date: contestDate,
						http_status: 200,
						status: 'success',
						games_upserted: contests.length
					});

					// 2. Archive raw box scores for every contest on the date
					if (boxScores) {
						const ids = await readGameContestIds(
							sportCode,
							division,
							activeSeason.year,
							contestDate
						);
						let saved = 0;
						for (let i = 0; i < ids.length; i++) {
							try {
								const bs = await fetchRawBoxScore(ids[i]);
								await saveBoxScoreJson(sportCode, division, activeSeason.year, ids[i], bs);
								saved++;
							} catch (e) {
								await supabaseAdmin.from('scrape_log').insert({
									endpoint: 'NCAA_GetGamecenterBoxscoreSoccerById_web',
									contest_date: contestDate,
									status: 'error',
									error_message: `contestId=${ids[i]}: ${
										e instanceof Error ? e.message : String(e)
									}`
								});
							}
							if (bsDelay > 0 && i < ids.length - 1) await sleep(bsDelay);
						}
						dateResult.boxScoresSaved = saved;
					}

					// 3. Ingest stored files into the database
					const ingest = await ingestDate({
						sportCode,
						division,
						seasonId: activeSeason.id,
						seasonYear: activeSeason.year,
						contestDate
					});
					dateResult.gamesUpserted = ingest.gamesUpserted;
					dateResult.playerStatsUpserted = ingest.playerStatsUpserted;
					if (ingest.errors.length) dateResult.ingestErrors = ingest.errors.length;
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					dateResult.error = msg;
					await supabaseAdmin.from('scrape_log').insert({
						endpoint: 'GetContests_web',
						contest_date: contestDate,
						status: 'error',
						error_message: msg
					});
				}
				targetResult.dates.push(dateResult);
			}

			// 4. Recompute ratings for the season (also refreshes division membership)
			targetResult.ratings = await recomputeRatings({
				sportCode,
				division,
				seasonId: activeSeason.id,
				systems: RATING_SYSTEMS
			});
		} catch (e) {
			targetResult.error = e instanceof Error ? e.message : String(e);
		}

		summary.targets.push(targetResult);
	}

	return json(summary);
};
