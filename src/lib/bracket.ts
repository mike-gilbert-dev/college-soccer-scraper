// Bracket tree assembly. Pure — no Supabase, no Svelte — so it is unit-testable
// the same way username/pick grading are.
//
// The NCAA feed gives us a flat list of bracket games labelled by round. It does
// NOT give us the edges: nothing says which first-round game feeds which
// second-round game. We recover the edges from winner continuity — the team that
// won a round-N game is the team that appears in the round-N+1 game it feeds — and
// that is enough to lay the bracket out as a tree.

export type BracketSide = {
	teamId: number | null;
	name: string | null;
	shortName: string | null;
	ncaaTeamId: string | null;
	logoDark: string | null;
	logoLight: string | null;
	score: number | null;
	seed: number | null;
	won: boolean | null;
};

export type BracketGame = {
	gameId: number;
	ncaaContestId: string;
	round: string;
	roundOrder: number;
	contestDate: string;
	startTime: string | null;
	status: string;
	shootout: boolean;
	home: BracketSide;
	away: BracketSide;
};

/** One column of the rendered bracket. */
export type BracketRound = {
	round: string;
	roundOrder: number;
	games: BracketGame[];
};

/** A row as `get_bracket_games` returns it. */
export interface BracketGameRow {
	game_id: number;
	ncaa_contest_id: string;
	round_description: string;
	round_order: number;
	contest_date: string;
	start_time: string | null;
	status: string;
	shootout: boolean;
	home_team_id: number | null;
	home_name: string | null;
	home_short_name: string | null;
	home_ncaa_team_id: string | null;
	home_logo_dark: string | null;
	home_logo_light: string | null;
	home_score: number | null;
	home_seed: number | null;
	home_won: boolean | null;
	away_team_id: number | null;
	away_name: string | null;
	away_short_name: string | null;
	away_ncaa_team_id: string | null;
	away_logo_dark: string | null;
	away_logo_light: string | null;
	away_score: number | null;
	away_seed: number | null;
	away_won: boolean | null;
}

export function toBracketGame(r: BracketGameRow): BracketGame {
	return {
		gameId: r.game_id,
		ncaaContestId: r.ncaa_contest_id,
		round: r.round_description,
		roundOrder: r.round_order,
		contestDate: r.contest_date,
		startTime: r.start_time,
		status: r.status,
		shootout: r.shootout,
		home: {
			teamId: r.home_team_id,
			name: r.home_name,
			shortName: r.home_short_name,
			ncaaTeamId: r.home_ncaa_team_id,
			logoDark: r.home_logo_dark,
			logoLight: r.home_logo_light,
			score: r.home_score,
			seed: r.home_seed,
			won: r.home_won
		},
		away: {
			teamId: r.away_team_id,
			name: r.away_name,
			shortName: r.away_short_name,
			ncaaTeamId: r.away_ncaa_team_id,
			logoDark: r.away_logo_dark,
			logoLight: r.away_logo_light,
			score: r.away_score,
			seed: r.away_seed,
			won: r.away_won
		}
	};
}

/** The team that advanced, or null while the game is undecided. */
export function winnerTeamId(g: BracketGame): number | null {
	if (g.home.won) return g.home.teamId;
	if (g.away.won) return g.away.teamId;
	return null;
}

/**
 * Group games into ordered round columns, and order the games *within* each
 * column so that a game sits adjacent to the games that feed it.
 *
 * Ordering is derived from the last round backwards: the final's two teams each
 * trace to the semifinal they won, those semifinals' teams trace to quarterfinals,
 * and so on. Recursing in that order emits each round already sorted to line up
 * with the round to its right, which is what makes the connector lines meet.
 *
 * A team with a bye simply has no feeder game, so it contributes nothing to the
 * earlier column — which is exactly right, since a bye is the absence of a game.
 *
 * Games unreachable from the last round (an in-progress round whose winners have
 * not yet produced a later game, or a season where only round one has been played)
 * are appended in feed order so nothing is ever silently dropped.
 */
