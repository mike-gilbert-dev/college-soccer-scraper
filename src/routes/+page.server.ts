import type { PageServerLoad } from './$types';

// NCAA soccer seasons run roughly August through mid-December.
// Used as fallback bounds when the seasons table can't be reached.
function seasonBounds(year: number) {
	return { start: `${year}-08-01`, end: `${year}-12-15` };
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const supabase = locals.supabase;

	const today      = new Date().toISOString().slice(0, 10);
	const gender     = url.searchParams.get('gender') ?? 'M';
	const division   = parseInt(url.searchParams.get('division') ?? '1');
	const seasonYear = parseInt(url.searchParams.get('season') ?? '2025');
	const sportCode  = gender === 'W' ? 'WSO' : 'MSO';

	const bounds = seasonBounds(seasonYear);

	// Determine the best default date for this season.
	// Falls back to hardcoded bounds so the calendar always shows the right year
	// even if the seasons table isn't reachable.
	function defaultDate(startDate: string, endDate: string): string {
		const rawDate = url.searchParams.get('date');
		if (rawDate && rawDate >= startDate && rawDate <= endDate) return rawDate;
		// Clamp: past season → last day, current → today, future → first day
		if (today > endDate)   return endDate;
		if (today < startDate) return startDate;
		return today;
	}

	const { data: season } = await supabase
		.from('seasons')
		.select('id, start_date, end_date')
		.eq('year', seasonYear)
		.single();

	const startDate = season?.start_date ?? bounds.start;
	const endDate   = season?.end_date   ?? bounds.end;
	const contestDate = defaultDate(startDate, endDate);

	if (!season) {
		return {
			games: [],
			contestDate,
			gender,
			division,
			seasonYear,
			seasonStartDate: startDate,
			seasonEndDate:   endDate
		};
	}

	const { data: games, error: gamesError } = await supabase
		.from('games')
		.select(`
			id,
			ncaa_contest_id,
			contest_date,
			start_time,
			home_score,
			away_score,
			status,
			neutral_site,
			broadcaster_name,
			round_description,
			home_team_season:team_seasons!home_team_season_id(
				team:teams(name, short_name, ncaa_team_id),
				conference:conferences(name, short_name)
			),
			away_team_season:team_seasons!away_team_season_id(
				team:teams(name, short_name, ncaa_team_id),
				conference:conferences(name, short_name)
			)
		`)
		.eq('contest_date', contestDate)
		.eq('sport_code', sportCode)
		.eq('division', division)
		.eq('season_id', season.id)
		.order('start_time', { ascending: true, nullsFirst: false });

	if (gamesError) console.error('[scoreboard] games query error:', gamesError);

	return {
		games: games ?? [],
		gamesError: gamesError ? `${gamesError.code}: ${gamesError.message}` : null,
		contestDate,
		gender,
		division,
		seasonYear,
		seasonStartDate: startDate,
		seasonEndDate:   endDate
	};
};
