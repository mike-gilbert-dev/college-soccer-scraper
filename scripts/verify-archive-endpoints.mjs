// Verifies the logic behind both archive endpoints end-to-end.
// Usage: node scripts/verify-archive-endpoints.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
	readFileSync(resolve(__dirname, '..', '.env'), 'utf8')
		.split('\n').filter(l => l.includes('=')).map(l => l.split('=').map(s => s.trim()))
);

const supabase = createClient(env['PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
const BUCKET = 'ncaa-raw-games';

// ── Replicate endpoint logic ──────────────────────────────────────────────────

function archivePath(sportCode, division, seasonYear, contestDate) {
	const [, mm, dd] = contestDate.split('-');
	return `${sportCode}/${division}/${seasonYear}/${mm}-${dd}.json`;
}

async function saveContestJson(sportCode, division, seasonYear, contestDate, data) {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const { error } = await supabase.storage.from(BUCKET)
		.upload(path, JSON.stringify(data, null, 2), { contentType: 'application/json', upsert: true });
	if (error) throw new Error(`Upload failed: ${error.message}`);
	return { path };
}

async function listArchivedDates(sportCode, division, seasonYear) {
	const prefix = `${sportCode}/${division}/${seasonYear}`;
	const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 400 });
	if (error) throw new Error(`List failed: ${error.message}`);
	return (data ?? [])
		.filter(f => f.name.endsWith('.json'))
		.map(f => { const [mm, dd] = f.name.replace('.json', '').split('-'); return `${seasonYear}-${mm}-${dd}`; })
		.sort();
}

async function fetchRawContests({ contestDate, seasonYear, division, sportCode }) {
	const HASH = '4bcb5e6432fa9da365c0c19af01b1f9015cc7eb5c21e7af2dba308784a166df7';
	const url = new URL('https://sdataprod.ncaa.com');
	url.searchParams.set('meta', 'GetContests_web');
	url.searchParams.set('extensions', JSON.stringify({ persistedQuery: { version: 1, sha256Hash: HASH } }));
	url.searchParams.set('queryName', 'GetContests_web');
	url.searchParams.set('variables', JSON.stringify({ sportCode, division, seasonYear, contestDate, week: null }));
	const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
	if (!res.ok) throw new Error(`NCAA API ${res.status}`);
	return res.json();
}

// ── Test 1: season lookup ─────────────────────────────────────────────────────
const { data: season } = await supabase.from('seasons').select('year, start_date, end_date').eq('label', '2025-2026').single();
if (!season) throw new Error('Season "2025-2026" not found in DB');
console.log(`Season 2025: year=${season.year}, start=${season.start_date}, end=${season.end_date}`);

// ── Test 2: POST /api/archive/date logic — fetch + save ───────────────────────
const contestDate = '2025-10-11';
const [yyyy, mm, dd] = contestDate.split('-');
const ncaaDate = `${mm}/${dd}/${yyyy}`;
const raw = await fetchRawContests({ contestDate: ncaaDate, seasonYear: season.year, division: 1, sportCode: 'MSO' });
const gamesCount = (raw?.data?.contests ?? []).length;
console.log(`NCAA API returned ${gamesCount} contests for ${contestDate}`);
if (gamesCount === 0) throw new Error('Expected > 0 contests for Oct 11 2025');

const { path } = await saveContestJson('MSO', 1, season.year, contestDate, raw);
console.log(`Saved: ${path}`);

// ── Test 3: overwrite silently (call twice) ───────────────────────────────────
const { path: path2 } = await saveContestJson('MSO', 1, season.year, contestDate, raw);
console.log(`Overwrite OK: ${path2}`);

// ── Test 4: GET /api/archive/status logic — list ─────────────────────────────
const archivedDates = await listArchivedDates('MSO', 1, season.year);
console.log(`archivedDates: ${JSON.stringify(archivedDates)}`);
if (!archivedDates.includes(contestDate)) throw new Error(`Expected ${contestDate} in archivedDates`);

// ── Clean up ──────────────────────────────────────────────────────────────────
await supabase.storage.from(BUCKET).remove([path]);
console.log('Test file cleaned up.');
console.log('\nAll endpoint logic verified ✓');
