// Margin-of-victory ELO. Pure and deterministic: the only inputs are the games
// and the seed ratings, and the output depends on neither call order nor wall
// clock. All DB access and season-boundary logic lives in the Phase 3 pipeline.

import { ELO_BASE, ELO_K, ELO_HOME_ADVANTAGE, CARRYOVER_LAMBDA, goalDiffMultiplier } from './config';
import type { GameInput, RatingRow, SeedMap } from './types';

/**
 * Build start-of-season ELO seeds with regression to the mean:
 *   seed = BASE + LAMBDA * (priorFinal - BASE)
 * Teams with no prior rating seed at ELO_BASE.
 */
export function buildEloSeeds(
	teamSeasonIds: number[],
	priorFinalByTeamSeasonId: Map<number, number>
): SeedMap {
	const seeds: SeedMap = new Map();
	for (const id of teamSeasonIds) {
		const prior = priorFinalByTeamSeasonId.get(id);
		seeds.set(id, prior === undefined ? ELO_BASE : ELO_BASE + CARRYOVER_LAMBDA * (prior - ELO_BASE));
	}
	return seeds;
}

/** Deterministic chronological order: date, then start time (nulls last), then id. */
function compareGames(a: GameInput, b: GameInput): number {
	if (a.contestDate !== b.contestDate) return a.contestDate < b.contestDate ? -1 : 1;
	if (a.startTime !== b.startTime) {
		if (a.startTime === null) return 1;
		if (b.startTime === null) return -1;
		return a.startTime < b.startTime ? -1 : 1;
	}
	return a.id - b.id;
}

function isPlayable(g: GameInput): boolean {
	return (
		Number.isFinite(g.homeScore) &&
		Number.isFinite(g.awayScore)
	);
}

/**
 * Run sequential ELO over the games. Emits one RatingRow per team per game
 * (the post-game value), so the full per-game history is captured. The final
 * rating for a team is simply its last emitted row.
 */
export function computeElo(games: GameInput[], seeds: SeedMap): RatingRow[] {
	const current = new Map<number, number>(seeds);
	const played = new Map<number, number>();
	const rows: RatingRow[] = [];

	const ordered = [...games].sort(compareGames);

	for (const g of ordered) {
		if (!isPlayable(g)) continue;

		const rHome = current.get(g.homeTeamSeasonId) ?? ELO_BASE;
		const rAway = current.get(g.awayTeamSeasonId) ?? ELO_BASE;

		const effHome = rHome + (g.neutralSite ? 0 : ELO_HOME_ADVANTAGE);
		const eHome = 1 / (1 + Math.pow(10, (rAway - effHome) / 400));

		const sHome = g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5;
		const mult = goalDiffMultiplier(g.homeScore - g.awayScore);
		const delta = ELO_K * mult * (sHome - eHome);

		const newHome = rHome + delta;
		const newAway = rAway - delta;
		current.set(g.homeTeamSeasonId, newHome);
		current.set(g.awayTeamSeasonId, newAway);

		const gpHome = (played.get(g.homeTeamSeasonId) ?? 0) + 1;
		const gpAway = (played.get(g.awayTeamSeasonId) ?? 0) + 1;
		played.set(g.homeTeamSeasonId, gpHome);
		played.set(g.awayTeamSeasonId, gpAway);

		rows.push({
			teamSeasonId: g.homeTeamSeasonId,
			system: 'elo',
			asOf: g.contestDate,
			value: newHome,
			gamesPlayed: gpHome,
			meta: { k: ELO_K, mult, opp: rAway, delta }
		});
		rows.push({
			teamSeasonId: g.awayTeamSeasonId,
			system: 'elo',
			asOf: g.contestDate,
			value: newAway,
			gamesPlayed: gpAway,
			meta: { k: ELO_K, mult, opp: rHome, delta: -delta }
		});
	}

	return rows;
}
