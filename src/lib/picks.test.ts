import { describe, it, expect } from 'vitest';
import { actualOutcome, gradePick, isGameOpen } from './picks';

const final = (home: number | null, away: number | null) => ({
	status: 'final',
	home_score: home,
	away_score: away
});

describe('actualOutcome', () => {
	it('reads a home win', () => {
		expect(actualOutcome(final(2, 1))).toBe('home');
		expect(actualOutcome(final(1, 0))).toBe('home');
	});

	it('reads an away win', () => {
		expect(actualOutcome(final(0, 1))).toBe('away');
		expect(actualOutcome(final(2, 5))).toBe('away');
	});

	it('reads a draw, including 0-0', () => {
		expect(actualOutcome(final(0, 0))).toBe('draw');
		expect(actualOutcome(final(2, 2))).toBe('draw');
	});

	it('treats a shootout as a draw — the winner is deliberately ignored', () => {
		// A PK game keeps its tied score. The site counts it as a tie in W-L-T,
		// Elo and RPI, so grading must agree.
		const shootout = {
			status: 'final',
			home_score: 1,
			away_score: 1,
			shootout: true,
			shootout_winner_team_season_id: 4321
		};
		expect(actualOutcome(shootout)).toBe('draw');
	});

	it('returns null when scores are missing', () => {
		expect(actualOutcome(final(null, null))).toBeNull();
		expect(actualOutcome(final(1, null))).toBeNull();
		expect(actualOutcome(final(null, 1))).toBeNull();
	});

	it('returns null for any non-final status', () => {
		for (const status of ['scheduled', 'live', 'postponed', 'cancelled']) {
			expect(actualOutcome({ status, home_score: 2, away_score: 1 }), status).toBeNull();
		}
	});
});

describe('gradePick', () => {
	it('grades correct picks as wins', () => {
		expect(gradePick('home', final(2, 1))).toBe('win');
		expect(gradePick('away', final(1, 2))).toBe('win');
		expect(gradePick('draw', final(1, 1))).toBe('win');
		expect(gradePick('draw', final(0, 0))).toBe('win');
	});

	it('grades incorrect picks as losses', () => {
		expect(gradePick('away', final(2, 1))).toBe('loss');
		expect(gradePick('draw', final(2, 1))).toBe('loss');
		expect(gradePick('home', final(1, 1))).toBe('loss');
		expect(gradePick('home', final(0, 2))).toBe('loss');
	});

	it('grades a shootout as a draw for every pick', () => {
		const shootout = { status: 'final', home_score: 2, away_score: 2 };
		expect(gradePick('draw', shootout)).toBe('win');
		expect(gradePick('home', shootout)).toBe('loss');
		expect(gradePick('away', shootout)).toBe('loss');
	});

	it('voids cancelled games regardless of pick', () => {
		const cancelled = { status: 'cancelled', home_score: null, away_score: null };
		expect(gradePick('home', cancelled)).toBe('void');
		expect(gradePick('draw', cancelled)).toBe('void');
	});

	it('leaves postponed games ungraded', () => {
		expect(gradePick('home', { status: 'postponed', home_score: null, away_score: null })).toBeNull();
	});

	it('leaves scheduled and live games ungraded', () => {
		expect(gradePick('home', { status: 'scheduled', home_score: null, away_score: null })).toBeNull();
		expect(gradePick('home', { status: 'live', home_score: 1, away_score: 0 })).toBeNull();
	});
});

describe('isGameOpen', () => {
	const now = new Date('2026-08-12T18:00:00.000Z');

	it('is open before kickoff', () => {
		expect(
			isGameOpen(
				{ status: 'scheduled', start_time: '2026-08-12T23:00:00.000Z', contest_date: '2026-08-12' },
				now
			)
		).toBe(true);
	});

	it('is closed after kickoff', () => {
		expect(
			isGameOpen(
				{ status: 'scheduled', start_time: '2026-08-12T17:00:00.000Z', contest_date: '2026-08-12' },
				now
			)
		).toBe(false);
	});

	it('is closed exactly at kickoff', () => {
		expect(
			isGameOpen(
				{ status: 'scheduled', start_time: '2026-08-12T18:00:00.000Z', contest_date: '2026-08-12' },
				now
			)
		).toBe(false);
	});

	it('is open one second before kickoff and closed one second after', () => {
		const base = { status: 'scheduled', contest_date: '2026-08-12' };
		expect(isGameOpen({ ...base, start_time: '2026-08-12T18:00:01.000Z' }, now)).toBe(true);
		expect(isGameOpen({ ...base, start_time: '2026-08-12T17:59:59.000Z' }, now)).toBe(false);
	});

	it('is closed for every non-scheduled status, even before kickoff', () => {
		for (const status of ['live', 'final', 'postponed', 'cancelled']) {
			expect(
				isGameOpen({ status, start_time: '2026-08-12T23:00:00.000Z', contest_date: '2026-08-12' }, now),
				status
			).toBe(false);
		}
	});

	describe('null start_time falls back to midnight Eastern', () => {
		it('is open before midnight ET on game day (EDT, UTC-4)', () => {
			// 2026-08-13 00:00 EDT === 2026-08-13T04:00Z
			expect(
				isGameOpen(
					{ status: 'scheduled', start_time: null, contest_date: '2026-08-13' },
					new Date('2026-08-13T03:59:00.000Z')
				)
			).toBe(true);
		});

		it('is closed after midnight ET on game day', () => {
			expect(
				isGameOpen(
					{ status: 'scheduled', start_time: null, contest_date: '2026-08-13' },
					new Date('2026-08-13T04:01:00.000Z')
				)
			).toBe(false);
		});

		it('uses EST (UTC-5) after the November DST change', () => {
			// 2026-11-20 00:00 EST === 2026-11-20T05:00Z
			expect(
				isGameOpen(
					{ status: 'scheduled', start_time: null, contest_date: '2026-11-20' },
					new Date('2026-11-20T04:59:00.000Z')
				)
			).toBe(true);
			expect(
				isGameOpen(
					{ status: 'scheduled', start_time: null, contest_date: '2026-11-20' },
					new Date('2026-11-20T05:01:00.000Z')
				)
			).toBe(false);
		});

		it('still uses EDT just before the November transition', () => {
			// DST ends the first Sunday of Nov 2026 = Nov 1. Oct 31 is still EDT.
			expect(
				isGameOpen(
					{ status: 'scheduled', start_time: null, contest_date: '2026-10-31' },
					new Date('2026-10-31T03:59:00.000Z')
				)
			).toBe(true);
		});
	});

	it('is closed for an unparseable date with no start_time', () => {
		expect(
			isGameOpen({ status: 'scheduled', start_time: null, contest_date: 'not-a-date' }, now)
		).toBe(false);
	});
});
