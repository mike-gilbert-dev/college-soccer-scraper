// One-time bootstrap: import athletics roster-page URLs -> roster_sources rows.
// Matches each JSON key to a team by ncaa_team_id, else by slugified team name.
// Dry-run by default; pass --apply to insert. Skips teams already present.
//   node scripts/import-roster-sources.mjs                                 (dry run, MSO)
//   node scripts/import-roster-sources.mjs --apply                         (insert missing, MSO)
//   node scripts/import-roster-sources.mjs file.json --sport=WSO --apply   (women's)
// --sport=MSO|WSO selects the sport_code (default MSO).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
	readFileSync('.env', 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
		})
);
const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const file = process.argv.find((a) => a.endsWith('.json')) ?? 'supabase/seed-data/roster_urls_2025.json';
const sportArg = process.argv.find((a) => a.startsWith('--sport='))?.split('=')[1]?.toUpperCase();
const sportCode = sportArg ?? 'MSO';
if (!['MSO', 'WSO'].includes(sportCode)) {
	console.error(`Invalid --sport=${sportCode}; expected MSO or WSO.`);
	process.exit(1);
}
const urls = JSON.parse(readFileSync(file, 'utf8'));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const { data: teams } = await supabase.from('teams').select('id, ncaa_team_id, name');
const byNcaa = new Map(teams.map((t) => [t.ncaa_team_id, t]));
const bySlug = new Map();
for (const t of teams) {
	const k = slug(t.name);
	if (!bySlug.has(k)) bySlug.set(k, t);
}

const { data: seasons } = await supabase
	.from('seasons')
	.select('id, start_date')
	.order('start_date', { ascending: false })
	.limit(1);
const seasonId = seasons[0].id;

const { data: existing } = await supabase
	.from('roster_sources')
	.select('team_id')
	.eq('sport_code', sportCode)
	.eq('season_id', seasonId);
const existingTeamIds = new Set((existing ?? []).map((r) => r.team_id));

const matched = [];
const unmatched = [];
const collisions = [];
const seenTeam = new Map();
for (const [key, url] of Object.entries(urls)) {
	const domain = new URL(url).host;
	const team = byNcaa.get(key) ?? bySlug.get(key);
	if (!team) {
		unmatched.push(key);
		continue;
	}
	if (seenTeam.has(team.id)) collisions.push(`${key} & ${seenTeam.get(team.id)} -> ${team.name}`);
	seenTeam.set(team.id, key);
	matched.push({ key, domain, via: byNcaa.has(key) ? 'ncaa_id' : 'name-slug', team });
}

const toInsert = matched
	.filter((m) => !existingTeamIds.has(m.team.id))
	.map((m) => ({
		team_id: m.team.id,
		sport_code: sportCode,
		season_id: seasonId,
		domain: m.domain,
		platform: 'sidearm',
		status: 'unverified'
	}));

console.log(`sport_code=${sportCode} season_id=${seasonId}`);
console.log(`total=${Object.keys(urls).length} matched=${matched.length} unmatched=${unmatched.length} toInsert=${toInsert.length} alreadyPresent=${matched.length - toInsert.length}`);
console.log(`matched via name-slug (not ncaa_id): ${matched.filter((m) => m.via === 'name-slug').map((m) => m.key).join(', ') || '(none)'}`);
console.log(`UNMATCHED: ${unmatched.join(', ') || '(none)'}`);
if (collisions.length) console.log(`COLLISIONS: ${collisions.join(' | ')}`);

if (process.argv.includes('--apply') && toInsert.length) {
	const { error } = await supabase.from('roster_sources').insert(toInsert);
	if (error) {
		console.error('INSERT ERROR:', error.message);
		process.exit(1);
	}
	console.log(`INSERTED ${toInsert.length} roster_sources rows.`);
}
