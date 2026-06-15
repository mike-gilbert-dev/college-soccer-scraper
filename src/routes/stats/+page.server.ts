import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export type PlayerStat = {
	player_season_id: number;
	ncaa_player_id: string;
	player_name: string;
	position: string | null;
	class_year: string | null;
	team_season_id: number;
	team_name: string;
	team_ncaa_id: string;
	conference: string;
	games_played: number;
	minutes_played: number;
	goals: number;
	assists: number;
	points: number;
	shots: number;
	shots_on_goal: number;
	fouls: number;
	yellow_cards: number;
	red_cards: number;
	gk_saves: number | null;
	gk_goals_against: number | null;
	gk_shutouts: number;
};

export type TeamStat = {
	team_season_id: number;
	ncaa_team_id: string;
	team_name: string;
	conference: string;
	logo_url_light: string | null;
	logo_url_dark: string | null;
	gp: number;
	wins: number;
	losses: number;
	draws: number;
	gf: number;
	ga: number;
	gd: number;
	shots: number;
	shots_on_goal: number;
	fouls: number;
	yellow_cards: number;
	red_cards: number;
};

export type Leader = {
	ncaa_player_id: string;
	name: string;
	team: string;
	team_ncaa_id: string;
	pos: string | null;
	gp: number;
	value: number;
	logo_url_light: string | null;
	logo_url_dark: string | null;
	/** Cumulative season-to-date total after each game, resampled to length `n`. */
	series: number[];
};

export type LeaderCategory = {
	key: string;
	category: string;
	unit: string;
	/** Number of points on the x-axis (games); every series here has this length. */
	n: number;
	/** Field-average cumulative line, same length as each leader's series. */
	average: number[];
	leaders: Leader[];
};

const VALID_PLAYER_SORT_KEYS = new Set([
	'player_name', 'position', 'games_played', 'minutes_played',
	'goals', 'assists', 'points', 'shots', 'shots_on_goal',
	'fouls', 'yellow_cards', 'red_cards', 'gk_saves', 'gk_goals_against', 'gk_shutouts'
]);

