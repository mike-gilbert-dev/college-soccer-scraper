import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export type RatingStanding = {
	id: number;
	team: {
		id: number;
		ncaa_team_id: string;
		name: string;
		short_name: string;
		logo_url_dark: string | null;
		logo_url_light: string | null;
	};
	conference: { name: string; short_name: string } | null;
	value: number | null;
	rank: number | null;
	games_played: number;
};

const SYSTEMS = ['elo', 'rpi', 'power'] as const;
type System = (typeof SYSTEMS)[number];

export const load: PageServerLoad = async ({ url }) => {
	const sport = url.searchParams.get('sport') ?? 'MSO';
	const division = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonParam = url.searchParams.get('season');
	const systemParam = url.searchParams.get('system');
	const system: System = SYSTEMS.includes(systemParam as System) ? (systemParam as System) : 'elo';

	const { data: seasons } = await supabaseAdmin
		.from('seasons')
		.select('id, label, start_date')
		.order('start_date', { ascending: false });

	const seasonList = (seasons ?? []) as { id: number; label: string; start_date: string }[];

	// Resolve the requested season (or default to the most recent).
	const season = seasonParam
		? seasonList.find((s) => s.label === seasonParam)
		: seasonList[0];
	const seasonLabel = season?.label ?? seasonParam ?? '';

	if (!season) {
		return {
			ratings: [] as RatingStanding[],
			seasons: seasonList,
			sport,
			division,
			seasonLabel,
			system
		};
	}

	const [{ data: teamSeasons }, { data: ratingRows }] = await Promise.all([
		supabaseAdmin
			.from('team_seasons')
			.select(
				`
				id,
				team:teams ( id, ncaa_team_id, name, short_name, logo_url_dark, logo_url_light ),
				conference:conferences ( name, short_name )
			`
			)
			.eq('season_id', season.id)
			.eq('division', division)
			.eq('sport_code', sport)
			.eq('division_member', true),
		supabaseAdmin.rpc('get_current_ratings', {
			p_season_id: season.id,
			p_sport_code: sport,
			p_division: division,
			p_system: system
		})
	]);

	const byTs = new Map<number, { value: number; rank: number; games_played: number }>();
	for (const row of ratingRows ?? []) {
		byTs.set(Number(row.ts_id), {
			value: Number(row.value),
			rank: Number(row.rank),
			games_played: Number(row.games_played)
		});
	}

	const ratings: RatingStanding[] = (teamSeasons ?? [])
		.map((ts) => {
			const r = byTs.get(ts.id);
			return {
				id: ts.id,
				team: ts.team as unknown as RatingStanding['team'],
				conference: ts.conference as unknown as RatingStanding['conference'],
				value: r ? r.value : null,
				rank: r ? r.rank : null,
				games_played: r ? r.games_played : 0
			};
		})
		// Rated teams first (by rank), unrated teams last (alphabetical).
		.sort((a, b) => {
			if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
			if (a.rank !== null) return -1;
			if (b.rank !== null) return 1;
			return a.team.name.localeCompare(b.team.name);
		});

	return {
		ratings,
		seasons: seasonList,
		sport,
		division,
		seasonLabel,
		system
	};
};
