// Individual stat categories shown on /stats and paged through on
// /stats/[category]. `key` matches player_season_stat_leaders.category_key and
// the player_season_stats view column of the same name.
export const STAT_CATEGORIES: { key: string; category: string; unit: string }[] = [
	{ key: 'goals',         category: 'Goals',         unit: 'goals' },
	{ key: 'assists',       category: 'Assists',       unit: 'assists' },
	{ key: 'points',        category: 'Points',        unit: 'points' },
	{ key: 'shots_on_goal', category: 'Shots on Goal', unit: 'SOG' },
	{ key: 'gk_saves',      category: 'Saves',         unit: 'saves' },
	{ key: 'gk_shutouts',   category: 'Shutouts',      unit: 'shutouts' }
];
