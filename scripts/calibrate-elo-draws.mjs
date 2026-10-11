// Fit the constants behind the game-preview win probability (src/lib/prediction.ts).
//
// Elo only yields an expected SCORE, E = P(win) + ½·P(draw). Soccer needs the draw
// split out — ~22% of D1 finals are draws — so the preview uses
//
//   g       = scale·(eloHome − eloAway) + homeAdv     (homeAdv = 0 at a neutral site)
//   E       = 1 / (1 + 10^(−g/400))
//   P(draw) = clamp(drawBase + drawSlope·|g|)
//   P(home) = E − ½·P(draw)    P(away) = 1 − E − ½·P(draw)
//
// The preview's scale/homeAdv are deliberately NOT the rating engine's: measured
// against real finals, the engine's 85-point home edge is far too big (at an even
// gap the AWAY side wins more often) and its spread is too narrow (big favourites
// win more than raw Elo says). The engine's constants tune how ratings MOVE; these
// tune how a rating gap reads as odds, so the two are fitted separately and the
// ratings themselves are untouched.
//
// Grid-searches scale/homeAdv for minimum log loss, fitting the draw line by least
// squares at each point. Read-only: never writes, safe to re-run each off-season
// and paste the printed constants into src/lib/prediction.ts.
//
// Pre-game Elo is recovered from the per-game team_ratings rows the nightly
// recompute stores: each row is the POST-game value with meta.delta, so
// pre = value − delta. 2023 is skipped by default: every team was seeded at 1500
// that year, so its early-season gaps say nothing about the model.
//
//   node scripts/calibrate-elo-draws.mjs
//   node scripts/calibrate-elo-draws.mjs --seasons=2023-2024,2024-2025
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
const seasonLabels = (arg('seasons') ?? '2024-2025,2025-2026,2026-2027').split(',');
const PAGE = 1000; // PostgREST max_rows — anything bigger truncates silently
const DRAW_MIN = 0.05; // clamp bounds — mirror src/lib/prediction.ts
const DRAW_MAX = 0.35;

async function all(build) {
	const out = [];
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await build().range(from, from + PAGE - 1);
		if (error) throw error;
		out.push(...data);
		if (data.length < PAGE) return out;
	}
}

/** Least-squares draw line for one (scale, homeAdv), plus its log loss. */
function evaluate(samples, scale, homeAdv) {
	const n = samples.length;
	const gaps = samples.map((s) => scale * s.raw + (s.neutral ? 0 : homeAdv));
	const xs = gaps.map(Math.abs);
	const ys = samples.map((s) => (s.outcome === 'draw' ? 1 : 0));
	const mx = xs.reduce((a, b) => a + b, 0) / n;
	const my = ys.reduce((a, b) => a + b, 0) / n;
	let sxy = 0, sxx = 0;
	for (let i = 0; i < n; i++) {
		sxy += (xs[i] - mx) * (ys[i] - my);
		sxx += (xs[i] - mx) ** 2;
	}
	const drawSlope = sxy / sxx;
	const drawBase = my - drawSlope * mx;

	const probs = gaps.map((g) => {
		const e = 1 / (1 + Math.pow(10, -g / 400));
		const d = Math.min(DRAW_MAX, Math.max(DRAW_MIN, drawBase + drawSlope * Math.abs(g)));
		const home = Math.max(0.01, e - d / 2);
		const away = Math.max(0.01, 1 - e - d / 2);
		const t = home + d + away;
		return { home: home / t, draw: d / t, away: away / t };
	});
	let ll = 0;
	for (let i = 0; i < n; i++) ll -= Math.log(probs[i][samples[i].outcome]);
	return { scale, homeAdv, drawBase, drawSlope, logLoss: ll / n, gaps, probs };
}

const { data: seasons, error: sErr } = await supabase
	.from('seasons')
	.select('id, label')
	.in('label', seasonLabels);
if (sErr) throw sErr;

