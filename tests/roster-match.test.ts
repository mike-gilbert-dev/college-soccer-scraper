// @ts-nocheck -- uses node:test/node:assert; run via the node runtime, not svelte-check.
// Unit tests for the pure roster matcher. Run with node's built-in test runner:
//   node --experimental-strip-types --test tests/roster-match.test.ts
// (kept outside src/ so svelte-check does not include it.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, matchRoster, type ExistingPlayerSeason } from '../src/lib/server/roster-match.ts';
import type { ParsedRosterPlayer } from '../src/lib/server/sidearm.ts';

function entry(p: Partial<ParsedRosterPlayer>): ParsedRosterPlayer {
	return {
		firstName: '', lastName: '', jerseyNumber: null, position: null,
		classYear: null, height: null, hometown: null, headshotUrl: null, externalRef: null, ...p
	};
}
function ps(o: Partial<ExistingPlayerSeason> & { id: number; name: string }): ExistingPlayerSeason {
	return { player_id: o.id * 10, jerseyNumber: null, position: null, ...o };
}

test('normalizeName strips diacritics without splitting words', () => {
	assert.equal(normalizeName('José Peña'), 'jose pena');
	assert.equal(normalizeName('  Świderski-Smith  '), 'swiderski smith');
	assert.equal(normalizeName("D'Angelo  O'Brien"), 'd angelo o brien');
});

test('unique full-name match -> matched', () => {
	const existing = [ps({ id: 1, name: 'Ervin Cruz', jerseyNumber: 2 })];
	const [r] = matchRoster([entry({ firstName: 'Ervin', lastName: 'Cruz', jerseyNumber: 2 })], existing);
	assert.equal(r.status, 'matched');
	assert.equal(r.playerSeasonId, 1);
	assert.equal(r.playerId, 10);
	assert.equal(r.jerseyMismatch, false);
});

test('name match with different jersey -> matched but jerseyMismatch flagged', () => {
	const existing = [ps({ id: 1, name: 'Ervin Cruz', jerseyNumber: 2 })];
	const [r] = matchRoster([entry({ firstName: 'Ervin', lastName: 'Cruz', jerseyNumber: 9 })], existing);
	assert.equal(r.status, 'matched');
	assert.equal(r.jerseyMismatch, true);
});

test('diacritic-only difference still matches', () => {
	const existing = [ps({ id: 5, name: 'Jose Pena', jerseyNumber: 7 })];
	const [r] = matchRoster([entry({ firstName: 'José', lastName: 'Peña', jerseyNumber: 7 })], existing);
	assert.equal(r.status, 'matched');
	assert.equal(r.playerSeasonId, 5);
});

test('duplicate names -> ambiguous, jersey suggests one', () => {
	const existing = [
		ps({ id: 1, name: 'Alex Smith', jerseyNumber: 4 }),
		ps({ id: 2, name: 'Alex Smith', jerseyNumber: 8 })
	];
	const [r] = matchRoster([entry({ firstName: 'Alex', lastName: 'Smith', jerseyNumber: 8 })], existing);
	assert.equal(r.status, 'ambiguous');
	assert.equal(r.suggestedPlayerSeasonId, 2);
});

test('no full-name match but last-name + jersey -> ambiguous with suggestion', () => {
	const existing = [ps({ id: 3, name: 'Alexander Jones', jerseyNumber: 11 })];
	const [r] = matchRoster([entry({ firstName: 'Alex', lastName: 'Jones', jerseyNumber: 11 })], existing);
	assert.equal(r.status, 'ambiguous');
	assert.equal(r.suggestedPlayerSeasonId, 3);
});

test('no plausible match -> unmatched', () => {
	const existing = [ps({ id: 1, name: 'Ervin Cruz', jerseyNumber: 2 })];
	const [r] = matchRoster([entry({ firstName: 'Brand', lastName: 'New', jerseyNumber: 99 })], existing);
	assert.equal(r.status, 'unmatched');
	assert.equal(r.suggestedPlayerSeasonId, null);
});
