// Pure matching engine: connect external (Sidearm) roster entries to internal
// player_seasons within a single team-season. Internal players are themselves
// keyed off first/last name (from NCAA box scores) with a jersey on
// player_seasons, so matching is a normalized-name join with jersey as a
// confirmer/disambiguator. This module is pure (no DB, no IO) so it is unit
// testable; the roster-ingest edge function inlines a copy.

import type { ParsedRosterPlayer } from './sidearm';
import { normalizeName } from './names.ts';

/** Existing internal player_season for a team-season, joined to players.name. */
export interface ExistingPlayerSeason {
	id: number; // player_season id
	player_id: number;
	name: string; // players.name, "First Last"
	jerseyNumber: number | null;
	position: string | null;
}

export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

export interface MatchResult {
	entry: ParsedRosterPlayer;
	status: MatchStatus;
	playerSeasonId: number | null; // set when matched
	playerId: number | null; // set when matched
	suggestedPlayerSeasonId: number | null; // set when ambiguous and resolvable
	reason: string;
	jerseyMismatch: boolean; // confident match whose jersey differs (logged, not blocking)
}

// normalizeName moved to names.ts so schedule-match.ts can share the exact same
// comparison without importing this module (and the Sidearm roster types with
// it). Re-exported here so existing importers are unaffected.
export { normalizeName };

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
	const a = m.get(k);
	if (a) a.push(v);
	else m.set(k, [v]);
}

/**
 * Classify each external entry against the team-season's existing player_seasons.
 * Pure: returns one MatchResult per parsed entry, no side effects.
 */
export function matchRoster(
	parsed: ParsedRosterPlayer[],
	existing: ExistingPlayerSeason[]
): MatchResult[] {
	const byFull = new Map<string, ExistingPlayerSeason[]>();
	const byLast = new Map<string, ExistingPlayerSeason[]>();
	for (const e of existing) {
		const full = normalizeName(e.name);
		if (!full) continue;
		push(byFull, full, e);
		const parts = full.split(' ');
		push(byLast, parts[parts.length - 1], e);
	}

	const results: MatchResult[] = [];
	for (const entry of parsed) {
		const fullKey = normalizeName(`${entry.firstName} ${entry.lastName}`);
		const fullMatches = byFull.get(fullKey) ?? [];

		// 1. Unique full-name match -> confident.
		if (fullMatches.length === 1) {
			const m = fullMatches[0];
			const jerseyMismatch =
				entry.jerseyNumber !== null &&
				m.jerseyNumber !== null &&
				entry.jerseyNumber !== m.jerseyNumber;
			results.push({
				entry,
				status: 'matched',
				playerSeasonId: m.id,
				playerId: m.player_id,
				suggestedPlayerSeasonId: null,
				reason: jerseyMismatch
					? `unique name match; jersey differs (roster #${entry.jerseyNumber} vs internal #${m.jerseyNumber})`
					: 'unique name match',
				jerseyMismatch
			});
			continue;
		}

		// 2. Multiple same-name internals -> ambiguous (suggest via jersey if unique).
		if (fullMatches.length > 1) {
			const jResolved =
				entry.jerseyNumber !== null
					? fullMatches.filter((m) => m.jerseyNumber === entry.jerseyNumber)
					: [];
			const suggestion = jResolved.length === 1 ? jResolved[0].id : null;
			results.push({
				entry,
				status: 'ambiguous',
				playerSeasonId: null,
				playerId: null,
				suggestedPlayerSeasonId: suggestion,
				reason: `${fullMatches.length} internal players share this name${suggestion ? '; jersey resolves to one' : ''}`,
				jerseyMismatch: false
			});
			continue;
		}

		// 3. No full-name match -> unique last-name + jersey -> ambiguous w/ suggestion.
		const lastKey = normalizeName(entry.lastName);
		const lastMatches = byLast.get(lastKey) ?? [];
		const jLast =
			entry.jerseyNumber !== null
				? lastMatches.filter((m) => m.jerseyNumber === entry.jerseyNumber)
				: [];
		if (jLast.length === 1) {
			results.push({
				entry,
				status: 'ambiguous',
				playerSeasonId: null,
				playerId: null,
				suggestedPlayerSeasonId: jLast[0].id,
				reason: 'last name + jersey match (likely first-name/nickname variant)',
				jerseyMismatch: false
			});
			continue;
		}

		// 4. No plausible match -> unmatched (likely roster-only, e.g. freshman).
		results.push({
			entry,
			status: 'unmatched',
			playerSeasonId: null,
			playerId: null,
			suggestedPlayerSeasonId: null,
			reason: 'no plausible internal match',
			jerseyMismatch: false
		});
	}
	return results;
}
