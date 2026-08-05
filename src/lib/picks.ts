// Pick'em outcome + lock logic.
//
// This module mirrors SQL that is authoritative:
//   - actualOutcome() mirrors the CASE expression in grade_picks()
//   - isGameOpen()    mirrors public.game_is_open()
//
// The TS exists for instant UI feedback (rendering pick controls, and showing a
// win/loss the moment a live game goes final) — the database always has the
// final say. If you change a rule here, change it there too.
//
// Keep this module dependency-free so it stays trivial to unit test.

export type PickOutcome = 'home' | 'draw' | 'away';
export type PickResult = 'win' | 'loss' | 'void';

export interface GameOutcomeInput {
	status: string;
	home_score: number | null;
	away_score: number | null;
}

export interface GameLockInput {
	status: string;
	start_time: string | null;
	contest_date: string;
}

/**
 * Which outcome actually occurred, or null if the game has no usable result yet.
 *
 * A penalty-shootout game is a DRAW: the score stays tied and the site already
 * treats PK games as ties in W-L-T records, Elo and RPI. `shootout_winner` is
 * deliberately not consulted.
 */
export function actualOutcome(game: GameOutcomeInput): PickOutcome | null {
	if (game.status !== 'final') return null;
	if (game.home_score === null || game.away_score === null) return null;

	if (game.home_score > game.away_score) return 'home';
	if (game.away_score > game.home_score) return 'away';
	return 'draw';
}

/**
 * Grade a single pick against a game.
 *
 * Returns null when the game isn't gradeable yet — postponed games stay
 * ungraded on purpose, because the row keeps its id and grades once played.
 */
export function gradePick(outcome: PickOutcome, game: GameOutcomeInput): PickResult | null {
	if (game.status === 'cancelled') return 'void';

	const actual = actualOutcome(game);
	if (actual === null) return null;

	return actual === outcome ? 'win' : 'loss';
}

/**
 * Whether a game can still be picked.
 *
 * Falls back to midnight ET on game day when start_time is missing — erring
 * toward locking early. No D1 2025 game needed the fallback.
 */
export function isGameOpen(game: GameLockInput, now: Date = new Date()): boolean {
	if (game.status !== 'scheduled') return false;

	const kickoff = game.start_time
		? new Date(game.start_time)
		: midnightEastern(game.contest_date);

	if (Number.isNaN(kickoff.getTime())) return false;

	return kickoff.getTime() > now.getTime();
}

/**
 * Midnight America/New_York on a YYYY-MM-DD date, as a UTC instant.
 *
 * US Eastern is UTC-5, or UTC-4 while daylight saving is in effect. The college
 * soccer season (August–December) spans the November DST transition, so the
 * offset is resolved from the date rather than hardcoded.
 */
function midnightEastern(contestDate: string): Date {
	const utcMidnight = Date.parse(`${contestDate}T00:00:00.000Z`);
	if (Number.isNaN(utcMidnight)) return new Date(NaN);

	const offsetHours = isEasternDaylightTime(contestDate) ? 4 : 5;
	return new Date(utcMidnight + offsetHours * 3_600_000);
}

/**
 * US DST runs from the second Sunday in March to the first Sunday in November.
 */
function isEasternDaylightTime(contestDate: string): boolean {
	const [year, month, day] = contestDate.split('-').map(Number);
	if (!year || !month || !day) return false;

	if (month < 3 || month > 11) return false;
	if (month > 3 && month < 11) return true;

	if (month === 3) return day >= secondSunday(year, 3);
	return day < firstSunday(year, 11);
}

/** Day-of-month of the first Sunday in the given month. */
function firstSunday(year: number, month: number): number {
	const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
	return firstWeekday === 0 ? 1 : 8 - firstWeekday;
}

/** Day-of-month of the second Sunday in the given month. */
function secondSunday(year: number, month: number): number {
	return firstSunday(year, month) + 7;
}
