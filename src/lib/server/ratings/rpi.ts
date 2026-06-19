// NCAA soccer Rating Percentage Index (RPI). Pure and side-effect free.
//
//   RPI = 0.25*WP + 0.50*OWP + 0.25*OOWP
//
//   WP   — the team's own winning percentage, with results location-weighted
//          (a road result counts more than the same result at home).
//   OWP  — average of each opponent's UNWEIGHTED winning percentage, computed
//          excluding games against the team in question.
//   OOWP — average of each opponent's OWP.
//
// The pool is whatever team_seasons appear in `games`; the recompute pipeline
// already restricts `games` to one (sport, division, season), so every team
// here shares a division and out-of-pool opponents never enter the math.

import {
	RPI_WP_WEIGHT,
	RPI_OWP_WEIGHT,
	RPI_OOWP_WEIGHT,
	RPI_TIE_WEIGHT,
	rpiWinWeight,
	rpiLossWeight
} from './config';
import type { GameInput, RatingRow } from './types';

type Outcome = 'W' | 'L' | 'T';
type Location = 'home' | 'away' | 'neutral';
interface Appearance {
	opp: number;
	outcome: Outcome;
	location: Location;
}

function push(map: Map<number, Appearance[]>, team: number, app: Appearance): void {
	const list = map.get(team);
	if (list) list.push(app);
	else map.set(team, [app]);
}

/** Unweighted winning percentage = (wins + 0.5*ties) / games, optionally
 *  excluding every game against `excludeOpp`. Returns 0 when no games remain. */
function unweightedWp(apps: Appearance[], excludeOpp: number | null): number {
	let wins = 0;
	let ties = 0;
	let games = 0;
	for (const a of apps) {
		if (excludeOpp !== null && a.opp === excludeOpp) continue;
		games++;
		if (a.outcome === 'W') wins++;
		else if (a.outcome === 'T') ties++;
	}
	return games === 0 ? 0 : (wins + 0.5 * ties) / games;
}

/** Location-weighted winning percentage — the WP term of RPI. */
function weightedWp(apps: Appearance[]): number {
	let weightedWins = 0;
	let weightedLosses = 0;
	let weightedTies = 0;
	for (const a of apps) {
		if (a.outcome === 'W') weightedWins += rpiWinWeight(a.location);
		else if (a.outcome === 'L') weightedLosses += rpiLossWeight(a.location);
		else weightedTies += RPI_TIE_WEIGHT;
	}
	const denom = weightedWins + weightedLosses + weightedTies;
	return denom === 0 ? 0 : (weightedWins + 0.5 * weightedTies) / denom;
}

export function computeRpi(games: GameInput[]): RatingRow[] {
	const apps = new Map<number, Appearance[]>();
	let maxDate = '';

	for (const g of games) {
		if (!Number.isFinite(g.homeScore) || !Number.isFinite(g.awayScore)) continue;
		if (g.contestDate > maxDate) maxDate = g.contestDate;

		const homeOutcome: Outcome =
			g.homeScore > g.awayScore ? 'W' : g.homeScore < g.awayScore ? 'L' : 'T';
		const awayOutcome: Outcome = homeOutcome === 'W' ? 'L' : homeOutcome === 'L' ? 'W' : 'T';
		const homeLoc: Location = g.neutralSite ? 'neutral' : 'home';
		const awayLoc: Location = g.neutralSite ? 'neutral' : 'away';

		push(apps, g.homeTeamSeasonId, { opp: g.awayTeamSeasonId, outcome: homeOutcome, location: homeLoc });
		push(apps, g.awayTeamSeasonId, { opp: g.homeTeamSeasonId, outcome: awayOutcome, location: awayLoc });
	}

	const teamIds = [...apps.keys()];

	// OWP per team: mean over its games of the opponent's unweighted WP with all
	// games against this team removed. Opponents repeat with game multiplicity.
	const owp = new Map<number, number>();
	for (const team of teamIds) {
		const myApps = apps.get(team)!;
		let sum = 0;
		for (const a of myApps) {
			sum += unweightedWp(apps.get(a.opp) ?? [], team);
		}
		owp.set(team, myApps.length === 0 ? 0 : sum / myApps.length);
	}

	// OOWP per team: mean over its games of each opponent's (full) OWP.
	const rows: RatingRow[] = [];
	for (const team of teamIds) {
		const myApps = apps.get(team)!;
		let oowpSum = 0;
		for (const a of myApps) oowpSum += owp.get(a.opp) ?? 0;
		const oowp = myApps.length === 0 ? 0 : oowpSum / myApps.length;

		const wp = weightedWp(myApps);
		const teamOwp = owp.get(team) ?? 0;
		const value = RPI_WP_WEIGHT * wp + RPI_OWP_WEIGHT * teamOwp + RPI_OOWP_WEIGHT * oowp;

		rows.push({
			teamSeasonId: team,
			system: 'rpi',
			asOf: maxDate,
			value,
			gamesPlayed: myApps.length,
			meta: { wp, owp: teamOwp, oowp }
		});
	}

	return rows;
}
