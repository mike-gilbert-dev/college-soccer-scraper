// Refresh supabase/functions/_shared from the authoritative src/lib/server
// modules. See supabase/functions/_shared/README.md.
//
//   node scripts/sync-shared.mjs          # write
//   node scripts/sync-shared.mjs --check  # fail if out of date (CI)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
	'carriers.ts',
	'schedule.ts',
	'schedule-html.ts',
	'schedule-match.ts',
	'names.ts'
];

// Deno needs a registry specifier; Node/Vitest needs the bare one.
const transforms = [
	[/from 'node-html-parser'/g, "from 'npm:node-html-parser@6.1.13'"],
	[/from '\.\/sidearm'/g, "from './sidearm.ts'"]
];

const check = process.argv.includes('--check');
let stale = 0;

for (const f of FILES) {
	const src = resolve('src/lib/server', f);
	const dest = resolve('supabase/functions/_shared', f);
	let body = readFileSync(src, 'utf8');
	for (const [re, to] of transforms) body = body.replace(re, to);

	let current = '';
	try {
		current = readFileSync(dest, 'utf8');
	} catch {
		/* missing */
	}

	if (current === body) continue;
	if (check) {
		console.error(`stale: supabase/functions/_shared/${f}`);
		stale++;
	} else {
		writeFileSync(dest, body);
		console.log(`synced: ${f}`);
	}
}

if (check && stale) {
	console.error(`\n${stale} shared file(s) out of date — run: npm run sync:shared`);
	process.exit(1);
}
if (check) console.log('shared modules up to date');
