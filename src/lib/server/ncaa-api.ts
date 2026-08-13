const GQL_HOST = 'https://sdataprod.ncaa.com';
const CONTESTS_HASH = '4bcb5e6432fa9da365c0c19af01b1f9015cc7eb5c21e7af2dba308784a166df7';

// ----------------------------------------------------------------
// Types matching the actual GetContests_web response shape
// ----------------------------------------------------------------
export interface NcaaContestTeam {
	isHome: boolean;
	seoname: string;        // used as ncaa_team_id (e.g. "michigan-st")
	nameShort: string;      // e.g. "Michigan St."
	name6Char: string;      // e.g. "MICHST"
	score: number;
	isWinner: boolean;
	conferenceSeo: string;  // e.g. "acc", "big-ten"
	teamRank: number | null;
	seed: number | null;
}

export interface NcaaContest {
	contestId: number;
	startDate: string;          // "MM/DD/YYYY"
	startTime: string;          // "17:00"
	startTimeEpoch: number;     // Unix timestamp (seconds)
	gameState: string;          // "F", "L", etc.
	statusCodeDisplay: string;  // "final" | "live" | "scheduled"
	currentPeriod: string;      // "FINAL", "FINAL/PK", "1ST HALF", etc.
	finalMessage?: string | null;      // "FINAL", "FINAL/PK" — shootout marker
	isChampionship?: boolean;          // true for postseason/championship-bracket games
	broadcasterName?: string | null;   // e.g. "ESPNU"
	roundDescription?: string | null;  // e.g. "Semifinals"
	teams: NcaaContestTeam[];
}

/**
 * A penalty-kick shootout: tied regulation/OT score but the feed flags one team as
 * the winner (advanced). We only trust that in a postseason context — the feed
 * occasionally sets a spurious isWinner on regular-season draws — so we require
 * either a FINAL/PK marker or a championship-bracket game. Returns the advancing
 * side ('home' | 'away') or null when it isn't a shootout.
 */
export function shootoutWinnerSide(contest: NcaaContest): 'home' | 'away' | null {
	const home = contest.teams.find((t) => t.isHome);
	const away = contest.teams.find((t) => !t.isHome);
	if (!home || !away) return null;
	if (home.score !== away.score || home.isWinner === away.isWinner) return null;
	const pkMarked =
		/PK/i.test(contest.currentPeriod ?? '') || /PK/i.test(contest.finalMessage ?? '');
	if (!pkMarked && contest.isChampionship !== true) return null;
	return home.isWinner ? 'home' : 'away';
}

export interface FetchContestsParams {
	contestDate: string;      // MM/DD/YYYY
	seasonYear: number;
	division?: number;        // defaults to 1
	sportCode?: string;       // defaults to 'MSO' (Men's Soccer); use 'WSO' for women's
}

function buildUrl(params: FetchContestsParams): string {
	const { contestDate, seasonYear, division = 1, sportCode = 'MSO' } = params;
	const url = new URL(GQL_HOST);
	url.searchParams.set('meta', 'GetContests_web');
	url.searchParams.set('extensions', JSON.stringify({
		persistedQuery: { version: 1, sha256Hash: CONTESTS_HASH }
	}));
	url.searchParams.set('queryName', 'GetContests_web');
	url.searchParams.set('variables', JSON.stringify({
		sportCode,
		division,
		seasonYear,
		contestDate,
		week: null
	}));
	return url.toString();
}

const NCAA_HEADERS = {
	'Accept': 'application/json',
	'User-Agent': 'Mozilla/5.0 (compatible; college-soccer-scraper/1.0)'
};

const MAX_RETRIES = 3;

/** Parse `Retry-After` (seconds or HTTP-date) into a delay in ms, or null if absent/unparseable. */
function retryAfterMs(res: Response): number | null {
	const header = res.headers.get('Retry-After');
	if (!header) return null;
	const seconds = Number(header);
	if (!Number.isNaN(seconds)) return seconds * 1000;
	const date = Date.parse(header);
	return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * NCAA publishes no rate limit or robots.txt for this API, so a 429 (or a
 * transient 5xx) is the only real signal we have. Honor `Retry-After` when the
 * response includes one; otherwise back off exponentially (1s, 2s, 4s) with jitter.
 */
async function fetchWithRetry(url: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: NCAA_HEADERS });
		const retryable = res.status === 429 || [502, 503, 504].includes(res.status);
		if (!retryable || attempt >= MAX_RETRIES) return res;
		const delay = retryAfterMs(res) ?? 2 ** attempt * 1000 + Math.random() * 250;
		await sleep(delay);
	}
}

/** Returns the raw NCAA API response — use via GET /api/scrape/test to inspect field names. */
export async function fetchRawContests(params: FetchContestsParams): Promise<unknown> {
	const res = await fetchWithRetry(buildUrl(params));
	if (!res.ok) throw new Error(`NCAA API responded ${res.status}`);
	return res.json();
}

export async function fetchContests(params: FetchContestsParams): Promise<NcaaContest[]> {
	const raw = await fetchRawContests(params) as { data?: { contests?: NcaaContest[] } };
	return raw?.data?.contests ?? [];
}

/** Map statusCodeDisplay directly to our DB enum value. */
export function normalizeStatus(statusCodeDisplay: string): string {
	switch (statusCodeDisplay?.toLowerCase()) {
		case 'final':      return 'final';
		case 'live':       return 'live';
		case 'postponed':  return 'postponed';
		case 'cancelled':  return 'cancelled';
		default:           return 'scheduled';
	}
}

