import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { STAT_CATEGORIES } from '$lib/stat-categories';

const PAGE_SIZE = 50;

const headshotUrl = (path: string | null | undefined): string | null =>
	path ? `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/player-headshots/${path}` : null;

export type RankedPlayer = {
	/** Competition rank: players tied on value share the rank of the first of them. */
	rank: number;
	tied: boolean;
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
};

// Reads the full per-category ranking precomputed into player_season_stat_leaders
// by refresh_player_stat_leaders() -- never the player_season_stats view across
// the whole league, which is what used to time out /stats. The view is only hit
// for the one page of players being shown (a primary-key IN list).
export const load: PageServerLoad = async ({ params, url }) => {
	const def = STAT_CATEGORIES.find(c => c.key === params.category);
	if (!def) error(404, 'Unknown stat category');

	const sport       = url.searchParams.get('sport')    ?? 'MSO';
	const division    = parseInt(url.searchParams.get('division') ?? '1', 10);
	const seasonParam = url.searchParams.get('season');
	const pageNum     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1);

	const seasonBase = supabaseAdmin.from('seasons').select('id, label');
	const { data: season } = await (seasonParam
		? seasonBase.eq('label', seasonParam).single()
		: seasonBase.order('start_date', { ascending: false }).limit(1).single());

	const base = {
		key: def.key, category: def.category, unit: def.unit,
		sport, division, seasonLabel: season?.label ?? seasonParam ?? '',
		page: pageNum, pageSize: PAGE_SIZE
	};
	if (!season) return { ...base, total: 0, players: [] as RankedPlayer[] };

	const scoped = () => supabaseAdmin
		.from('player_season_stat_leaders')
		.select('rank, player_season_id, value', { count: 'exact' })
		.eq('season_id', season.id)
		.eq('sport_code', sport)
		.eq('division', division)
		.eq('category_key', def.key);

	const from = (pageNum - 1) * PAGE_SIZE;
	const { data: rows, count } = await scoped()
		.order('rank', { ascending: true })
		.range(from, from + PAGE_SIZE - 1);

	const total = count ?? 0;
	if (!rows?.length) return { ...base, total, players: [] as RankedPlayer[] };

	const psIds = rows.map(r => Number(r.player_season_id));

	const { data: infoRows } = await supabaseAdmin
		.from('player_season_stats')
		.select('player_season_id, ncaa_player_id, player_name, team_season_id, position, games_played, headshot_path')
		.in('player_season_id', psIds);
	const infoByPs = new Map((infoRows ?? []).map(p => [Number(p.player_season_id), p]));

	const teamSeasonIds = [...new Set((infoRows ?? []).map(p => Number(p.team_season_id)))];
	const { data: teamRows } = teamSeasonIds.length
		? await supabaseAdmin
			.from('team_seasons')
			.select('id, team:teams ( ncaa_team_id, name, logo_url_light, logo_url_dark )')
			.in('id', teamSeasonIds)
		: { data: [] };
	type Team = { ncaa_team_id: string; name: string; logo_url_light: string | null; logo_url_dark: string | null };
	const teamByTs = new Map((teamRows ?? []).map(t => [Number(t.id), t.team as unknown as Team | null]));

	// Ties: the stored rank is a unique row_number, so derive the shared rank.
	// Within the page a tie just repeats the previous rank; for the page's first
	// row it's 1 + how many players have a strictly higher value.
	const firstValue = Number(rows[0].value);
	const { count: aheadCount } = await scoped()
		.gt('value', firstValue)
		.limit(0);
	const firstRank = (aheadCount ?? 0) + 1;

	// A row is "tied" if its neighbour on either side has the same value; the
	// page edges also need to know about the rows just off-page.
	const { data: nextRow } = await scoped()
		.order('rank', { ascending: true })
		.range(from + rows.length, from + rows.length);
	const valueAt = (i: number): number | undefined =>
		i < 0 ? (firstRank <= from ? firstValue : undefined)
		: i < rows.length ? Number(rows[i].value)
		: nextRow?.[0] != null ? Number(nextRow[0].value) : undefined;

	let rank = firstRank;
	const players: RankedPlayer[] = rows.map((r, i) => {
		const value = Number(r.value);
		if (i > 0 && value !== Number(rows[i - 1].value)) rank = from + i + 1;
		const info = infoByPs.get(Number(r.player_season_id));
		const tm = info ? teamByTs.get(Number(info.team_season_id)) : null;
		return {
			rank,
			tied: valueAt(i - 1) === value || valueAt(i + 1) === value,
			ncaa_player_id: String(info?.ncaa_player_id ?? ''),
			name:           String(info?.player_name ?? ''),
			team:           tm?.name ?? '',
			team_ncaa_id:   tm?.ncaa_team_id ?? '',
			pos:            (info?.position as string | null) ?? null,
			gp:             Number(info?.games_played ?? 0),
			value,
			logo_url_light: tm?.logo_url_light ?? null,
			logo_url_dark:  tm?.logo_url_dark ?? null,
			headshot_url:   headshotUrl(info?.headshot_path as string | null)
		};
	});

	return { ...base, total, players };
};
