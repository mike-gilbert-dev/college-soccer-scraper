// Raw roster archive helpers — the Storage source-of-truth layer for the roster
// pipeline. Mirrors src/lib/server/ncaa-archive.ts: scrape writes raw JSON here,
// and the ingest step (Phase 3) reads it back without re-fetching the source.

import { supabaseAdmin } from '$lib/server/supabase-admin';
import type { SidearmRosterResponse } from '$lib/server/sidearm';

const BUCKET = 'sidearm-raw-rosters';

/** Pure: 'MSO/2025/45.json' (sport / season year / team id). */
export function rosterPath(sportCode: string, seasonYear: number, teamId: number | string): string {
	return `${sportCode}/${seasonYear}/${teamId}.json`;
}

/** Upload raw roster JSON to Storage, overwriting any existing file. */
export async function saveRosterJson(
	sportCode: string,
	seasonYear: number,
	teamId: number | string,
	data: unknown
): Promise<{ path: string }> {
	const path = rosterPath(sportCode, seasonYear, teamId);
	const body = JSON.stringify(data, null, 2);
	const { error } = await supabaseAdmin.storage
		.from(BUCKET)
		.upload(path, body, { contentType: 'application/json', upsert: true });
	if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
	return { path };
}

/** Download + parse an archived roster. Returns null if the file does not exist. */
export async function readStoredRoster(
	sportCode: string,
	seasonYear: number,
	teamId: number | string
): Promise<SidearmRosterResponse | null> {
	const path = rosterPath(sportCode, seasonYear, teamId);
	const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
	if (error) {
		if (
			error.message.includes('Not Found') ||
			error.message.includes('404') ||
			error.message.includes('Object not found')
		)
			return null;
		throw new Error(`Storage download failed for ${path}: ${error.message}`);
	}
	const text = await (data as Blob).text();
	return JSON.parse(text) as SidearmRosterResponse;
}

const HEADSHOT_BUCKET = 'player-headshots';

/** Pure: 'MSO/2025/1/45/12345.jpg' (sport / season year / division / team / player). */
export function headshotPath(
	sportCode: string,
	seasonYear: number,
	division: number,
	teamId: number | string,
	playerId: number | string,
	ext: string
): string {
	return `${sportCode}/${seasonYear}/${division}/${teamId}/${playerId}.${ext}`;
}

/** Map an image content-type to a file extension, or null if not a known image. */
export function extForContentType(contentType: string | null): string | null {
	const ct = (contentType ?? '').split(';')[0].trim().toLowerCase();
	switch (ct) {
		case 'image/jpeg':
		case 'image/jpg':
			return 'jpg';
		case 'image/png':
			return 'png';
		case 'image/webp':
			return 'webp';
		case 'image/gif':
			return 'gif';
		case 'image/avif':
			return 'avif';
		default:
			return null;
	}
}

/** Build the public URL for a stored headshot object key. */
export function publicHeadshotUrl(baseUrl: string, objectKey: string): string {
	return `${baseUrl.replace(/\/$/, '')}/storage/v1/object/public/${HEADSHOT_BUCKET}/${objectKey}`;
}

/** List archived team ids for a sport/season as strings. */
export async function listArchivedRosters(sportCode: string, seasonYear: number): Promise<string[]> {
	const prefix = `${sportCode}/${seasonYear}`;
	const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
	if (error) throw new Error(`Storage list failed for ${prefix}: ${error.message}`);
	return (data ?? [])
		.filter((f) => f.name.endsWith('.json'))
		.map((f) => f.name.replace('.json', ''))
		.sort();
}
