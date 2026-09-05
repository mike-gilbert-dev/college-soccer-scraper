import type { PageServerLoad } from './$types';
import { todayInTimeZone } from '$lib/server/date';

/** One watch link for a game, as the scoreboard renders it. */
export interface StreamLink {
	url: string | null;
	carrier: string | null;
	access: 'free' | 'subscription' | 'tv_authenticated' | 'unknown';
	label: string | null;
	is_deep_link: boolean;
	source_side: 'home' | 'away';
}

// NCAA soccer seasons run roughly August through mid-December.
// Used as fallback bounds when the seasons table can't be reached.
function seasonBounds(year: number) {
	return { start: `${year}-08-01`, end: `${year}-12-15` };
}

export const load: PageServerLoad = async ({ url, locals, cookies }) => {
	const supabase = locals.supabase;

	// Falls back to Eastern (where games are scheduled) until the client tells
	// us the visitor's own timezone via the `tz` cookie (see +layout.svelte).
	const today       = todayInTimeZone(cookies.get('tz'));
	const gender      = url.searchParams.get('gender') ?? 'M';
	const division    = parseInt(url.searchParams.get('division') ?? '1');
	const seasonParam = url.searchParams.get('season');
	const sportCode   = gender === 'W' ? 'WSO' : 'MSO';

	// Determine the best default date for this season.
	function defaultDate(startDate: string, endDate: string): string {
		const rawDate = url.searchParams.get('date');
		if (rawDate && rawDate >= startDate && rawDate <= endDate) return rawDate;
		if (today > endDate)   return endDate;
		if (today < startDate) return startDate;
		return today;
	}

	const seasonBase = supabase.from('seasons').select('id, label, start_date, end_date');
	const { data: season } = await (seasonParam
		? seasonBase.eq('label', seasonParam).single()
		: seasonBase.order('start_date', { ascending: false }).limit(1).single());

	const seasonLabel = season?.label ?? seasonParam ?? '';

	const bounds    = seasonBounds(parseInt(seasonLabel) || 2025);
	const startDate = season?.start_date ?? bounds.start;
	const endDate   = season?.end_date   ?? bounds.end;

	if (!season) {
		const contestDate = defaultDate(startDate, endDate);
		return {
			games: [],
			userPicks: {} as Record<number, { outcome: string; result: string | null }>,
			contestDate,
			availableDates: [] as string[],
			gender,
			division,
			seasonLabel,
			seasonStartDate: startDate,
			seasonEndDate:   endDate
		};
	}

	// Fetch available dates first so we can use the actual first/last game date
	// as bounds instead of the season's start/end dates. This ensures switching
	// between sports lands on a date that has real games for that sport.
	const { data: gameDatesRaw } = await supabase.rpc('get_game_dates', {
		p_season_id:  season.id,
		p_sport_code: sportCode,
		p_division:   division
	});

	const availableDates = (gameDatesRaw ?? []).map((r: { contest_date: string }) => r.contest_date);
	const firstGameDate  = availableDates[0]                       ?? startDate;
	const lastGameDate   = availableDates[availableDates.length - 1] ?? endDate;
	const contestDate    = defaultDate(firstGameDate, lastGameDate);

	const { data: games, error: gamesError } = await supabase
		.from('games')
		.select(`
			id,
			ncaa_contest_id,
			contest_date,
			start_time,
			home_score,
			away_score,
			shootout,
			shootout_winner_team_season_id,
			home_team_season_id,
			away_team_season_id,
			status,
			neutral_site,
			broadcaster_name,
			round_description,
			current_period,
			home_team_season:team_seasons!home_team_season_id(
				team:teams(name, short_name, ncaa_team_id, logo_url_dark, logo_url_light),
				conference:conferences(name, short_name)
			),
			away_team_season:team_seasons!away_team_season_id(
				team:teams(name, short_name, ncaa_team_id, logo_url_dark, logo_url_light),
				conference:conferences(name, short_name)
			)
		`)
		.eq('contest_date', contestDate)
		.eq('sport_code', sportCode)
		.eq('division', division)
		.eq('season_id', season.id)
		.order('start_time', { ascending: true, nullsFirst: false });

	if (gamesError) console.error('[scoreboard] games query error:', gamesError);

	// Watch links. Deliberately queries game_streams directly rather than the
	// game_primary_stream view: DISTINCT ON over the whole table can be
	// materialized before a game_id filter is applied, turning a scoreboard
	// render into a full scan. This is the same shape the pick'em query below
	// uses — one indexed lookup over the <=100 games already on screen.
	const streams: Record<number, StreamLink> = {};

	if (games && games.length > 0) {
		const { data: rows, error: streamsError } = await supabase
			.from('game_streams')
			.select('game_id, url, carrier, access, label, is_deep_link, source_side')
			.eq('kind', 'video')
			.in('game_id', games.map((g) => g.id));

		if (streamsError) {
			console.error('[scoreboard] streams query error:', streamsError);
		} else {
			// Same preference order as the game_primary_stream view: a link to THIS
			// game beats a landing page, free beats a subscription beats a cable
			// login, and the home school beats the away school.
			const accessRank = (a: string) =>
				({ free: 0, subscription: 1, unknown: 2, tv_authenticated: 3 })[a] ?? 2;

			for (const r of rows ?? []) {
				const next = r as StreamLink & { game_id: number };
				const cur = streams[next.game_id];
				if (
					!cur ||
					Number(next.is_deep_link) > Number(cur.is_deep_link) ||
					(next.is_deep_link === cur.is_deep_link &&
						(accessRank(next.access) < accessRank(cur.access) ||
							(accessRank(next.access) === accessRank(cur.access) &&
								next.source_side === 'home' &&
								cur.source_side !== 'home')))
				) {
					streams[next.game_id] = next;
				}
			}
		}
	}

	// Pick'em: load this user's picks for the games on screen. Skipped entirely
	// for anonymous visitors. RLS already scopes picks to the caller, but the
	// explicit user_id filter keeps the query on picks_user_season_idx.
	const { user } = await locals.safeGetSession();
	const userPicks: Record<number, { outcome: string; result: string | null }> = {};

	if (user && games && games.length > 0) {
		const { data: picks, error: picksError } = await supabase
			.from('picks')
			.select('game_id, outcome, result')
			.eq('user_id', user.id)
			.in('game_id', games.map((g) => g.id));

		if (picksError) {
			console.error('[scoreboard] picks query error:', picksError);
		} else {
			for (const p of picks ?? []) {
				userPicks[p.game_id] = { outcome: p.outcome, result: p.result };
			}
		}
	}

	return {
		games: games ?? [],
		userPicks,
		streams,
		gamesError: gamesError ? `${gamesError.code}: ${gamesError.message}` : null,
		contestDate,
		availableDates,
		gender,
		division,
		seasonLabel,
		seasonStartDate: startDate,
		seasonEndDate:   endDate
	};
};
