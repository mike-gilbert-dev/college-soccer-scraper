// Verifies the logic behind both boxscore archive endpoints.
// Usage: node scripts/smoke-test-boxscore-endpoints.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
	readFileSync(resolve(__dirname, '..', '.env'), 'utf8')
		.split('\n')
		.filter((l) => l.includes('='))
		.map((l) => l.split('=').map((s) => s.trim()))
);

const supabase = createClient(env['PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
const BUCKET = 'ncaa-raw-games';
const BOX_SCORE_HASH = 'c9070c4e5a76468a4025896df89f8a7b22be8275c54a22ff79619cbb27d63d7d';

// ── Helpers ───────────────────────────────────────────────────────────────────

function archivePath(sportCode, division, seasonYear, contestDate) {
	const [, mm, dd] = contestDate.split('-');
	return `${sportCode}/${division}/${seasonYear}/${mm}-${dd}.json`;
}

function boxScorePath(sportCode, division, seasonYear, contestId) {
	return `${sportCode}/${division}/${seasonYear}/boxscores/${contestId}.json`;
}

async function readGameContestIds(sportCode, division, seasonYear, contestDate) {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (error.message.includes('Not Found') || error.message.includes('404') || error.message.includes('Object not found')) return [];
		throw new Error(`Download failed: ${error.message}`);
	}
	const text = await data.text();
	const json = JSON.parse(text);
	return (json?.data?.contests ?? []).map((c) => String(c.contestId));
}

async function fetchRawBoxScore(contestId) {
	const url = new URL('https://sdataprod.ncaa.com');
	url.searchParams.set('meta', 'NCAA_GetGamecenterBoxscoreSoccerById_web');
	url.searchParams.set('extensions', JSON.stringify({ persistedQuery: { version: 1, sha256Hash: BOX_SCORE_HASH } }));
	url.searchParams.set('variables', JSON.stringify({ contestId: String(contestId), staticTestEnv: null }));
	const res = await fetch(url.toString(), { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
	if (!res.ok) throw new Error(`NCAA box score API ${res.status}`);
	return res.json();
}

async function saveBoxScoreJson(sportCode, division, seasonYear, contestId, data) {
	const path = boxScorePath(sportCode, division, seasonYear, contestId);
	const { error } = await supabase.storage.from(BUCKET).upload(
		path, JSON.stringify(data, null, 2), { contentType: 'application/json', upsert: true }
	);
	if (error) throw new Error(`Upload failed: ${error.message}`);
	return { path };
}

async function listArchivedBoxScoreIds(sportCode, division, seasonYear) {
	const prefix = `${sportCode}/${division}/${seasonYear}/boxscores`;
	const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 2000 });
	if (error) throw new Error(`List failed: ${error.message}`);
	return (data ?? []).filter((f) => f.name.endsWith('.json')).map((f) => f.name.replace('.json', '')).sort();
}

// ── Test 1: season lookup ─────────────────────────────────────────────────────
const { data: season } = await supabase.from('seasons').select('year, start_date, end_date').eq('label', '2025-2026').single();
if (!season) throw new Error('Season "2025-2026" not found');
console.log(`Season: year=${season.year}, start=${season.start_date}, end=${season.end_date}`);

// ── Test 2: POST logic — read game file, fetch box score, save ────────────────
const contestDate = '2025-12-15';
const contestIds = await readGameContestIds('MSO', 1, season.year, contestDate);
console.log(`readGameContestIds(${contestDate}): ${contestIds.length} contests`);
if (contestIds.length === 0) throw new Error('Expected >0 contests for 2025-12-15');

// Fetch and save one box score (delayMs=0 for speed)
const contestId = contestIds[0];
const raw = await fetchRawBoxScore(contestId);
console.log(`fetchRawBoxScore(${contestId}): ok, has boxscore=${!!(raw?.data?.boxscore)}`);
const { path } = await saveBoxScoreJson('MSO', 1, season.year, contestId, raw);
console.log(`saveBoxScoreJson: ${path}`);

// ── Test 3: overwrite silently ────────────────────────────────────────────────
const { path: path2 } = await saveBoxScoreJson('MSO', 1, season.year, contestId, raw);
console.log(`Overwrite OK: ${path2}`);

// ── Test 4: POST logic — no game file → contestsFound: 0 ─────────────────────
const emptyIds = await readGameContestIds('MSO', 1, season.year, '2025-01-01');
if (emptyIds.length !== 0) throw new Error('Expected 0 contests for off-season date');
console.log(`readGameContestIds('2025-01-01'): 0 (correct, no game file)`);

// ── Test 5: GET logic — list archived box scores ──────────────────────────────
const archivedIds = await listArchivedBoxScoreIds('MSO', 1, season.year);
console.log(`listArchivedBoxScoreIds: ${archivedIds.length} archived`);
if (!archivedIds.includes(String(contestId))) throw new Error(`Expected ${contestId} in list`);

// ── Clean up ──────────────────────────────────────────────────────────────────
await supabase.storage.from(BUCKET).remove([path]);
console.log('Test file cleaned up.');
console.log('\nAll endpoint logic verified ✓');
