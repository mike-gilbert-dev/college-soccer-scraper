// Smoke test for ncaa-archive helpers. Run once, then delete.
// Usage: node scripts/smoke-test-archive.mjs
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

// Replicate the helpers inline (can't import TS directly)
function archivePath(sportCode, division, seasonYear, contestDate) {
	const [, mm, dd] = contestDate.split('-');
	return `${sportCode}/${division}/${seasonYear}/${mm}-${dd}.json`;
}

async function saveContestJson(sportCode, division, seasonYear, contestDate, data) {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const body = JSON.stringify(data, null, 2);
	const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: 'application/json', upsert: true });
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

// Test
const { path } = await saveContestJson('MSO', 1, 2025, '2025-10-11', { test: true, source: 'smoke-test' });
console.log('Saved to:', path);

const dates = await listArchivedDates('MSO', 1, 2025);
console.log('Listed dates:', dates);

if (!dates.includes('2025-10-11')) throw new Error('listArchivedDates did not return 2025-10-11');
console.log('Smoke test passed.');

// Clean up
const { error: delErr } = await supabase.storage.from(BUCKET).remove([path]);
if (delErr) console.warn('Cleanup failed (manual delete needed):', delErr.message);
else console.log('Test file cleaned up.');
