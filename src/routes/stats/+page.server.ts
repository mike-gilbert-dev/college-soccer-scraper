import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export type PlayerStat = {
	ncaa_player_id: string;
	player_name: string;
	position: string | null;
	class_year: string | null;
	team_season_id: number;
	team_name: string;
	team_ncaa_id: string;
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
		return { playerStats: [] as PlayerStat[], teamStats: [] as TeamStat[], sport, division, seasonLabel, sortBy, sortDir };
	}

	// All team_seasons for the selected sport/division/season
	const { data: teamSeasons } = await supabaseAdmin
		.from('team_seasons')
		.select(`
			id,
			team:teams ( ncaa_team_id, name, short_name ),
			conference:conferences ( short_name )
		`)
		.eq('season_id', season.id)
		.eq('division', division)
		.eq('sport_code', sport);

	const teamSeasonIds = (teamSeasons ?? []).map(ts => ts.id);

	// Build a lookup: team_season_id → { ncaa_team_id, name, conference }
	const teamMap: Record<number, { ncaa_team_id: string; name: string; conference: string }> = {};
	for (const ts of teamSeasons ?? []) {
		const team = ts.team as unknown as { ncaa_team_id: string; name: string } | null;
		const conf = ts.conference as unknown as { short_name: string } | null;
		if (team) {
			teamMap[ts.id] = {
				ncaa_team_id: team.ncaa_team_id,
				name: team.name,
				conference: conf?.short_name ?? ''
			};
		}
	}

	if (teamSeasonIds.length === 0) {
		return { playerStats: [] as PlayerStat[], teamStats: [] as TeamStat[], sport, division, seasonLabel, sortBy, sortDir };
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
		ncaa_player_id: String(p.ncaa_player_id),
		player_name:    String(p.player_name),
		position:       p.position    as string | null,
		class_year:     p.class_year  as string | null,
		team_season_id: Number(p.team_season_id),
		team_name:      teamMap[Number(p.team_season_id)]?.name ?? '',
		team_ncaa_id:   teamMap[Number(p.team_season_id)]?.ncaa_team_id ?? '',
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
			ncaa_team_id:   teamMap[id].ncaa_team_id,
			team_name:      teamMap[id].name,
			conference:     teamMap[id].conference,
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

	return { playerStats, teamStats, sport, division, seasonLabel, sortBy, sortDir };
};
