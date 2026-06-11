import { supabaseAdmin } from '$lib/server/supabase-admin';
import type { NcaaContest, NcaaBoxScore } from '$lib/server/ncaa-api';

const BUCKET = 'ncaa-raw-games';

/** Pure: 'MSO/1/2025/12-15.json' */
export function archivePath(
	sportCode: string,
	division: number,
	seasonYear: number,
	contestDate: string // YYYY-MM-DD
): string {
	const [, mm, dd] = contestDate.split('-');
	return `${sportCode}/${division}/${seasonYear}/${mm}-${dd}.json`;
}

/** Upload raw JSON to Storage, overwriting any existing file. */
export async function saveContestJson(
	sportCode: string,
	division: number,
	seasonYear: number,
	contestDate: string, // YYYY-MM-DD
	data: unknown
): Promise<{ path: string }> {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const body = JSON.stringify(data, null, 2);
	const { error } = await supabaseAdmin.storage
		.from(BUCKET)
		.upload(path, body, { contentType: 'application/json', upsert: true });
	if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
	return { path };
}

/** List all archived dates for a sport/division/season as YYYY-MM-DD strings. */
export async function listArchivedDates(
	sportCode: string,
	division: number,
	seasonYear: number
): Promise<string[]> {
	const prefix = `${sportCode}/${division}/${seasonYear}`;
	const { data, error } = await supabaseAdmin.storage
		.from(BUCKET)
		.list(prefix, { limit: 400 });
	if (error) throw new Error(`Storage list failed for ${prefix}: ${error.message}`);
	return (data ?? [])
		.filter((f) => f.name.endsWith('.json'))
		.map((f) => {
			const [mm, dd] = f.name.replace('.json', '').split('-');
			return `${seasonYear}-${mm}-${dd}`;
		})
		.sort();
}

// ── Box Score helpers ────────────────────────────────────────────────────────

/** Pure: 'MSO/1/2025/boxscores/6500844.json' */
export function boxScorePath(
	sportCode: string,
	division: number,
	seasonYear: number,
	contestId: string | number
): string {
	return `${sportCode}/${division}/${seasonYear}/boxscores/${contestId}.json`;
}

/** Upload raw box score JSON to Storage, overwriting any existing file. */
export async function saveBoxScoreJson(
	sportCode: string,
	division: number,
	seasonYear: number,
	contestId: string | number,
	data: unknown
): Promise<{ path: string }> {
	const path = boxScorePath(sportCode, division, seasonYear, contestId);
	const body = JSON.stringify(data, null, 2);
	const { error } = await supabaseAdmin.storage
		.from(BUCKET)
		.upload(path, body, { contentType: 'application/json', upsert: true });
	if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
	return { path };
}

/** List contest IDs of all archived box score files for a sport/division/season. */
export async function listArchivedBoxScoreIds(
	sportCode: string,
	division: number,
	seasonYear: number
): Promise<string[]> {
	const prefix = `${sportCode}/${division}/${seasonYear}/boxscores`;
	const { data, error } = await supabaseAdmin.storage
		.from(BUCKET)
		.list(prefix, { limit: 2000 });
	if (error) throw new Error(`Storage list failed for ${prefix}: ${error.message}`);
	return (data ?? [])
		.filter((f) => f.name.endsWith('.json'))
		.map((f) => f.name.replace('.json', ''))
		.sort();
}

/** Download a game JSON file from Storage and return the contestIds it contains. Returns [] if the file does not exist. */
export async function readGameContestIds(
	sportCode: string,
	division: number,
	seasonYear: number,
	contestDate: string // YYYY-MM-DD
): Promise<string[]> {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
	if (error) {
		if (error.message.includes('Not Found') || error.message.includes('404') || error.message.includes('Object not found')) return [];
		throw new Error(`Storage download failed for ${path}: ${error.message}`);
	}
	const text = await (data as Blob).text();
	const json = JSON.parse(text) as { data?: { contests?: { contestId: number | string }[] } };
	return (json?.data?.contests ?? []).map((c) => String(c.contestId));
}

// ── Ingest read helpers ──────────────────────────────────────────────────────

/** Download a game JSON file and return the full NcaaContest array. Returns [] if the file does not exist. */
export async function readGameContests(
	sportCode: string,
	division: number,
	seasonYear: number,
	contestDate: string // YYYY-MM-DD
): Promise<NcaaContest[]> {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
	if (error) {
		if (
			error.message.includes('Not Found') ||
			error.message.includes('404') ||
			error.message.includes('Object not found')
		) return [];
		throw new Error(`Storage download failed for ${path}: ${error.message}`);
	}
	const text = await (data as Blob).text();
	const json = JSON.parse(text) as { data?: { contests?: NcaaContest[] } };
	return json?.data?.contests ?? [];
}

export type StoredBoxScoreResult =
	| { fileFound: false }
	| { fileFound: true; boxScore: NcaaBoxScore | null };

/** Download a box score JSON file from Storage.
 *  Returns { fileFound: false } if no file exists (skip player stats).
 *  Returns { fileFound: true, boxScore: null } if file exists but data.boxscore is absent (delete stale stats).
 *  Returns { fileFound: true, boxScore: NcaaBoxScore } when full data is present. */
export async function readStoredBoxScore(
	sportCode: string,
	division: number,
	seasonYear: number,
	contestId: string | number
): Promise<StoredBoxScoreResult> {
	const path = boxScorePath(sportCode, division, seasonYear, contestId);
	const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
	if (error) {
		if (
			error.message.includes('Not Found') ||
			error.message.includes('404') ||
			error.message.includes('Object not found')
		) return { fileFound: false };
		throw new Error(`Storage download failed for ${path}: ${error.message}`);
	}
	const text = await (data as Blob).text();
	const json = JSON.parse(text) as { data?: { boxscore?: NcaaBoxScore | null } };
	return { fileFound: true, boxScore: json?.data?.boxscore ?? null };
}
