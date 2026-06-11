// Smoke test for box score Storage helpers.
// Usage: node scripts/smoke-test-boxscore-helpers.mjs
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

// ── Replicate helper logic ────────────────────────────────────────────────────

function archivePath(sportCode, division, seasonYear, contestDate) {
	const [, mm, dd] = contestDate.split('-');
	return `${sportCode}/${division}/${seasonYear}/${mm}-${dd}.json`;
}

function boxScorePath(sportCode, division, seasonYear, contestId) {
	return `${sportCode}/${division}/${seasonYear}/boxscores/${contestId}.json`;
}

async function saveBoxScoreJson(sportCode, division, seasonYear, contestId, data) {
	const path = boxScorePath(sportCode, division, seasonYear, contestId);
	const { error } = await supabase.storage
		.from(BUCKET)
		.upload(path, JSON.stringify(data, null, 2), { contentType: 'application/json', upsert: true });
	if (error) throw new Error(`Upload failed: ${error.message}`);
	return { path };
}

async function listArchivedBoxScoreIds(sportCode, division, seasonYear) {
	const prefix = `${sportCode}/${division}/${seasonYear}/boxscores`;
	const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 2000 });
	if (error) throw new Error(`List failed: ${error.message}`);
	return (data ?? [])
		.filter((f) => f.name.endsWith('.json'))
		.map((f) => f.name.replace('.json', ''))
		.sort();
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

// ── Test 1: boxScorePath ──────────────────────────────────────────────────────
const expectedPath = 'MSO/1/2025/boxscores/6500844.json';
const actualPath = boxScorePath('MSO', 1, 2025, 6500844);
if (actualPath !== expectedPath) throw new Error(`boxScorePath wrong: ${actualPath}`);
console.log(`✓ boxScorePath: ${actualPath}`);

// ── Test 2: readGameContestIds — real game file ───────────────────────────────
const contestIds = await readGameContestIds('MSO', 1, 2025, '2025-12-15');
console.log(`✓ readGameContestIds('2025-12-15'): ${contestIds.length} contests — ${contestIds.slice(0, 3).join(', ')}...`);
if (!contestIds.includes('6500844')) throw new Error(`Expected contestId 6500844 in results`);

// ── Test 3: readGameContestIds — non-existent date returns [] ─────────────────
const emptyIds = await readGameContestIds('MSO', 1, 2025, '2025-01-01');
if (emptyIds.length !== 0) throw new Error(`Expected empty array for off-season date, got ${emptyIds.length}`);
console.log(`✓ readGameContestIds('2025-01-01'): returns [] (no game file)`);

// ── Test 4: saveBoxScoreJson — upload test file ───────────────────────────────
const testContestId = '6500844';
const { path } = await saveBoxScoreJson('MSO', 1, 2025, testContestId, { test: true, ts: Date.now() });
console.log(`✓ saveBoxScoreJson: uploaded to ${path}`);

// ── Test 5: saveBoxScoreJson — overwrite (no error) ───────────────────────────
const { path: path2 } = await saveBoxScoreJson('MSO', 1, 2025, testContestId, { test: true, overwrite: true });
console.log(`✓ saveBoxScoreJson overwrite OK: ${path2}`);

// ── Test 6: listArchivedBoxScoreIds ──────────────────────────────────────────
const ids = await listArchivedBoxScoreIds('MSO', 1, 2025);
console.log(`✓ listArchivedBoxScoreIds: ${ids.length} archived — ${ids.join(', ')}`);
if (!ids.includes(testContestId)) throw new Error(`Expected ${testContestId} in list`);

// ── Clean up ──────────────────────────────────────────────────────────────────
await supabase.storage.from(BUCKET).remove([path]);
console.log(`✓ Test file cleaned up`);

console.log('\nAll box score helper smoke tests passed ✓');