/** Format a JS Date as MM/DD/YYYY for the NCAA API. */
export function formatNcaaDate(date: Date): string {
	const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(date.getUTCDate()).padStart(2, '0');
	const yyyy = date.getUTCFullYear();
	return `${mm}/${dd}/${yyyy}`;
}

/** Iterate every date from startDate to endDate inclusive. */
export function* dateRange(startDate: string, endDate: string): Generator<Date> {
	const current = new Date(startDate + 'T00:00:00Z');
	const end     = new Date(endDate   + 'T00:00:00Z');
	while (current <= end) {
		yield new Date(current);
		current.setUTCDate(current.getUTCDate() + 1);
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise(r => setTimeout(r, ms));
}

// ----------------------------------------------------------------
// Box score types — derived from NCAA_GetGamecenterBoxscoreSoccerById_web
// Data path: raw.data.boxscore
// Note: all numeric stat fields are returned as strings by the API.
// Note: there is no stable playerId in the API — we generate a
//       synthetic ncaa_player_id as "{teamId}_{firstName}_{lastName}"
//       (lowercased, spaces replaced with underscores).
// Note: GK saves/goals are team-level only (teamStats.goalie); the
//       per-player saves field is always "0".
// ----------------------------------------------------------------
const BOX_SCORE_HASH = 'c9070c4e5a76468a4025896df89f8a7b22be8275c54a22ff79619cbb27d63d7d';

export interface NcaaBoxScorePenalties {
	fouls: string;
	greenCards: string;
	yellowCards: string;
	redCards: string;
	count: string;
}

export interface NcaaBoxScoreGoalie {
	minutesPlayed: string;
	gamesPlayed: boolean;
	gamesStarted: boolean;
	goalsAllowed: string;
	saves: string;
	shutouts: string;
	wins: string;
	losses: string;
	ties: string;
}

export interface NcaaBoxScoreTeamStats {
	goals: string;
	assists: string;
	shots: string;
	shotsOnGoal: string;
	saves: string;
	fouls: string;
	corners: string;
	offsides: string;
	goalie: NcaaBoxScoreGoalie;
	penalties: NcaaBoxScorePenalties;
}

export interface NcaaBoxScorePlayerStats {
	firstName: string;
	lastName: string;
	position: string;           // 'GK', 'D', 'M', 'F'
	number: number;             // jersey number (integer)
	goals: string;
	assists: string;
	shots: string;
	shotsOnGoal: string;
	minutesPlayed: string;
	penaltyShotGoals: string;
	penaltyShotAttempts: string;
	starter: boolean;
	participated: boolean;
	penalties: NcaaBoxScorePenalties;
}

export interface NcaaBoxScoreTeamDetail {
	teamId: number;
	playerStats: NcaaBoxScorePlayerStats[];
	teamStats: NcaaBoxScoreTeamStats;
}

export interface NcaaBoxScoreTeamIdentity {
	isHome: boolean;
	teamId: string;             // string here; NcaaBoxScoreTeamDetail.teamId is number
	seoname: string;
	name6Char: string;
	nameFull: string;
	nameShort: string;
	teamName: string;
	color: string;
}

export interface NcaaBoxScore {
	contestId: number;
	description: string;
	status: string;
	period: string;
	sportCode: string;
	division: number;
	teams: NcaaBoxScoreTeamIdentity[];
	teamBoxscore: NcaaBoxScoreTeamDetail[];
}

/** Generate a synthetic player ID since the box score API provides no stable player ID. */
export function syntheticPlayerId(teamId: number | string, firstName: string, lastName: string): string {
	const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
	return `${teamId}_${norm(firstName)}_${norm(lastName)}`;
}

const POSITION_MAP: Record<string, string> = {
	GOALKEEPER: 'GK',
	FORWARD: 'FWD',
	MIDFIELDER: 'MID',
	DEFENDER: 'DEF'
};

/**
 * NCAA's box score feed usually reports position as a short code (GK/FWD/MID/DEF)
 * but occasionally spells it out (GOALKEEPER/FORWARD/...) for the same game type —
 * seen on both live and already-final games, not tied to any one source. Map the
 * full word to the short code so GK detection (`position === 'GK'`) and display
 * both see one consistent value; anything else (already-short, blank, unrecognized)
 * passes through unchanged.
 */
export function normalizePosition(position: string | null | undefined): string | null {
	if (!position) return position ?? null;
	return POSITION_MAP[position.toUpperCase()] ?? position;
}

export async function fetchRawBoxScore(contestId: string): Promise<unknown> {
	const url = new URL(GQL_HOST);
	url.searchParams.set('meta', 'NCAA_GetGamecenterBoxscoreSoccerById_web');
	url.searchParams.set('extensions', JSON.stringify({
		persistedQuery: { version: 1, sha256Hash: BOX_SCORE_HASH }
	}));
	url.searchParams.set('variables', JSON.stringify({ contestId, staticTestEnv: null }));

	const res = await fetchWithRetry(url.toString());
	if (!res.ok) throw new Error(`NCAA box score API ${res.status} for contestId=${contestId}`);
	return res.json();
}

export async function fetchBoxScore(contestId: string): Promise<NcaaBoxScore> {
	const raw = await fetchRawBoxScore(contestId) as { data?: { boxscore?: NcaaBoxScore } };
	const boxScore = raw?.data?.boxscore;
	if (!boxScore) throw new Error(`No box score data for contestId=${contestId}`);
	return boxScore;
}
