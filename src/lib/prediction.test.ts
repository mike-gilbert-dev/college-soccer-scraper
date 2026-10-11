import { describe, it, expect } from 'vitest';
import { predict, toPercents, isNeutralSite } from './prediction';

const sum = (p: { home: number; draw: number; away: number }) => p.home + p.draw + p.away;

describe('predict', () => {
	it('sums to 1', () => {
		for (const [h, a] of [[1500, 1500], [1800, 1300], [1200, 1900]]) {
			expect(sum(predict(h, a, 'MSO'))).toBeCloseTo(1, 10);
			expect(sum(predict(h, a, 'WSO'))).toBeCloseTo(1, 10);
		}
	});

	it('favours the home side between equal teams', () => {
		const p = predict(1500, 1500, 'MSO');
		expect(p.home).toBeGreaterThan(p.away);
	});

	it('is symmetric at a neutral site', () => {
		const p = predict(1500, 1500, 'WSO', true);
		expect(p.home).toBeCloseTo(p.away, 10);
	});

	it('mirrors when the teams swap at a neutral site', () => {
		const a = predict(1650, 1500, 'MSO', true);
		const b = predict(1500, 1650, 'MSO', true);
		expect(a.home).toBeCloseTo(b.away, 10);
		expect(a.draw).toBeCloseTo(b.draw, 10);
	});

	it('draws are likeliest between even teams and shrink as the gap grows', () => {
		const even = predict(1500, 1500, 'MSO', true).draw;
		const mid = predict(1650, 1500, 'MSO', true).draw;
		const far = predict(1900, 1500, 'MSO', true).draw;
		expect(even).toBeGreaterThan(mid);
		expect(mid).toBeGreaterThan(far);
		// Near the ~22% league draw rate between even teams.
		expect(even).toBeGreaterThan(0.2);
		expect(even).toBeLessThan(0.3);
	});

	it('never returns a zero probability at an extreme gap', () => {
		const p = predict(2200, 1000, 'WSO');
		expect(p.away).toBeGreaterThan(0);
		expect(p.draw).toBeGreaterThan(0);
		expect(sum(p)).toBeCloseTo(1, 10);
	});
});

describe('toPercents', () => {
	it('always sums to exactly 100', () => {
		for (const [h, a] of [[1500, 1500], [1610, 1490], [1333, 1777], [1500, 1501]]) {
			const p = toPercents(predict(h, a, 'MSO'));
			expect(p.home + p.draw + p.away).toBe(100);
		}
	});

	it('handles a three-way split without rounding to 101', () => {
		expect(toPercents({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 })).toEqual({ home: 34, draw: 33, away: 33 });
	});
});

describe('isNeutralSite', () => {
	it('is the College Cup only', () => {
		expect(isNeutralSite('Semifinals')).toBe(true);
		expect(isNeutralSite('Championship')).toBe(true);
		// Earlier rounds are hosted by the higher seed.
		expect(isNeutralSite('Quarterfinals')).toBe(false);
		expect(isNeutralSite('First Round')).toBe(false);
		expect(isNeutralSite(null)).toBe(false);
		expect(isNeutralSite('')).toBe(false);
	});
});
