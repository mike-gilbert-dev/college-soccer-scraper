// Smoke test for Phase 1 ingest read helpers.
// Usage: node scripts/smoke-test-ingest-helpers.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
	readFileSync(resolve(__dirname, '..', '.env'), 'utf8')
		.split('\n')
		.filter((l) => l.includes('='))
		.map((l) => {
			const idx = l.indexOf('=');
			return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
		})
);

const supabase = createClient(env['PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
const BUCKET = 'ncaa-raw-games';

// ── Replicate readGameContests ────────────────────────────────────────────────
function archivePath(sportCode, division, seasonYear, contestDate) {
	const [, mm, dd] = contestDate.split('-');
	return `${sportCode}/${division}/${seasonYear}/${mm}-${dd}.json`;
}

async function readGameContests(sportCode, division, seasonYear, contestDate) {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (
			error.message.includes('Not Found') ||
			error.message.includes('404') ||
			error.message.includes('Object not found')
		) return [];
		throw new Error(`Download failed: ${error.message}`);
	}
	const text = await data.text();
	const json = JSON.parse(text);
	return json?.data?.contests ?? [];
}

// ── Replicate readStoredBoxScore ──────────────────────────────────────────────
function boxScorePath(sportCode, division, seasonYear, contestId) {
	return `${sportCode}/${division}/${seasonYear}/boxscores/${contestId}.json`;
}

async function readStoredBoxScore(sportCode, division, seasonYear, contestId) {
	const path = boxScorePath(sportCode, division, seasonYear, contestId);
	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (
			error.message.includes('Not Found') ||
			error.message.includes('404') ||
			error.message.includes('Object not found')
		) return { fileFound: false };
		throw new Error(`Download failed: ${error.message}`);
	}
	const text = await data.text();
	const json = JSON.parse(text);
	return { fileFound: true, boxScore: json?.data?.boxscore ?? null };
}

// ── Season lookup ─────────────────────────────────────────────────────────────
const { data: season } = await supabase
	.from('seasons')
	.select('year, start_date, end_date')
	.eq('label', '2025-2026')
	.single();
if (!season) throw new Error('Season "2025-2026" not found');
console.log(`Season: year=${season.year}`);

// ── Test 1: readGameContests — date with an archived game file ────────────────
const contests = await readGameContests('MSO', 1, season.year, '2025-12-15');
console.log(`readGameContests('2025-12-15'): ${contests.length} contests`);
if (contests.length === 0) throw new Error('Expected >0 contests for 2025-12-15');

const sample = contests[0];
const hasRequired = sample.contestId && Array.isArray(sample.teams) && sample.statusCodeDisplay;
if (!hasRequired) throw new Error(`Contest missing expected fields: ${JSON.stringify(Object.keys(sample))}`);
console.log(`  Sample: contestId=${sample.contestId}, status=${sample.statusCodeDisplay}, teams=${sample.teams.length}`);

// ── Test 2: readGameContests — off-season date returns [] ─────────────────────
const empty = await readGameContests('MSO', 1, season.year, '2025-01-01');
if (empty.length !== 0) throw new Error('Expected [] for off-season date');
console.log(`readGameContests('2025-01-01'): [] (correct, no file)`);

// ── Test 3: readStoredBoxScore — existing box score file ──────────────────────
const contestId = String(sample.contestId);
const bsResult = await readStoredBoxScore('MSO', 1, season.year, contestId);
console.log(`readStoredBoxScore(${contestId}): fileFound=${bsResult.fileFound}`);
if (bsResult.fileFound) {
	console.log(`  boxScore=${bsResult.boxScore !== null ? 'present' : 'null (scheduled game)'}`);
} else {
	console.log('  No box score file yet — run box score archiver first to test the fileFound:true path');
}

// ── Test 4: readStoredBoxScore — nonexistent contestId returns fileFound:false ─
const missing = await readStoredBoxScore('MSO', 1, season.year, '0');
if (missing.fileFound !== false) throw new Error('Expected { fileFound: false } for nonexistent contestId');
console.log(`readStoredBoxScore('0'): { fileFound: false } (correct)`);

console.log('\nAll Phase 1 helper logic verified ✓');
