// Tunable constants for the rating systems. Centralized so they're easy to
// adjust without touching the engines.

export const ELO_BASE = 1500; // mean / new-team rating
export const ELO_K = 24; // base K-factor
export const ELO_HOME_ADVANTAGE = 85; // elo points added to the home side's expectation
export const CARRYOVER_LAMBDA = 0.7; // season-to-season regression toward the mean

/**
 * World-Football-ELO style margin-of-victory multiplier: bigger wins move
 * ratings more, with diminishing returns.
 *   |gd| <= 1 -> 1.0
 *   |gd| == 2 -> 1.5
 *   |gd| >= 3 -> (11 + |gd|) / 8   (3 -> 1.75, 4 -> 1.875, ...)
 */
export function goalDiffMultiplier(goalDiff: number): number {
	const g = Math.abs(goalDiff);
	if (g <= 1) return 1;
	if (g === 2) return 1.5;
	return (11 + g) / 8;
}

// ── RPI ──────────────────────────────────────────────────────
// NCAA soccer uses location-weighted results in the winning-percentage (WP)
// term only; OWP and OOWP use unweighted records. A road result is worth more
// than the same result at home. These weights are the widely used men's/women's
// soccer convention — centralized here so they're easy to retune to an official
// published table. Ties are weighted 1.0 regardless of location.
export const RPI_WP_WEIGHT = 0.25;
export const RPI_OWP_WEIGHT = 0.5;
export const RPI_OOWP_WEIGHT = 0.25;

export function rpiWinWeight(location: 'home' | 'away' | 'neutral'): number {
	if (location === 'home') return 0.6;
	if (location === 'away') return 1.4;
	return 1.0;
}

export function rpiLossWeight(location: 'home' | 'away' | 'neutral'): number {
	if (location === 'home') return 1.4;
	if (location === 'away') return 0.6;
	return 1.0;
}

export const RPI_TIE_WEIGHT = 1.0;

// ── Power ratings (Massey least squares) ─────────────────────
// Goal margins are capped before fitting so blowouts don't dominate. A small
// ridge is available if a pool is poorly connected, though the sum-zero
// constraint already makes the normal equations solvable.
export const POWER_MARGIN_CAP = 5;
export const POWER_RIDGE = 0;

export function capMargin(margin: number): number {
	if (margin > POWER_MARGIN_CAP) return POWER_MARGIN_CAP;
	if (margin < -POWER_MARGIN_CAP) return -POWER_MARGIN_CAP;
	return margin;
}
