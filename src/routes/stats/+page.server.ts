import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const headshotUrl = (path: string | null | undefined): string | null =>
	path ? `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/player-headshots/${path}` : null;

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
	headshot_url: string | null;
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

type GameStatRow = {
	player_season_id: number;
	goals: number;
	assists: number;
	shots_on_goal: number;
	gk_saves: number | null;
	gk_shutout: boolean | null;
	points: number;
	date: string;
};

const CATEGORY_DEFS: { key: string; category: string; unit: string }[] = [
	{ key: 'goals',         category: 'Goals',         unit: 'goals' },
	{ key: 'assists',       category: 'Assists',       unit: 'assists' },
	{ key: 'points',        category: 'Points',        unit: 'points' },
	{ key: 'shots_on_goal', category: 'Shots on Goal', unit: 'SOG' },
	{ key: 'gk_saves',      category: 'Saves',         unit: 'saves' },
	{ key: 'gk_shutouts',   category: 'Shutouts',      unit: 'shutouts' }
];

/** Per-game value used to build each category's cumulative trend line. */
const PER_GAME_VALUE: Record<string, (r: GameStatRow) => number> = {
	goals:         r => r.goals,
	assists:       r => r.assists,
	points:        r => r.points,
	shots_on_goal: r => r.shots_on_goal,
	gk_saves:      r => r.gk_saves ?? 0,
	gk_shutouts:   r => (r.gk_shutout ? 1 : 0)
};