export function buildBracket(games: BracketGame[]): BracketRound[] {
	if (!games.length) return [];

	const byRound = new Map<number, BracketGame[]>();
	for (const g of games) {
		const list = byRound.get(g.roundOrder);
		if (list) list.push(g);
		else byRound.set(g.roundOrder, [g]);
	}
	const roundOrders = [...byRound.keys()].sort((a, b) => a - b);

	// For each round, index games by each participating team so a later round can
	// ask "which game did this team come from?".
	const feederByRound = new Map<number, Map<number, BracketGame>>();
	for (const ro of roundOrders) {
		const idx = new Map<number, BracketGame>();
		for (const g of byRound.get(ro)!) {
			const w = winnerTeamId(g);
			// Index by winner when decided; by both sides otherwise, so an
			// in-progress bracket still links up once the later game appears.
			if (w !== null) idx.set(w, g);
			else {
				if (g.home.teamId !== null && !idx.has(g.home.teamId)) idx.set(g.home.teamId, g);
				if (g.away.teamId !== null && !idx.has(g.away.teamId)) idx.set(g.away.teamId, g);
			}
		}
		feederByRound.set(ro, idx);
	}

	const ordered = new Map<number, BracketGame[]>(roundOrders.map((ro) => [ro, []]));
	const placed = new Set<number>();

	// Walk right-to-left. `emit` places a game, then immediately places the games
	// feeding its two sides — depth-first, so the vertical order of a column is
	// inherited from the column to its right.
	function emit(g: BracketGame, roIndex: number) {
		if (placed.has(g.gameId)) return;
		placed.add(g.gameId);
		ordered.get(g.roundOrder)!.push(g);

		const prevRo = roundOrders[roIndex - 1];
		if (prevRo === undefined) return;
		const prevIdx = feederByRound.get(prevRo)!;
		for (const side of [g.home, g.away]) {
			if (side.teamId === null) continue;
			const feeder = prevIdx.get(side.teamId);
			if (feeder && !placed.has(feeder.gameId)) emit(feeder, roIndex - 1);
		}
	}

	const lastIndex = roundOrders.length - 1;
	for (const g of byRound.get(roundOrders[lastIndex])!) emit(g, lastIndex);

	// Anything the walk could not reach keeps its feed order at the end of its column.
	for (let i = 0; i < roundOrders.length; i++) {
		for (const g of byRound.get(roundOrders[i])!) {
			if (!placed.has(g.gameId)) {
				placed.add(g.gameId);
				ordered.get(g.roundOrder)!.push(g);
			}
		}
	}

	return roundOrders.map((ro) => ({
		round: byRound.get(ro)![0].round,
		roundOrder: ro,
		games: ordered.get(ro)!
	}));
}

/** The champion, once the last round has been decided. */
export function bracketChampion(rounds: BracketRound[]): BracketSide | null {
	const final = rounds[rounds.length - 1];
	if (!final || final.games.length !== 1) return null;
	const g = final.games[0];
	if (g.home.won) return g.home;
	if (g.away.won) return g.away;
	return null;
}

// ── Layout ──────────────────────────────────────────────────────────
//
// Geometry lives here rather than in CSS because a bracket's vertical rhythm is a
// property of the tree, not of the markup: where a game sits depends on what feeds
// it. Flexbox can only approximate that, and it gets byes visibly wrong.

/** Card width; two slots stacked make the height, so CARD_H/2 is one slot. */
export const CARD_W = 102;
export const CARD_H = 42;
export const COL_GAP = 14;
/**
 * Vertical distance between adjacent first-round games.
 *
 * A 48-team men's quadrant has 4 opening games and is comfortable at the roomy
 * pitch; a 64-team women's quadrant has 8 and would run the board about 200px
 * taller, so it tightens to the snug one. Both keep a real gap between cards
 * (CARD_H is 42), the wider bracket just breathes less.
 */
export const PITCH = 54;
export const PITCH_TIGHT = 48;
export function pitchFor(leafCount: number): number {
	return leafCount > 4 ? PITCH_TIGHT : PITCH;
}
/** Horizontal distance from one column's left edge to the next. */
export const COL_STEP = CARD_W + COL_GAP;
/** Gutter between the two mirrored halves, where the centre row sits. */
export const CENTRE_GAP = 68;

/**
 * Widest the board may be before its scroll container shows a scrollbar.
 *
 * Every step below is a real subtraction, and forgetting the border alone is
 * enough to overflow — at CENTRE_GAP 76 the board came to 976 against 974 of
 * space and produced a 2px scrollbar at full width:
 *
 *   max-w-5xl                       1024
 *   main  px-3      -24          ->  1000
 *   board container border -2    ->   998   (clientWidth)
 *   board container p-3    -24   ->   974   usable
 */
