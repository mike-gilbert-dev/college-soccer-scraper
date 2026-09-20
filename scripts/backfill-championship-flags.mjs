// Backfill games.is_championship / home_seed / away_seed from the archived NCAA
// feed in the `ncaa-raw-games` bucket. Reads Storage only — makes zero NCAA calls,
// so it is safe to run at any time and as often as you like.
//
// The archive is the same JSON nightly-ingest already saved per date, so every
// field we need is sitting there; these columns simply post-date the ingest that
// wrote those files.
//
//   node scripts/backfill-championship-flags.mjs                 (dry run, all seasons)
//   node scripts/backfill-championship-flags.mjs --apply
//   node scripts/backfill-championship-flags.mjs --year=2025 --sport=MSO --apply
//
// Only postseason dates carry bracket data, so --since/--until trim the scan;
// by default it walks every archived date for the selected season(s).
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

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const apply = process.argv.includes('--apply');
const yearFilter = arg('year');
const sportFilter = arg('sport')?.toUpperCase();
const BUCKET = 'ncaa-raw-games';

// Archive layout: <SPORT>/<division>/<year>/<MM-DD>.json
async function listArchive() {
	const out = [];
	const sports = sportFilter ? [sportFilter] : ['MSO', 'WSO'];
	for (const sport of sports) {
		for (const division of ['1']) {
			const years = yearFilter ? [yearFilter] : ['2023', '2024', '2025', '2026'];
			for (const year of years) {
				const prefix = `${sport}/${division}/${year}`;
				// Storage list caps at 100 by default and paginates like everything else.
				for (let offset = 0; ; offset += 1000) {
					const { data, error } = await supabase.storage
						.from(BUCKET)
						.list(prefix, { limit: 1000, offset });
					if (error) throw new Error(`list ${prefix}: ${error.message}`);
					if (!data?.length) break;
					for (const f of data) {
						if (f.name.endsWith('.json')) out.push({ sport, division, year, path: `${prefix}/${f.name}` });
					}
					if (data.length < 1000) break;
				}
			}
		}
	}
	return out;
}

// A contest is only worth an update if it actually carries bracket data. Writing
// is_championship=false for all 20k regular-season rows would be a no-op against
// the column default and would churn the whole table.
function bracketRows(contests) {
	const rows = [];
	for (const c of contests ?? []) {
		const home = c.teams?.find((t) => t.isHome);
		const away = c.teams?.find((t) => !t.isHome);
		if (!home || !away) continue;
		const champ = c.isChampionship === true;
		const hs = home.seed ?? null;
		const as = away.seed ?? null;
		if (!champ && hs === null && as === null) continue;
		rows.push({ id: String(c.contestId), champ, hs, as });
	}
	return rows;
}

const files = await listArchive();
console.log(`scanning ${files.length} archived dates${apply ? '' : '  (DRY RUN — pass --apply to write)'}`);

let found = 0;
let updated = 0;
let missing = 0;
const perSeason = new Map();

for (const f of files) {
	const { data, error } = await supabase.storage.from(BUCKET).download(f.path);
	if (error) {
		console.warn(`  skip ${f.path}: ${error.message}`);
		continue;
	}
	let parsed;
	try {
		parsed = JSON.parse(await data.text());
	} catch {
		console.warn(`  skip ${f.path}: unparseable`);
		continue;
	}
	// The archive stores the raw GraphQL envelope.
	const contests = parsed?.data?.contests ?? parsed?.contests ?? [];
	const rows = bracketRows(contests);
	if (!rows.length) continue;
	found += rows.length;

	const key = `${f.year} ${f.sport}`;
	perSeason.set(key, (perSeason.get(key) ?? 0) + rows.length);

	if (!apply) {
		console.log(`  ${f.path}: ${rows.length} bracket contests`);
		continue;
	}

	// Update by ncaa_contest_id — the archive's only stable join key, and the same
	// key the ingest upserts on. Never insert: a contest absent from `games` was
	// filtered out upstream (unmapped team), and inventing a row here would bypass
	// the team_season resolution the ingest does.
	for (const r of rows) {
		const { data: upd, error: uerr } = await supabase
			.from('games')
			.update({ is_championship: r.champ, home_seed: r.hs, away_seed: r.as })
			.eq('ncaa_contest_id', r.id)
			.select('id');
		if (uerr) {
			console.warn(`  update ${r.id}: ${uerr.message}`);
			continue;
		}
		if (upd?.length) updated += upd.length;
		else missing++;
	}
}

console.log('\nbracket contests in archive by season:');
for (const [k, v] of [...perSeason.entries()].sort()) console.log(`  ${k}: ${v}`);
console.log(`\ntotal found: ${found}`);
if (apply) console.log(`rows updated: ${updated}   not in games table: ${missing}`);