export const load: PageServerLoad = async ({ url }) => {
	const sport        = url.searchParams.get('sport')    ?? 'MSO';
	const division     = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonParam  = url.searchParams.get('season');

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

	// Precomputed team shot/foul/card totals -- refreshed nightly and during live
	// games by refresh_player_stat_leaders(), called from nightly-reconcile right
	// after it upserts player_game_stats. Replaces what used to be a live
	// league-wide aggregation over player_season_stats on every page load (the
	// query that was timing out as the season's game count grew).
	const { data: teamTotals } = await supabaseAdmin
		.from('team_season_stat_totals')
		.select('team_season_id, shots, shots_on_goal, fouls, yellow_cards, red_cards')
		.in('team_season_id', teamSeasonIds);

	const totalsByTeamSeason: Record<number, { shots: number; shots_on_goal: number; fouls: number; yellow_cards: number; red_cards: number }> = {};
	for (const t of teamTotals ?? []) {
		totalsByTeamSeason[Number(t.team_season_id)] = {
			shots:         Number(t.shots ?? 0),
			shots_on_goal: Number(t.shots_on_goal ?? 0),
			fouls:         Number(t.fouls ?? 0),
			yellow_cards:  Number(t.yellow_cards ?? 0),
			red_cards:     Number(t.red_cards ?? 0),
		};
	}

	// Final games for W/L/T/GF/GA per team -- unchanged; this query was never
	// the bottleneck (small, filtered to one season/sport/division).
	const { data: games } = await supabaseAdmin
		.from('games')
		.select('home_team_season_id, away_team_season_id, home_score, away_score')
		.eq('season_id', season.id)
		.eq('sport_code', sport)
		.eq('division', division)
		.eq('status', 'final')
		.limit(5000);

	type Rec = { gp: number; wins: number; losses: number; draws: number; gf: number; ga: number };
	const recs: Record<number, Rec> = {};
	for (const id of teamSeasonIds) {
		recs[id] = { gp: 0, wins: 0, losses: 0, draws: 0, gf: 0, ga: 0 };
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

	const teamStats: TeamStat[] = teamSeasonIds
		.filter(id => teamMap[id] && recs[id].gp > 0)
		.map(id => {
			const totals = totalsByTeamSeason[id] ?? { shots: 0, shots_on_goal: 0, fouls: 0, yellow_cards: 0, red_cards: 0 };
			return {
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
				shots:          totals.shots,
				shots_on_goal:  totals.shots_on_goal,
				fouls:          totals.fouls,
				yellow_cards:   totals.yellow_cards,
				red_cards:      totals.red_cards,
			};
		})
		.sort((a, b) => b.wins - a.wins || b.gf - a.gf || a.ga - b.ga);

	const conferences = [...new Set(
		Object.values(teamMap).map(t => t.conference).filter(Boolean)
	)].sort();

	// ── Individual leaderboards ──────────────────────────────────────────────
	// Top-6-per-category and the field average are precomputed on the same
	// nightly/live-window cadence as team totals above. Only names/team/headshot
	// for the handful of players that actually show up need fetching here, plus
	// their per-game rows to build each leader's trend line.
	const { data: leaderRows } = await supabaseAdmin
		.from('player_season_stat_leaders')
		.select('category_key, rank, player_season_id, value')
		.eq('season_id', season.id)
		.eq('sport_code', sport)
		.eq('division', division)
		.order('rank', { ascending: true });

	const { data: averageRows } = await supabaseAdmin
		.from('player_season_stat_category_averages')
		.select('category_key, avg_value')
		.eq('season_id', season.id)
		.eq('sport_code', sport)
		.eq('division', division);

	const avgByCategory: Record<string, number> = {};
	for (const a of averageRows ?? []) {
		avgByCategory[a.category_key] = Number(a.avg_value ?? 0);
	}

	const leaderPsIds = [...new Set((leaderRows ?? []).map(r => Number(r.player_season_id)))];

	type PlayerInfo = {
		ncaa_player_id: string;
		player_name: string;
		team_season_id: number;
		position: string | null;
		games_played: number;
		headshot_path: string | null;
	};
	const playerInfoByPsId: Record<number, PlayerInfo> = {};
	if (leaderPsIds.length > 0) {
		const { data: leaderPlayers } = await supabaseAdmin
			.from('player_season_stats')
			.select('player_season_id, ncaa_player_id, player_name, team_season_id, position, games_played, headshot_path')
			.in('player_season_id', leaderPsIds);
		for (const p of leaderPlayers ?? []) {
			playerInfoByPsId[Number(p.player_season_id)] = {
				ncaa_player_id: String(p.ncaa_player_id),
				player_name:    String(p.player_name),
				team_season_id: Number(p.team_season_id),
				position:       p.position as string | null,
				games_played:   Number(p.games_played ?? 0),
				headshot_path:  p.headshot_path as string | null,
			};
		}
	}

	// Per-game rows for every player that appears on any leaderboard.
	const gamesByPs: Record<number, GameStatRow[]> = {};
	if (leaderPsIds.length > 0) {
		const { data: pgRows } = await supabaseAdmin
			.from('player_game_stats')
			.select('player_season_id, goals, assists, shots_on_goal, gk_saves, gk_shutout, player_game_stats_points, game:games ( contest_date )')
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
				points:        Number(r.player_game_stats_points ?? 0),
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

	const leadersByCategory: Record<string, { rank: number; player_season_id: number; value: number }[]> = {};
	for (const r of leaderRows ?? []) {
		(leadersByCategory[r.category_key] ??= []).push({
			rank: Number(r.rank),
			player_season_id: Number(r.player_season_id),
			value: Number(r.value)
		});
	}

	const leaderCategories: LeaderCategory[] = CATEGORY_DEFS
		.map(def => {
			const rows = (leadersByCategory[def.key] ?? []).sort((a, b) => a.rank - b.rank);
			if (rows.length === 0) return null;

			// x-axis length: the most games any leader in this category played.
			const n = Math.max(2, ...rows.map(r => gamesByPs[r.player_season_id]?.length ?? playerInfoByPsId[r.player_season_id]?.games_played ?? 0));
			const perGame = PER_GAME_VALUE[def.key];

			const leaders: Leader[] = rows.map(r => {
				const info = playerInfoByPsId[r.player_season_id];
				const gameRows = gamesByPs[r.player_season_id] ?? [];
				let series: number[];
				if (gameRows.length > 0) {
					let acc = 0;
					const cum = gameRows.map(row => (acc += perGame(row)));
					series = resample(cum, n);
					series[n - 1] = r.value; // anchor the end to the true season total
				} else {
					series = Array.from({ length: n }, (_, i) => Math.round(r.value * ((i + 1) / n)));
				}
				const tm = info ? teamMap[info.team_season_id] : undefined;
				return {
					ncaa_player_id: info?.ncaa_player_id ?? '',
					name:           info?.player_name ?? '',
					team:           tm?.name ?? '',
					team_ncaa_id:   tm?.ncaa_team_id ?? '',
					pos:            info?.position ?? null,
					gp:             info?.games_played ?? 0,
					value:          r.value,
					logo_url_light: tm?.logo_url_light ?? null,
					logo_url_dark:  tm?.logo_url_dark ?? null,
					headshot_url:   headshotUrl(info?.headshot_path),
					series
				};
			});

			const avg = avgByCategory[def.key] ?? 0;
			const average = Array.from({ length: n }, (_, i) => +(avg * Math.pow((i + 1) / n, 1.05)).toFixed(2));
			average[n - 1] = +avg.toFixed(2);

			return { key: def.key, category: def.category, unit: def.unit, n, average, leaders };
		})
		.filter((c): c is LeaderCategory => c !== null);

	return { teamStats, conferences, leaderCategories, sport, division, seasonLabel };
};