export const load: PageServerLoad = async ({ url }) => {
	const sport        = url.searchParams.get('sport')    ?? 'MSO';
	const division     = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonParam  = url.searchParams.get('season');

	const rawSortBy  = url.searchParams.get('sortBy')  ?? 'goals';
	const sortBy     = VALID_PLAYER_SORT_KEYS.has(rawSortBy) ? rawSortBy : 'goals';
	const sortDir    = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

	const seasonBase = supabaseAdmin.from('seasons').select('id, label');
	const { data: season } = await (seasonParam
		? seasonBase.eq('label', seasonParam).single()
		: seasonBase.order('start_date', { ascending: false }).limit(1).single());

	const seasonLabel = season?.label ?? seasonParam ?? '';

	if (!season) {
		return { teamStats: [] as TeamStat[], conferences: [] as string[], leaderCategories: [] as LeaderCategory[], sport, division, seasonLabel };
	}

	// All team_seasons for the selected sport/division/season
	const { data: teamSeasons } = await supabaseAdmin
		.from('team_seasons')
		.select(`
			id,
			team:teams ( ncaa_team_id, name, short_name, logo_url_light, logo_url_dark ),
			conference:conferences ( short_name )
		`)
		.eq('season_id', season.id)
		.eq('division', division)
		.eq('sport_code', sport);

	const teamSeasonIds = (teamSeasons ?? []).map(ts => ts.id);

	// Build a lookup: team_season_id → { ncaa_team_id, name, conference }
	const teamMap: Record<number, { ncaa_team_id: string; name: string; conference: string; logo_url_light: string | null; logo_url_dark: string | null }> = {};
	for (const ts of teamSeasons ?? []) {
		const team = ts.team as unknown as { ncaa_team_id: string; name: string; logo_url_light: string | null; logo_url_dark: string | null } | null;
		const conf = ts.conference as unknown as { short_name: string } | null;
		if (team) {
			teamMap[ts.id] = {
				ncaa_team_id: team.ncaa_team_id,
				name: team.name,
				conference: conf?.short_name ?? '',
				logo_url_light: team.logo_url_light ?? null,
				logo_url_dark: team.logo_url_dark ?? null,
			};
		}
	}

	if (teamSeasonIds.length === 0) {
		return { teamStats: [] as TeamStat[], conferences: [] as string[], leaderCategories: [] as LeaderCategory[], sport, division, seasonLabel };
	}

	// Player season stats — sort server-side so any stat column returns the correct top players.
	// nullsFirst: false puts NULL gk_saves at the bottom when sorting GK columns.
	const { data: rawStats } = await supabaseAdmin
		.from('player_season_stats')
		.select('*')
		.in('team_season_id', teamSeasonIds)
		.gt('games_played', 0)
		.order(sortBy, { ascending: sortDir === 'asc', nullsFirst: sortDir === 'asc' })
		.limit(10000);

	const playerStats: PlayerStat[] = (rawStats ?? []).map(p => ({
		player_season_id: Number(p.player_season_id),
		ncaa_player_id: String(p.ncaa_player_id),
		player_name:    String(p.player_name),
		position:       p.position    as string | null,
		class_year:     p.class_year  as string | null,
		team_season_id: Number(p.team_season_id),
		team_name:      teamMap[Number(p.team_season_id)]?.name ?? '',
		team_ncaa_id:   teamMap[Number(p.team_season_id)]?.ncaa_team_id ?? '',
		conference:     teamMap[Number(p.team_season_id)]?.conference ?? '',
		games_played:   Number(p.games_played   ?? 0),
		minutes_played: Number(p.minutes_played ?? 0),
		goals:          Number(p.goals          ?? 0),
		assists:        Number(p.assists        ?? 0),
		points:         Number(p.points         ?? 0),
		shots:          Number(p.shots          ?? 0),
		shots_on_goal:  Number(p.shots_on_goal  ?? 0),
		fouls:          Number(p.fouls          ?? 0),
		yellow_cards:   Number(p.yellow_cards   ?? 0),
		red_cards:      Number(p.red_cards      ?? 0),
		gk_saves:         p.gk_saves         != null ? Number(p.gk_saves)         : null,
		gk_goals_against: p.gk_goals_against != null ? Number(p.gk_goals_against) : null,
		gk_shutouts:    Number(p.gk_shutouts ?? 0),
	}));

	// Final games for W/L/T/GF/GA per team
	const { data: games } = await supabaseAdmin
		.from('games')
		.select('home_team_season_id, away_team_season_id, home_score, away_score')
		.eq('season_id', season.id)
		.eq('sport_code', sport)
		.eq('division', division)
		.eq('status', 'final')
		.limit(5000);

	type Rec = {
		gp: number; wins: number; losses: number; draws: number;
		gf: number; ga: number;
		shots: number; shots_on_goal: number; fouls: number;
		yellow_cards: number; red_cards: number;
	};
	const recs: Record<number, Rec> = {};
	for (const id of teamSeasonIds) {
		recs[id] = { gp: 0, wins: 0, losses: 0, draws: 0, gf: 0, ga: 0, shots: 0, shots_on_goal: 0, fouls: 0, yellow_cards: 0, red_cards: 0 };
	}

	for (const g of games ?? []) {
		const hId = Number(g.home_team_season_id);
		const aId = Number(g.away_team_season_id);
		const hs  = Number(g.home_score ?? 0);
		const as_ = Number(g.away_score ?? 0);

		if (recs[hId]) {
			recs[hId].gp++; recs[hId].gf += hs; recs[hId].ga += as_;
			if (hs > as_) recs[hId].wins++;
			else if (hs < as_) recs[hId].losses++;
			else recs[hId].draws++;
		}
		if (recs[aId]) {
			recs[aId].gp++; recs[aId].gf += as_; recs[aId].ga += hs;
			if (as_ > hs) recs[aId].wins++;
			else if (as_ < hs) recs[aId].losses++;
			else recs[aId].draws++;
		}
	}

	// Aggregate player totals into team records
	for (const p of playerStats) {
		const rec = recs[p.team_season_id];
		if (rec) {
			rec.shots         += p.shots;
			rec.shots_on_goal += p.shots_on_goal;
			rec.fouls         += p.fouls;
			rec.yellow_cards  += p.yellow_cards;
			rec.red_cards     += p.red_cards;
		}
	}

	const teamStats: TeamStat[] = teamSeasonIds
		.filter(id => teamMap[id] && recs[id].gp > 0)
		.map(id => ({
			team_season_id: id,
			ncaa_team_id:    teamMap[id].ncaa_team_id,
			team_name:       teamMap[id].name,
			conference:      teamMap[id].conference,
			logo_url_light:  teamMap[id].logo_url_light,
			logo_url_dark:   teamMap[id].logo_url_dark,
			gp:             recs[id].gp,
			wins:           recs[id].wins,
			losses:         recs[id].losses,
			draws:          recs[id].draws,
			gf:             recs[id].gf,
			ga:             recs[id].ga,
			gd:             recs[id].gf - recs[id].ga,
			shots:          recs[id].shots,
			shots_on_goal:  recs[id].shots_on_goal,
			fouls:          recs[id].fouls,
			yellow_cards:   recs[id].yellow_cards,
			red_cards:      recs[id].red_cards,
		}))
		.sort((a, b) => b.wins - a.wins || b.gf - a.gf || a.ga - b.ga);

	const conferences = [...new Set(
		Object.values(teamMap).map(t => t.conference).filter(Boolean)
	)].sort();

	// ── Individual leaderboards (redesigned individual-stats tab) ───────────
	// Each category shows the top players with a cumulative per-game trend line
	// vs the field average. We build real cumulative series from per-game stats
	// for just the players that land on a leaderboard (a small set).
	type GameStatRow = {
		player_season_id: number;
		goals: number; assists: number; shots_on_goal: number;
		gk_saves: number | null; gk_shutout: boolean | null; date: string;
	};
	type CatDef = {
		key: string; category: string; unit: string;
		value: (p: PlayerStat) => number | null;
		perGame: (r: GameStatRow) => number;
	};
	const TOP_N = 6;
	const catDefs: CatDef[] = [
		{ key: 'goals',         category: 'Goals',         unit: 'goals',    value: p => p.goals,         perGame: r => r.goals },
		{ key: 'assists',       category: 'Assists',       unit: 'assists',  value: p => p.assists,       perGame: r => r.assists },
		{ key: 'points',        category: 'Points',        unit: 'points',   value: p => p.points,        perGame: r => 2 * r.goals + r.assists },
		{ key: 'shots_on_goal', category: 'Shots on Goal', unit: 'SOG',      value: p => p.shots_on_goal, perGame: r => r.shots_on_goal },
		{ key: 'gk_saves',      category: 'Saves',         unit: 'saves',    value: p => p.gk_saves,      perGame: r => r.gk_saves ?? 0 },
		{ key: 'gk_shutouts',   category: 'Shutouts',      unit: 'shutouts', value: p => p.gk_shutouts,   perGame: r => (r.gk_shutout ? 1 : 0) },
	];

	// Top players + field average per category (from season totals).
	const catTops = catDefs.map(def => {
		const cohort = playerStats
			.map(p => ({ p, v: def.value(p) }))
			.filter((x): x is { p: PlayerStat; v: number } => x.v != null && x.v > 0);
		const top = [...cohort].sort((a, b) => b.v - a.v).slice(0, TOP_N).map(x => x.p);
		const avg = cohort.length ? cohort.reduce((s, x) => s + x.v, 0) / cohort.length : 0;
		return { def, top, avg };
	}).filter(c => c.top.length > 0);

	// Per-game rows for every player that appears on any leaderboard.
	const leaderPsIds = [...new Set(catTops.flatMap(c => c.top.map(p => p.player_season_id)))];
	const gamesByPs: Record<number, GameStatRow[]> = {};
	if (leaderPsIds.length > 0) {
		const { data: pgRows } = await supabaseAdmin
			.from('player_game_stats')
			.select('player_season_id, goals, assists, shots_on_goal, gk_saves, gk_shutout, game:games ( contest_date )')
			.in('player_season_id', leaderPsIds)
			.limit(20000);
		for (const r of pgRows ?? []) {
			const psId = Number(r.player_season_id);
			const game = r.game as unknown as { contest_date: string } | null;
			(gamesByPs[psId] ??= []).push({
				player_season_id: psId,
				goals:         Number(r.goals ?? 0),
				assists:       Number(r.assists ?? 0),
				shots_on_goal: Number(r.shots_on_goal ?? 0),
				gk_saves:      r.gk_saves != null ? Number(r.gk_saves) : null,
				gk_shutout:    (r.gk_shutout as boolean | null) ?? null,
				date:          game?.contest_date ?? ''
			});
		}
		for (const key of Object.keys(gamesByPs)) {
			gamesByPs[Number(key)].sort((a, b) => a.date.localeCompare(b.date));
		}
	}

	// Resample an arbitrary-length cumulative series to exactly N points.
	function resample(arr: number[], N: number): number[] {
		if (N <= 0) return [];
		if (arr.length === 0) return new Array(N).fill(0);
		if (arr.length === 1) return new Array(N).fill(arr[0]);
		const out: number[] = [];
		for (let j = 0; j < N; j++) {
			const pos = (j / (N - 1)) * (arr.length - 1);
			const lo = Math.floor(pos), hi = Math.ceil(pos);
			out.push(Math.round(arr[lo] + (arr[hi] - arr[lo]) * (pos - lo)));
		}
		return out;
	}

	const leaderCategories: LeaderCategory[] = catTops.map(({ def, top, avg }) => {
		// x-axis length: the most games any leader in this category played.
		const n = Math.max(2, ...top.map(p => gamesByPs[p.player_season_id]?.length ?? p.games_played ?? 0));
		const leaders: Leader[] = top.map(p => {
			const rows = gamesByPs[p.player_season_id] ?? [];
			const total = def.value(p) ?? 0;
			let series: number[];
			if (rows.length > 0) {
				let acc = 0;
				const cum = rows.map(r => (acc += def.perGame(r)));
				series = resample(cum, n);
				series[n - 1] = total; // anchor the end to the true season total
			} else {
				series = Array.from({ length: n }, (_, i) => Math.round(total * ((i + 1) / n)));
			}
			const tm = teamMap[p.team_season_id];
			return {
				ncaa_player_id: p.ncaa_player_id,
				name:           p.player_name,
				team:           p.team_name,
				team_ncaa_id:   p.team_ncaa_id,
				pos:            p.position,
				gp:             p.games_played,
				value:          total,
				logo_url_light: tm?.logo_url_light ?? null,
				logo_url_dark:  tm?.logo_url_dark ?? null,
				series
			};
		});
		const average = Array.from({ length: n }, (_, i) => +(avg * Math.pow((i + 1) / n, 1.05)).toFixed(2));
		average[n - 1] = +avg.toFixed(2);
		return { key: def.key, category: def.category, unit: def.unit, n, average, leaders };
	});

	return { teamStats, conferences, leaderCategories, sport, division, seasonLabel };
};