export const BOARD_MAX_W = 974;

export type PlacedGame = {
	game: BracketGame;
	/** Column index within its quadrant, 0 = earliest round. */
	col: number;
	/** Vertical centre of the card. */
	y: number;
};

/** A feeder-to-fed edge, for drawing connectors. */
export type BracketLink = {
	fromGameId: number;
	toGameId: number;
	/** Which slot of the fed game the advancing team occupies. */
	side: 'home' | 'away';
};

export type PlacedQuadrant = {
	games: PlacedGame[];
	links: BracketLink[];
	columns: number;
	width: number;
	height: number;
};

/** Index a column by the team that advanced out of each game. */
function advancerIndex(games: BracketGame[]): Map<number, BracketGame> {
	const idx = new Map<number, BracketGame>();
	for (const g of games) {
		const w = winnerTeamId(g);
		if (w !== null) idx.set(w, g);
		else {
			// Undecided: either side may turn out to be the advancer, so index both
			// and let the later round pick whichever it actually contains.
			if (g.home.teamId !== null && !idx.has(g.home.teamId)) idx.set(g.home.teamId, g);
			if (g.away.teamId !== null && !idx.has(g.away.teamId)) idx.set(g.away.teamId, g);
		}
	}
	return idx;
}

/**
 * Assign a vertical centre to every game, given columns ordered earliest-first.
 *
 * Two feeders -> the midpoint between them, the ordinary bracket rule.
 *
 * ONE feeder -> a bye, and this is the case flexbox cannot express. The single
 * feeder must line up with the *slot* it feeds, not with the centre of the card,
 * or the byed team appears level with a first-round game it never played
 * (2025 MSO: Georgetown byed, UCF came up into the away slot). A card is two
 * slots, so the fed game shifts a quarter-card away from its feeder: feeding the
 * top slot pushes it down, the bottom slot pushes it up.
 */
export function layoutColumns(columns: BracketGame[][]): {
	games: PlacedGame[];
	links: BracketLink[];
} {
	const games: PlacedGame[] = [];
	const links: BracketLink[] = [];
	const yById = new Map<number, number>();
	if (!columns.length) return { games, links };

	const pitch = pitchFor(columns[0].length);
	columns[0].forEach((g, i) => {
		const y = i * pitch + pitch / 2;
		yById.set(g.gameId, y);
		games.push({ game: g, col: 0, y });
	});

	for (let c = 1; c < columns.length; c++) {
		const idx = advancerIndex(columns[c - 1]);
		let unlinked = 0;
		for (const g of columns[c]) {
			const feeders: { feeder: BracketGame; side: 'home' | 'away' }[] = [];
			for (const side of ['home', 'away'] as const) {
				const tid = g[side].teamId;
				if (tid === null) continue;
				const f = idx.get(tid);
				if (f && !feeders.some((x) => x.feeder.gameId === f.gameId)) {
					feeders.push({ feeder: f, side });
				}
			}

			let y: number;
			if (feeders.length === 2) {
				y = (yById.get(feeders[0].feeder.gameId)! + yById.get(feeders[1].feeder.gameId)!) / 2;
			} else if (feeders.length === 1) {
				const fy = yById.get(feeders[0].feeder.gameId)!;
				y = feeders[0].side === 'home' ? fy + CARD_H / 4 : fy - CARD_H / 4;
			} else {
				// Both sides byed, or the feeding round isn't in yet.
				y = unlinked++ * pitch + pitch / 2;
			}

			yById.set(g.gameId, y);
			games.push({ game: g, col: c, y });
			for (const f of feeders) {
				links.push({ fromGameId: f.feeder.gameId, toGameId: g.gameId, side: f.side });
			}
		}
	}

	return { games, links };
}

