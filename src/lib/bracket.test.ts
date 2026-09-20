import { describe, it, expect } from 'vitest';
import {
	buildBracket,
	bracketChampion,
	toBracketGame,
	winnerTeamId,
	splitBracket,
	layoutColumns,
	cardX,
	CARD_H,
	CARD_W,
	COL_STEP,
	BOARD_MAX_W,
	type BracketGameRow
} from './bracket';
import rows2025 from './__fixtures__/bracket-2025-mso.json';

const real = (rows2025 as BracketGameRow[]).map(toBracketGame);

/** Minimal row builder for the synthetic cases. */
function row(
	id: number,
	roundOrder: number,
	round: string,
	home: [number, string, number | null],
	away: [number, string, number | null],
	opts: { status?: string; shootout?: boolean; winner?: 'home' | 'away' } = {}
): BracketGameRow {
	const status = opts.status ?? 'final';
	const decided = status === 'final' && opts.winner !== undefined;
	return {
		game_id: id,
		ncaa_contest_id: String(9000 + id),
		round_description: round,
		round_order: roundOrder,
		contest_date: '2025-11-20',
		start_time: null,
		status,
		shootout: opts.shootout ?? false,
		home_team_id: home[0],
		home_name: home[1],
		home_short_name: home[1],
		home_ncaa_team_id: home[1],
		home_logo_dark: null,
		home_logo_light: null,
		home_score: home[2],
		home_seed: null,
		home_won: decided ? opts.winner === 'home' : null,
		away_team_id: away[0],
		away_name: away[1],
		away_short_name: away[1],
		away_ncaa_team_id: away[1],
		away_logo_dark: null,
		away_logo_light: null,
		away_score: away[2],
		away_seed: null,
		away_won: decided ? opts.winner === 'away' : null
	};
}

describe('buildBracket', () => {
	it('returns no rounds for an empty bracket', () => {
		expect(buildBracket([])).toEqual([]);
	});

	it('orders rounds left-to-right by round_order', () => {
		const rounds = buildBracket(real);
		expect(rounds.map((r) => r.round)).toEqual([
			'First Round',
			'Second Round',
			'Third Round',
			'Quarterfinals',
			'Semifinals',
			'Championship'
		]);
	});

	it('keeps every game — a 48-team field is 16/16/8/4/2/1', () => {
		const rounds = buildBracket(real);
		expect(rounds.map((r) => r.games.length)).toEqual([16, 16, 8, 4, 2, 1]);
		expect(rounds.reduce((n, r) => n + r.games.length, 0)).toBe(real.length);
	});

	it('places each game adjacent to the games feeding it', () => {
		const rounds = buildBracket(real);
		// Walking right-to-left, the two teams of semifinal i must be the winners
		// of quarterfinals 2i and 2i+1 (in some order) once byes are absent.
		const qf = rounds[3].games;
		const sf = rounds[4].games;
		for (let i = 0; i < sf.length; i++) {
			const sides = [sf[i].home.teamId, sf[i].away.teamId];
			const feeders = [winnerTeamId(qf[2 * i]), winnerTeamId(qf[2 * i + 1])];
			expect(feeders.every((f) => sides.includes(f))).toBe(true);
		}
	});

	it('links the real 2025 final back to both semifinals', () => {
		const rounds = buildBracket(real);
		const final = rounds[5].games[0];
		const semiWinners = rounds[4].games.map(winnerTeamId);
		expect(semiWinners).toContain(final.home.teamId);
		expect(semiWinners).toContain(final.away.teamId);
	});

	it('names the champion', () => {
		const champ = bracketChampion(buildBracket(real));
		expect(champ?.name).toBe('Washington');
	});

	it('leaves the champion null while the final is unplayed', () => {
		const scheduled = real.map((g) =>
			g.roundOrder === 6
				? { ...g, status: 'scheduled', home: { ...g.home, won: null }, away: { ...g.away, won: null } }
				: g
		);
		expect(bracketChampion(buildBracket(scheduled))).toBeNull();
	});

	// A bye is the absence of a game, so a seeded team entering in round two has
	// no feeder and must not invent an empty slot in round one.
	it('handles byes without inventing games', () => {
		const games = [
			row(1, 1, 'First Round', [10, 'Ten', 2], [11, 'Eleven', 1], { winner: 'home' }),
			row(2, 2, 'Second Round', [20, 'Seed', 3], [10, 'Ten', 0], { winner: 'home' })
		].map(toBracketGame);
		const rounds = buildBracket(games);
		expect(rounds.map((r) => r.games.length)).toEqual([1, 1]);
		expect(rounds[0].games[0].gameId).toBe(1);
	});

	// The score stays tied in a shootout, so the advancing side is only knowable
	// from the winner flags the RPC derives from shootout_winner_team_season_id.
	it('advances the shootout winner despite a tied score', () => {
		const games = [
			row(1, 1, 'First Round', [10, 'Ten', 1], [11, 'Eleven', 1], {
				shootout: true,
				winner: 'away'
			}),
			row(2, 2, 'Second Round', [11, 'Eleven', 2], [20, 'Seed', 0], { winner: 'home' })
		].map(toBracketGame);
		const rounds = buildBracket(games);
		expect(winnerTeamId(rounds[0].games[0])).toBe(11);
		// The shootout game must be reachable from round two, i.e. it linked up.
		expect(rounds[1].games[0].home.teamId).toBe(11);
	});

	it('still renders a released-but-unplayed bracket', () => {
		const games = [
			row(1, 1, 'First Round', [10, 'Ten', null], [11, 'Eleven', null], { status: 'scheduled' }),
			row(2, 1, 'First Round', [12, 'Twelve', null], [13, 'Thirteen', null], { status: 'scheduled' })
		].map(toBracketGame);
		const rounds = buildBracket(games);
		expect(rounds).toHaveLength(1);
		expect(rounds[0].games).toHaveLength(2);
		expect(bracketChampion(rounds)).toBeNull();
	});

	// Nothing may be silently dropped: a round whose winners have not yet produced
	// a later game is unreachable by the right-to-left walk and must still appear.
	it('keeps games unreachable from the last round', () => {
		const games = [
			row(1, 1, 'First Round', [10, 'Ten', 2], [11, 'Eleven', 1], { winner: 'home' }),
			row(2, 1, 'First Round', [12, 'Twelve', 2], [13, 'Thirteen', 1], { winner: 'home' }),
			// Only one of the two first-round winners has a second-round game so far.
			row(3, 2, 'Second Round', [10, 'Ten', 1], [20, 'Seed', 0], { winner: 'home' })
		].map(toBracketGame);
		const rounds = buildBracket(games);
		expect(rounds[0].games.map((g) => g.gameId).sort()).toEqual([1, 2]);
	});
});

