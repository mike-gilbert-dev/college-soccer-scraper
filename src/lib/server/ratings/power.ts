// Massey least-squares power ratings. Pure and dependency-free.
//
// Model: for each game, capped goal margin (home perspective) is explained by
//   margin ≈ rating[home] - rating[away] + homeAdv*(non-neutral)
// We estimate homeAdv as the mean home margin and subtract it up front, then
// solve the Massey normal equations M r = p for the rating vector r. The system
// is singular (ratings are relative), so the last equation is replaced with the
// constraint sum(r) = 0, which both makes it solvable and centers ratings at 0.
//
// A rating is then interpretable as expected goal margin versus an average team
// on a neutral field. The pool is whatever team_seasons appear in `games`.

import { POWER_MARGIN_CAP, POWER_RIDGE, capMargin } from './config';
import type { GameInput, RatingRow } from './types';

const EPS = 1e-9;

/** Gauss-Jordan elimination with partial pivoting. Solves M x = b.
 *  A near-zero pivot means that variable is disconnected; it is left at 0.
 *  Exported for unit testing. */
export function solveLinearSystem(M: number[][], b: number[]): number[] {
	const n = b.length;
	const A = M.map((row, i) => [...row, b[i]]); // augmented n x (n+1)

	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let r = col + 1; r < n; r++) {
			if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
		}
		if (Math.abs(A[pivot][col]) < EPS) continue; // disconnected variable
		[A[col], A[pivot]] = [A[pivot], A[col]];

		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const factor = A[r][col] / A[col][col];
			if (factor === 0) continue;
			for (let c = col; c <= n; c++) A[r][c] -= factor * A[col][c];
		}
	}

	const x = new Array<number>(n).fill(0);
	for (let i = 0; i < n; i++) {
		x[i] = Math.abs(A[i][i]) < EPS ? 0 : A[i][n] / A[i][i];
	}
	return x;
}

export function computePower(games: GameInput[]): RatingRow[] {
	const playable = games.filter(
		(g) => Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore)
	);

	// Index teams.
	const index = new Map<number, number>();
	const teamIds: number[] = [];
	let maxDate = '';
	for (const g of playable) {
		if (g.contestDate > maxDate) maxDate = g.contestDate;
		for (const id of [g.homeTeamSeasonId, g.awayTeamSeasonId]) {
			if (!index.has(id)) {
				index.set(id, teamIds.length);
				teamIds.push(id);
			}
		}
	}
	const n = teamIds.length;
	if (n === 0) return [];

	// Home-field advantage = mean raw margin over non-neutral games.
	let homeMarginSum = 0;
	let nonNeutral = 0;
	for (const g of playable) {
		if (!g.neutralSite) {
			homeMarginSum += g.homeScore - g.awayScore;
			nonNeutral++;
		}
	}
	const homeAdv = nonNeutral > 0 ? homeMarginSum / nonNeutral : 0;

	// Build Massey normal equations M r = p.
	const M: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
	const p = new Array<number>(n).fill(0);
	const played = new Array<number>(n).fill(0);

	for (const g of playable) {
		const h = index.get(g.homeTeamSeasonId)!;
		const a = index.get(g.awayTeamSeasonId)!;
		const adjMargin = capMargin(g.homeScore - g.awayScore) - (g.neutralSite ? 0 : homeAdv);

		M[h][h] += 1;
		M[a][a] += 1;
		M[h][a] -= 1;
		M[a][h] -= 1;
		p[h] += adjMargin;
		p[a] -= adjMargin;
		played[h]++;
		played[a]++;
	}

	if (POWER_RIDGE > 0) {
		for (let i = 0; i < n; i++) M[i][i] += POWER_RIDGE;
	}

	// Replace the last equation with sum(r) = 0 to fix the gauge and center.
	for (let j = 0; j < n; j++) M[n - 1][j] = 1;
	p[n - 1] = 0;

	const r = solveLinearSystem(M, p);

	// Re-center defensively (sum-zero constraint already does this).
	const mean = r.reduce((s, v) => s + v, 0) / n;

	return teamIds.map((teamSeasonId, i) => ({
		teamSeasonId,
		system: 'power' as const,
		asOf: maxDate,
		value: r[i] - mean,
		gamesPlayed: played[i],
		meta: { homeAdv, marginCap: POWER_MARGIN_CAP }
	}));
}