/** Collect the subtree feeding `root`, as columns ordered earliest-first. */
function subtreeColumns(
	rounds: BracketRound[],
	rootIdx: number,
	root: BracketGame
): BracketGame[][] {
	const cols: BracketGame[][] = Array.from({ length: rootIdx + 1 }, () => []);
	cols[rootIdx].push(root);
	for (let c = rootIdx; c > 0; c--) {
		const idx = advancerIndex(rounds[c - 1].games);
		for (const g of cols[c]) {
			for (const side of ['home', 'away'] as const) {
				const tid = g[side].teamId;
				if (tid === null) continue;
				const f = idx.get(tid);
				if (f && !cols[c - 1].some((x) => x.gameId === f.gameId)) cols[c - 1].push(f);
			}
		}
	}
	return cols;
}

function placeQuadrant(columns: BracketGame[][]): PlacedQuadrant {
	const { games, links } = layoutColumns(columns);
	const height = games.reduce((m, p) => Math.max(m, p.y + CARD_H / 2), 0);
	return {
		games,
		links,
		columns: columns.length,
		width: columns.length ? columns.length * COL_STEP - COL_GAP : 0,
		height
	};
}

/**
 * One side of the board: the two quadrants that feed a single semifinal, stacked
 * as the top and bottom bands.
 *
 * Note the pairing is by COLUMN, not by band. On the NCAA's own bracket the
 * top-left and bottom-left quadrants both feed the left semifinal (2025: Furman
 * from the top, Washington from the bottom); the top band's two quadrants play in
 * different semifinals. Grouping by band instead would draw the connectors into
 * the wrong semifinal.
 */
export type BracketHalf = {
	semifinal: BracketGame | null;
	top: PlacedQuadrant;
	bottom: PlacedQuadrant;
};

export type BracketSplit =
	| { mode: 'flat'; rounds: BracketRound[] }
	| {
			mode: 'mirrored';
			/** [left, right] — the right half renders mirrored. */
			halves: BracketHalf[];
			final: BracketGame | null;
			/** Width of one half, so the board is 2*halfWidth + CENTRE_GAP. */
			halfWidth: number;
			width: number;
	  };

/**
 * Fold the bracket into the NCAA's mirrored shape: four quadrants, each rooted at
 * one quarterfinal, arranged as two bands with the semifinals and championship in
 * a row between them. A 48-team field is 16 first-round games in one stack, far
 * taller than a screen; as four 4-game quadrants it fits.
 *
 * Falls back to plain columns until the bracket is deep enough to fold — early in
 * the tournament there are no quarterfinals to root the quadrants on, and at that
 * point there are few enough games that a flat board fits anyway.
 */
export function splitBracket(rounds: BracketRound[]): BracketSplit {
	const n = rounds.length;
	const foldable =
		n >= 4 &&
		rounds[n - 1].games.length === 1 &&
		rounds[n - 2].games.length === 2 &&
		rounds[n - 3].games.length === 4;
	if (!foldable) return { mode: 'flat', rounds };

	const qfIdx = n - 3;
	const qfIndex = advancerIndex(rounds[qfIdx].games);
	const final = rounds[n - 1].games[0] ?? null;

	// Each semifinal owns one half of the board; its two feeding quarterfinals
	// become that half's top and bottom quadrants. Feeders are resolved by team,
	// not by index arithmetic, so an odd shape can't silently mispair them.
	const halves: BracketHalf[] = [];
	for (const semi of rounds[n - 2].games) {
		const feeders: BracketGame[] = [];
		for (const side of ['home', 'away'] as const) {
			const tid = semi[side].teamId;
			if (tid === null) continue;
			const f = qfIndex.get(tid);
			if (f && !feeders.some((x) => x.gameId === f.gameId)) feeders.push(f);
		}
		halves.push({
			semifinal: semi,
			top: placeQuadrant(feeders[0] ? subtreeColumns(rounds, qfIdx, feeders[0]) : []),
			bottom: placeQuadrant(feeders[1] ? subtreeColumns(rounds, qfIdx, feeders[1]) : [])
		});
	}

	const halfWidth = Math.max(0, ...halves.flatMap((h) => [h.top.width, h.bottom.width]));
	return { mode: 'mirrored', halves, final, halfWidth, width: halfWidth * 2 + CENTRE_GAP };
}

/** x offset of a card inside a quadrant, honouring the quadrant's direction. */
export function cardX(p: PlacedGame, quadrant: PlacedQuadrant, mirrored: boolean): number {
	return mirrored ? quadrant.width - CARD_W - p.col * COL_STEP : p.col * COL_STEP;
}