describe('splitBracket', () => {
	const split = splitBracket(buildBracket(real));

	it('folds a full bracket into the mirrored NCAA shape', () => {
		expect(split.mode).toBe('mirrored');
	});

	it('makes two halves of two quadrants, each quadrant 4/4/2/1', () => {
		if (split.mode !== 'mirrored') throw new Error('expected mirrored');
		expect(split.halves).toHaveLength(2);
		for (const half of split.halves) {
			for (const q of [half.top, half.bottom]) {
				expect(q.columns).toBe(4);
				const perCol = [0, 1, 2, 3].map((c) => q.games.filter((g) => g.col === c).length);
				expect(perCol).toEqual([4, 4, 2, 1]);
			}
		}
	});

	it('accounts for every game exactly once', () => {
		if (split.mode !== 'mirrored') throw new Error('expected mirrored');
		const ids = new Set<number>();
		for (const half of split.halves) {
			for (const q of [half.top, half.bottom]) for (const p of q.games) ids.add(p.game.gameId);
			if (half.semifinal) ids.add(half.semifinal.gameId);
		}
		if (split.final) ids.add(split.final.gameId);
		expect(ids.size).toBe(real.length);
	});

	// The pairing that the NCAA board uses and that a band-wise grouping gets
	// wrong: a half's TOP and BOTTOM quadrants feed the same semifinal.
	it('feeds each semifinal from its own half, top and bottom', () => {
		if (split.mode !== 'mirrored') throw new Error('expected mirrored');
		for (const half of split.halves) {
			const qfWinners = [half.top, half.bottom]
				.map((q) => q.games.find((p) => p.col === 3))
				.map((p) => (p ? winnerTeamId(p.game) : null));
			const semi = half.semifinal!;
			const semiSides = [semi.home.teamId, semi.away.teamId];
			for (const w of qfWinners) expect(semiSides).toContain(w);
		}
	});

	// The whole point of folding: a 48-team field is 16 games in one stack.
	it('is shorter than the flat board it replaces', () => {
		if (split.mode !== 'mirrored') throw new Error('expected mirrored');
		const tallest = Math.max(...split.halves.flatMap((h) => [h.top.height, h.bottom.height]));
		// Four first-round games per quadrant, not sixteen.
		expect(tallest).toBeLessThan(16 * 54);
		// Must clear the scroll container's own border and padding, not just the
		// page gutter — see BOARD_MAX_W. Being 2px over shows a scrollbar at full width.
		expect(split.width).toBeLessThanOrEqual(BOARD_MAX_W);
	});

	it('falls back to flat columns before the quarterfinals exist', () => {
		const early = buildBracket(real.filter((g) => g.roundOrder <= 2));
		expect(splitBracket(early).mode).toBe('flat');
	});
});

