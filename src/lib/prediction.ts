// Pregame win probability for the game preview: home / draw / away.
//
// Built on the Elo ratings the site already publishes. Elo only yields an
// expected SCORE, E = P(win) + ½·P(draw), and ~22% of D1 finals are draws, so the
// draw is split out with a line fitted against real results:
//
//   g       = scale·(eloHome − eloAway) + homeAdv     (homeAdv = 0 at a neutral site)
//   E       = 1 / (1 + 10^(−g/400))
//   P(draw) = clamp(drawBase + drawSlope·|g|)
//   P(home) = E − ½·P(draw)    P(away) = 1 − E − ½·P(draw)
//
// scale/homeAdv are deliberately NOT the rating engine's constants
// (ELO_HOME_ADVANTAGE = 85). Measured against 2024–2026 finals, the engine's home
// edge is far too big — at an even gap the AWAY side wins more often — and its
// spread is too narrow: big favourites win more than raw Elo says. The engine's
// constants tune how ratings MOVE; these tune how a gap reads as odds. Fitted per
// sport by scripts/calibrate-elo-draws.mjs (read-only, re-run each off-season and
// paste the output here). On the fit, predicted vs actual stays within ~3 points
// in every Elo-gap bucket.
//
// Pure module — no IO — so it's trivial to unit test.

import type { PickOutcome } from './picks';

export interface PredictionModel {
	scale: number;
	homeAdv: number;
	drawBase: number;
	drawSlope: number;
}

/** Fitted 2026-10-11 on 2024-25 → 2026-27 finals (MSO n=4964, WSO n=8512). */
export const MODELS: Record<'MSO' | 'WSO', PredictionModel> = {
	MSO: { scale: 1.35, homeAdv: 60, drawBase: 0.2626, drawSlope: -3.44e-4 },
	WSO: { scale: 1.6, homeAdv: 55, drawBase: 0.2673, drawSlope: -4.12e-4 }
};

// Mirror DRAW_MIN / DRAW_MAX in scripts/calibrate-elo-draws.mjs.
const DRAW_MIN = 0.05;
const DRAW_MAX = 0.35;

export type Prediction = Record<PickOutcome, number>;

/**
 * The College Cup (semifinals + final) is the only neutral-site play. The feed's
 * `neutral_site` is false on every row, so it can't be used. Earlier NCAA rounds
 * are hosted on the higher seed's campus, so home advantage still applies there.
 */
export function isNeutralSite(roundDescription: string | null | undefined): boolean {
	return roundDescription === 'Semifinals' || roundDescription === 'Championship';
}

/** Home / draw / away probabilities, summing to 1. */
export function predict(
	eloHome: number,
	eloAway: number,
	sport: string,
	neutral = false
): Prediction {
	const m = MODELS[sport === 'WSO' ? 'WSO' : 'MSO'];
	const g = m.scale * (eloHome - eloAway) + (neutral ? 0 : m.homeAdv);
	const e = 1 / (1 + Math.pow(10, -g / 400));
	const draw = Math.min(DRAW_MAX, Math.max(DRAW_MIN, m.drawBase + m.drawSlope * Math.abs(g)));

	// The floor only bites at absurd gaps (~600+ scaled points); renormalise after.
	const home = Math.max(0.01, e - draw / 2);
	const away = Math.max(0.01, 1 - e - draw / 2);
	const total = home + draw + away;
	return { home: home / total, draw: draw / total, away: away / total };
}

/**
 * Whole-number percentages that still sum to exactly 100 (largest remainder),
 * so the three-way bar never reads 34 / 33 / 34.
 */
export function toPercents(p: Prediction): Prediction {
	const keys: PickOutcome[] = ['home', 'draw', 'away'];
	const raw = keys.map((k) => p[k] * 100);
	const floored = raw.map(Math.floor);
	let short = 100 - floored.reduce((a, b) => a + b, 0);
	const order = keys
		.map((_, i) => i)
		.sort((a, b) => raw[b] - floored[b] - (raw[a] - floored[a]));
	for (const i of order) {
		if (short <= 0) break;
		floored[i]++;
		short--;
	}
	return { home: floored[0], draw: floored[1], away: floored[2] };
}