for (const sport of ['MSO', 'WSO']) {
	const samples = []; // { raw, neutral, outcome }

	for (const season of seasons) {
		const games = await all(() =>
			supabase
				.from('games')
				.select('id, contest_date, home_team_season_id, away_team_season_id, home_score, away_score, round_description')
				.eq('season_id', season.id)
				.eq('sport_code', sport)
				.eq('division', 1)
				.eq('status', 'final')
				.not('home_score', 'is', null)
				.not('away_score', 'is', null)
				.order('id')
		);

		const ratings = await all(() =>
			supabase
				.from('team_ratings')
				.select('team_season_id, as_of, value, meta, team_seasons!inner(season_id, sport_code)')
				.eq('system', 'elo')
				.eq('team_seasons.season_id', season.id)
				.eq('team_seasons.sport_code', sport)
				.order('id')
		);

		// (team_season, date) -> pre-game Elo. A double-header on one date would
		// collide; those are vanishingly rare and simply dropped.
		const pre = new Map();
		const seen = new Set();
		for (const r of ratings) {
			const k = `${r.team_season_id}|${r.as_of}`;
			if (seen.has(k)) pre.delete(k);
			else pre.set(k, r.value - (r.meta?.delta ?? 0));
			seen.add(k);
		}

		for (const g of games) {
			const h = pre.get(`${g.home_team_season_id}|${g.contest_date}`);
			const a = pre.get(`${g.away_team_season_id}|${g.contest_date}`);
			if (h === undefined || a === undefined) continue;
			samples.push({
				raw: h - a,
				// Mirrors isNeutralSite() in src/lib/prediction.ts.
				neutral: g.round_description === 'Semifinals' || g.round_description === 'Championship',
				outcome: g.home_score > g.away_score ? 'home' : g.home_score < g.away_score ? 'away' : 'draw'
			});
		}
	}

	const n = samples.length;
	const engine = evaluate(samples, 1, 85);
	let best = engine;
	for (let scale = 0.8; scale <= 2.21; scale += 0.05) {
		for (let homeAdv = -20; homeAdv <= 120; homeAdv += 5) {
			const r = evaluate(samples, scale, homeAdv);
			if (r.logLoss < best.logLoss) best = r;
		}
	}

	const freq = { home: 0, draw: 0, away: 0 };
	for (const s of samples) freq[s.outcome] += 1 / n;
	const baseLL = -samples.reduce((acc, s) => acc + Math.log(freq[s.outcome]), 0) / n;

	console.log(`\n=== ${sport} — ${n} finals (${seasonLabels.join(', ')}) ===`);
	console.log(
		`outcomes: home ${(freq.home * 100).toFixed(1)}%  draw ${(freq.draw * 100).toFixed(1)}%  away ${(freq.away * 100).toFixed(1)}%`
	);
	console.log(`log loss: no-skill ${baseLL.toFixed(4)} | engine constants (1, 85) ${engine.logLoss.toFixed(4)} | fitted ${best.logLoss.toFixed(4)}`);
	console.log(
		`fitted: { scale: ${best.scale.toFixed(2)}, homeAdv: ${best.homeAdv}, drawBase: ${best.drawBase.toFixed(4)}, drawSlope: ${best.drawSlope.toExponential(3)} }`
	);

	// Calibration table for the fitted model: predicted vs actual per gap bucket.
	const buckets = [-Infinity, -300, -200, -100, -50, 0, 50, 100, 200, 300, Infinity];
	console.log('gap bucket         n   home%  pred   draw%  pred   away%  pred');
	let hits = 0;
	for (let i = 0; i < n; i++) {
		const p = best.probs[i];
		const fav = p.home >= p.away && p.home >= p.draw ? 'home' : p.away >= p.draw ? 'away' : 'draw';
		if (fav === samples[i].outcome) hits++;
	}
	for (let b = 0; b < buckets.length - 1; b++) {
		const idx = [];
		for (let i = 0; i < n; i++) if (best.gaps[i] >= buckets[b] && best.gaps[i] < buckets[b + 1]) idx.push(i);
		if (!idx.length) continue;
		const act = (o) => (100 * idx.filter((i) => samples[i].outcome === o).length) / idx.length;
		const pred = (o) => (100 * idx.reduce((acc, i) => acc + best.probs[i][o], 0)) / idx.length;
		const f = (x) => x.toFixed(1).padStart(5);
		const lbl = `[${buckets[b]}, ${buckets[b + 1]})`.padEnd(16);
		console.log(
			`${lbl} ${String(idx.length).padStart(4)}  ${f(act('home'))} ${f(pred('home'))}  ${f(act('draw'))} ${f(pred('draw'))}  ${f(act('away'))} ${f(pred('away'))}`
		);
	}
	console.log(`favourite correct ${((100 * hits) / n).toFixed(1)}%`);
}