describe('layoutColumns', () => {
	// The bug this geometry exists to fix. Georgetown (seed 7) byed; UCF won the
	// first round and entered the AWAY slot. Centring the two cards level makes
	// Georgetown look like a participant in UCF vs FAU.
	it('offsets a bye so the feeder meets the slot it actually feeds', () => {
		const r1 = row(1, 1, 'First Round', [10, 'UCF', 3], [11, 'FAU', 2], { winner: 'home' });
		const r2 = row(2, 2, 'Second Round', [20, 'GTOWN', 2], [10, 'UCF', 0], { winner: 'home' });
		const { games } = layoutColumns([[r1].map(toBracketGame), [r2].map(toBracketGame)]);
		const feeder = games.find((g) => g.game.gameId === 1)!;
		const fed = games.find((g) => g.game.gameId === 2)!;
		// UCF sits in the away (lower) slot, so the fed card rides a quarter-card up
		// and the feeder lines up with that slot rather than the card's middle.
		expect(fed.y).toBe(feeder.y - CARD_H / 4);
		const awaySlotCentre = fed.y + CARD_H / 4;
		expect(awaySlotCentre).toBe(feeder.y);
	});

	it('mirrors the offset when the feeder enters the home slot', () => {
		const r1 = row(1, 1, 'First Round', [10, 'Ten', 3], [11, 'Eleven', 2], { winner: 'home' });
		const r2 = row(2, 2, 'Second Round', [10, 'Ten', 1], [20, 'Seed', 0], { winner: 'home' });
		const { games } = layoutColumns([[r1].map(toBracketGame), [r2].map(toBracketGame)]);
		const feeder = games.find((g) => g.game.gameId === 1)!;
		const fed = games.find((g) => g.game.gameId === 2)!;
		expect(fed.y).toBe(feeder.y + CARD_H / 4);
		expect(fed.y - CARD_H / 4).toBe(feeder.y);
	});

	it('centres a game between two feeders', () => {
		const cols = [
			[
				row(1, 1, 'First Round', [10, 'A', 1], [11, 'B', 0], { winner: 'home' }),
				row(2, 1, 'First Round', [12, 'C', 1], [13, 'D', 0], { winner: 'home' })
			].map(toBracketGame),
			[row(3, 2, 'Second Round', [10, 'A', 1], [12, 'C', 0], { winner: 'home' })].map(toBracketGame)
		];
		const { games } = layoutColumns(cols);
		const [f1, f2] = [1, 2].map((id) => games.find((g) => g.game.gameId === id)!);
		const fed = games.find((g) => g.game.gameId === 3)!;
		expect(fed.y).toBe((f1.y + f2.y) / 2);
	});

	it('records a link for every feeder edge', () => {
		const { links } = layoutColumns([
			[row(1, 1, 'First Round', [10, 'A', 1], [11, 'B', 0], { winner: 'home' })].map(toBracketGame),
			[row(2, 2, 'Second Round', [20, 'S', 1], [10, 'A', 0], { winner: 'home' })].map(toBracketGame)
		]);
		expect(links).toEqual([{ fromGameId: 1, toGameId: 2, side: 'away' }]);
	});

	it('never overlaps two cards in the same column', () => {
		const split = splitBracket(buildBracket(real));
		if (split.mode !== 'mirrored') throw new Error('expected mirrored');
		for (const half of split.halves) {
			for (const q of [half.top, half.bottom]) {
				for (let c = 0; c < q.columns; c++) {
					const ys = q.games.filter((g) => g.col === c).map((g) => g.y).sort((a, b) => a - b);
					for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(CARD_H);
				}
			}
		}
	});
});

describe('cardX', () => {
	it('runs a normal quadrant left-to-right and a mirrored one right-to-left', () => {
		const split = splitBracket(buildBracket(real));
		if (split.mode !== 'mirrored') throw new Error('expected mirrored');
		const q = split.halves[0].top;
		const first = q.games.find((g) => g.col === 0)!;
		const last = q.games.find((g) => g.col === 3)!;
		expect(cardX(first, q, false)).toBe(0);
		expect(cardX(last, q, false)).toBe(3 * COL_STEP);
		// Mirrored: the earliest round sits at the outer edge instead.
		expect(cardX(first, q, true)).toBe(q.width - CARD_W);
		expect(cardX(last, q, true)).toBe(q.width - CARD_W - 3 * COL_STEP);
	});
});
