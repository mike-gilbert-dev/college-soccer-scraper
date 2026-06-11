// Smoke test for Phase 2 ingest endpoint logic.
// Replicates the endpoint logic directly (no HTTP — auth not available in scripts).
// Usage: node scripts/smoke-test-ingest-endpoints.mjs
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

const sb = createClient(env['PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
const BUCKET = 'ncaa-raw-games';

// ── Storage helpers ───────────────────────────────────────────────────────────
function archivePath(sportCode, division, seasonYear, contestDate) {
	const [, mm, dd] = contestDate.split('-');
	return `${sportCode}/${division}/${seasonYear}/${mm}-${dd}.json`;
}
function boxScorePath(sportCode, division, seasonYear, contestId) {
	return `${sportCode}/${division}/${seasonYear}/boxscores/${contestId}.json`;
}
function normalizeStatus(s) {
	switch (s?.toLowerCase()) {
		case 'final':     return 'final';
		case 'live':      return 'live';
		case 'postponed': return 'postponed';
		case 'cancelled': return 'cancelled';
		default:          return 'scheduled';
	}
}
function syntheticPlayerId(teamId, firstName, lastName) {
	const norm = (s) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
	return `${teamId}_${norm(firstName)}_${norm(lastName)}`;
}
const isNotFound = (msg) =>
	msg.includes('Not Found') || msg.includes('404') || msg.includes('Object not found');

async function readGameContests(sportCode, division, seasonYear, contestDate) {
	const path = archivePath(sportCode, division, seasonYear, contestDate);
	const { data, error } = await sb.storage.from(BUCKET).download(path);
	if (error) { if (isNotFound(error.message)) return []; throw new Error(error.message); }
	const json = JSON.parse(await data.text());
	return json?.data?.contests ?? [];
}
async function readStoredBoxScore(sportCode, division, seasonYear, contestId) {
	const path = boxScorePath(sportCode, division, seasonYear, contestId);
	const { data, error } = await sb.storage.from(BUCKET).download(path);
	if (error) { if (isNotFound(error.message)) return { fileFound: false }; throw new Error(error.message); }
	const json = JSON.parse(await data.text());
	return { fileFound: true, boxScore: json?.data?.boxscore ?? null };
}
async function listArchivedDates(sportCode, division, seasonYear) {
	const { data, error } = await sb.storage.from(BUCKET).list(`${sportCode}/${division}/${seasonYear}`, { limit: 400 });
	if (error) throw new Error(error.message);
	return (data ?? []).filter(f => f.name.endsWith('.json')).map(f => {
		const [mm, dd] = f.name.replace('.json', '').split('-');
		return `${seasonYear}-${mm}-${dd}`;
	}).sort();
}
async function listArchivedBoxScoreIds(sportCode, division, seasonYear) {
	const { data, error } = await sb.storage.from(BUCKET).list(`${sportCode}/${division}/${seasonYear}/boxscores`, { limit: 2000 });
	if (error) throw new Error(error.message);
	return (data ?? []).filter(f => f.name.endsWith('.json')).map(f => f.name.replace('.json', '')).sort();
}

// ── Season lookup ─────────────────────────────────────────────────────────────
const { data: season } = await sb.from('seasons').select('id, year, start_date, end_date').eq('label', '2025-2026').single();
if (!season) throw new Error('Season "2025-2026" not found');
console.log(`Season: id=${season.id}, year=${season.year}`);

// ── Test GET /api/ingest/status logic ─────────────────────────────────────────
const [archivedDates, archivedBoxScoreIds, { count: dbGamesCount }] = await Promise.all([
	listArchivedDates('MSO', 1, season.year),
	listArchivedBoxScoreIds('MSO', 1, season.year),
	sb.from('games').select('*', { count: 'exact', head: true })
		.eq('season_id', season.id).eq('sport_code', 'MSO').eq('division', 1)
]);
console.log(`\nGET /api/ingest/status logic:`);
console.log(`  archivedGameFiles: ${archivedDates.length}`);
console.log(`  archivedBoxScores: ${archivedBoxScoreIds.length}`);
console.log(`  dbGamesCount: ${dbGamesCount ?? 0}`);
console.log(`  startDate: ${season.start_date}, endDate: ${season.end_date}`);

// ── Test POST /api/ingest/date logic — date with archived game file ────────────
const contestDate = '2025-12-15';
const contests = await readGameContests('MSO', 1, season.year, contestDate);
console.log(`\nPOST /api/ingest/date logic for ${contestDate}:`);
console.log(`  contestsFound: ${contests.length}`);
if (contests.length === 0) throw new Error('Expected >0 contests');

const contest = contests[0];
const homeData = contest.teams.find(t => t.isHome);
const awayData = contest.teams.find(t => !t.isHome);
console.log(`  contest ${contest.contestId}: status=${contest.statusCodeDisplay}, home=${homeData?.seoname}, away=${awayData?.seoname}`);

// Upsert teams
const [{ data: homeTeam }, { data: awayTeam }] = await Promise.all([
	sb.from('teams').upsert({ ncaa_team_id: homeData.seoname, name: homeData.nameShort, short_name: homeData.name6Char || homeData.nameShort }, { onConflict: 'ncaa_team_id' }).select('id').single(),
	sb.from('teams').upsert({ ncaa_team_id: awayData.seoname, name: awayData.nameShort, short_name: awayData.name6Char || awayData.nameShort }, { onConflict: 'ncaa_team_id' }).select('id').single()
]);
console.log(`  teams upserted: home.id=${homeTeam?.id}, away.id=${awayTeam?.id}`);

// Upsert game
const startTime = contest.startTimeEpoch ? new Date(contest.startTimeEpoch * 1000).toISOString() : null;
// Get/create team_seasons
const [{ data: htSeason }, { data: atSeason }] = await Promise.all([
	sb.from('team_seasons').upsert({ team_id: homeTeam.id, season_id: season.id, division: 1, sport_code: 'MSO' }, { onConflict: 'team_id,season_id,sport_code' }).select('id').single(),
	sb.from('team_seasons').upsert({ team_id: awayTeam.id, season_id: season.id, division: 1, sport_code: 'MSO' }, { onConflict: 'team_id,season_id,sport_code' }).select('id').single()
]);

const { data: gameRow, error: gameErr } = await sb.from('games').upsert({
	ncaa_contest_id: String(contest.contestId),
	season_id: season.id,
	contest_date: contestDate,
	start_time: startTime,
	home_team_season_id: htSeason.id,
	away_team_season_id: atSeason.id,
	home_score: homeData.score,
	away_score: awayData.score,
	status: normalizeStatus(contest.statusCodeDisplay),
	neutral_site: false,
	sport_code: 'MSO',
	division: 1,
	broadcaster_name: contest.broadcasterName ?? null,
	round_description: contest.roundDescription ?? null,
	last_fetched_at: new Date().toISOString()
}, { onConflict: 'ncaa_contest_id' }).select('id').single();

if (gameErr) throw new Error(`Game upsert failed: ${gameErr.message}`);
console.log(`  game upserted: id=${gameRow.id}, status=${normalizeStatus(contest.statusCodeDisplay)}`);

// Check box score
const bsResult = await readStoredBoxScore('MSO', 1, season.year, String(contest.contestId));
console.log(`  box score: fileFound=${bsResult.fileFound}${bsResult.fileFound ? ', boxScore=' + (bsResult.boxScore ? 'present' : 'null') : ''}`);

// ── Test idempotency — upsert same game again ──────────────────────────────────
const { data: gameRow2, error: gameErr2 } = await sb.from('games').upsert({
	ncaa_contest_id: String(contest.contestId),
	season_id: season.id,
	contest_date: contestDate,
	start_time: startTime,
	home_team_season_id: htSeason.id,
	away_team_season_id: atSeason.id,
	home_score: homeData.score,
	away_score: awayData.score,
	status: normalizeStatus(contest.statusCodeDisplay),
	neutral_site: false,
	sport_code: 'MSO',
	division: 1,
	last_fetched_at: new Date().toISOString()
}, { onConflict: 'ncaa_contest_id' }).select('id').single();
if (gameErr2) throw new Error(`Idempotency check failed: ${gameErr2.message}`);
if (gameRow2.id !== gameRow.id) throw new Error('Idempotency check: game id changed on second upsert');
console.log(`  idempotency: same game id on second upsert ✓`);

// ── Test off-season date returns 0 ────────────────────────────────────────────
const offSeason = await readGameContests('MSO', 1, season.year, '2025-01-01');
if (offSeason.length !== 0) throw new Error('Expected [] for off-season date');
console.log(`\nreadGameContests('2025-01-01'): 0 contests (correct)`);

// ── Test GET status reflects the upserted game ────────────────────────────────
const { count: afterCount } = await sb.from('games').select('*', { count: 'exact', head: true })
	.eq('season_id', season.id).eq('sport_code', 'MSO').eq('division', 1);
console.log(`\ndbGamesCount after ingest: ${afterCount} (was ${dbGamesCount ?? 0})`);
if ((afterCount ?? 0) < 1) throw new Error('Expected at least 1 game in DB');

console.log('\nAll Phase 2 endpoint logic verified ✓');
