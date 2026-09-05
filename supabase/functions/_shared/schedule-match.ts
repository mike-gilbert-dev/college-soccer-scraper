// Pure matching engine: connect a school's schedule events to rows in `games`.
//
// School schedule pages carry no NCAA contest id, so events are matched by
// inference. The key is (team_season_id, contest_date), which is very nearly
// deterministic: across the 2025 and 2026 seasons, 20,386 of 20,428
// (team-season, date) pairs map to exactly one game — only 42 are
// doubleheaders. So this mirrors roster-match.ts: an exact key match with a
// second field as CONFIRMER, not as the key.
//
// This module never creates a game. The NCAA feed owns which games exist;
// anything that does not match is queued for review.
//
// Pure (no DB, no IO) so it is unit testable; the stream-ingest edge function
// inlines a copy.

import { normalizeName } from './names.ts';
import type { ParsedScheduleEvent } from './schedule.ts';

/** A game this team-season plays, as loaded for one source. */
export interface CandidateGame {
	id: number;
	contestDate: string; // YYYY-MM-DD
	/** The OTHER team's display names, for the opponent confirmer. */
	opponentNames: string[];
	/** Which side the scraping school is on. */
	side: 'home' | 'away';
}

export type ScheduleMatchStatus = 'matched' | 'ambiguous' | 'unmatched';

export interface ScheduleMatchResult {
	event: ParsedScheduleEvent;
	status: ScheduleMatchStatus;
	gameId: number | null; // set when matched
	suggestedGameId: number | null; // set when ambiguous and resolvable
	sourceSide: 'home' | 'away' | null;
	reason: string;
}

/**
 * Does the school's opponent string refer to this team?
 *
 * Schools abbreviate freely ("Florida International" vs "FIU", "Loyola
 * Marymount" vs "LMU"), so this is deliberately generous: an exact normalized
 * hit, or either name containing the other. It is a confirmer on an already
 * near-unique key, not the key itself — being generous here costs almost
 * nothing and rejects the genuinely wrong pairing.
 */
export function opponentMatches(eventOpponent: string | null, candidateNames: string[]): boolean {
	const a = normalizeName(eventOpponent);
	if (!a) return false;
	for (const raw of candidateNames) {
		const b = normalizeName(raw);
		if (!b) continue;
		if (a === b) return true;
		if (a.length >= 4 && b.includes(a)) return true;
		if (b.length >= 4 && a.includes(b)) return true;
	}
	return false;
}

/** Shift a YYYY-MM-DD date by whole days, UTC-safe. */
function shiftDate(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/**
 * Classify each scraped event against the games this team-season actually
 * plays. Returns one result per event, no side effects.
 */
export function matchScheduleEvents(
	events: ParsedScheduleEvent[],
	games: CandidateGame[]
): ScheduleMatchResult[] {
	const byDate = new Map<string, CandidateGame[]>();
	for (const g of games) {
		const a = byDate.get(g.contestDate);
		if (a) a.push(g);
		else byDate.set(g.contestDate, [g]);
	}

	const results: ScheduleMatchResult[] = [];

	for (const event of events) {
		const base: Omit<ScheduleMatchResult, 'status' | 'reason'> = {
			event,
			gameId: null,
			suggestedGameId: null,
			sourceSide: null
		};

		if (!event.date) {
			results.push({ ...base, status: 'unmatched', reason: 'event has no parseable date' });
			continue;
		}

		const sameDay = byDate.get(event.date) ?? [];

		// The overwhelmingly common case: exactly one game on that date.
		if (sameDay.length === 1) {
			const g = sameDay[0];
			// Opponent is a confirmer. When the school names an opponent we
			// don't recognize, trust the date key but say so — abbreviations are
			// endemic and a false negative here loses a real link.
			const confirmed = opponentMatches(event.opponentName, g.opponentNames);
			results.push({
				...base,
				status: 'matched',
				gameId: g.id,
				sourceSide: g.side,
				reason: confirmed ? 'date + opponent' : 'date only (opponent name unrecognized)'
			});
			continue;
		}

		// Doubleheader: 42 cases in two seasons. Here the opponent name is
		// load-bearing rather than confirmatory.
		if (sameDay.length > 1) {
			const hits = sameDay.filter((g) => opponentMatches(event.opponentName, g.opponentNames));
			if (hits.length === 1) {
				results.push({
					...base,
					status: 'matched',
					gameId: hits[0].id,
					sourceSide: hits[0].side,
					reason: 'doubleheader resolved by opponent'
				});
			} else {
				results.push({
					...base,
					status: 'ambiguous',
					suggestedGameId: sameDay[0].id,
					reason: `${sameDay.length} games on ${event.date}, opponent matched ${hits.length}`
				});
			}
			continue;
		}

		// No game on that date. Late-Pacific and Hawaii kickoffs can land on a
		// different calendar date on the school's page than in the NCAA feed, so
		// try the neighbours — but ONLY with an opponent confirmation, since the
		// date key is what we just gave up.
		for (const delta of [-1, 1]) {
			const near = byDate.get(shiftDate(event.date, delta)) ?? [];
			const hits = near.filter((g) => opponentMatches(event.opponentName, g.opponentNames));
			if (hits.length === 1) {
				results.push({
					...base,
					status: 'matched',
					gameId: hits[0].id,
					sourceSide: hits[0].side,
					reason: `date off by ${delta}d, opponent confirmed`
				});
				break;
			}
		}
		if (results.length && results[results.length - 1].event === event) continue;

		results.push({
			...base,
			status: 'unmatched',
			reason: `no game on ${event.date} for this team-season`
		});
	}

	return results;
}
