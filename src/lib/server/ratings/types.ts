// Shared types for the ratings engine. Pure data — no DB or framework imports.

export type RatingSystem = 'elo' | 'rpi' | 'power';

/** A single played game, projected to just the fields the rating math needs. */
export interface GameInput {
	id: number;
	contestDate: string; // 'YYYY-MM-DD'
	startTime: string | null; // ISO timestamp; tiebreaker for same-day ordering
	homeTeamSeasonId: number;
	awayTeamSeasonId: number;
	homeScore: number;
	awayScore: number;
	neutralSite: boolean;
}

/** One rating snapshot, ready to be written to the team_ratings table. */
export interface RatingRow {
	teamSeasonId: number;
	system: RatingSystem;
	asOf: string; // 'YYYY-MM-DD'
	value: number;
	gamesPlayed: number;
	meta?: Record<string, unknown> | null;
}

/** team_season_id -> starting rating for the season. */
export type SeedMap = Map<number, number>;
