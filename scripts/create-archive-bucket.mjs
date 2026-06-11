// Run once to create the ncaa-raw-games Storage bucket.
// Usage: node scripts/create-archive-bucket.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const env = Object.fromEntries(
	readFileSync(envPath, 'utf8')
		.split('\n')
		.filter(l => l.includes('='))
		.map(l => l.split('=').map(s => s.trim()))
);

const url = env['PUBLIC_SUPABASE_URL'];
const key = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url || !key) {
	console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
	process.exit(1);
}

const supabase = createClient(url, key);

const { data, error } = await supabase.storage.createBucket('ncaa-raw-games', { public: false });

if (error) {
	if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
		console.log('Bucket ncaa-raw-games already exists — nothing to do.');
	} else {
		console.error('Failed to create bucket:', error.message);
		process.exit(1);
	}
} else {
	console.log('Created bucket ncaa-raw-games:', data);
}
