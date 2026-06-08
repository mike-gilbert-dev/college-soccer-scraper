<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import type { PlayerStat, TeamStat } from './+page.server';

	let { data }: { data: PageData } = $props();

	const playerStats = $derived(data.playerStats as PlayerStat[]);
	const teamStats   = $derived(data.teamStats   as TeamStat[]);
	const gender      = $derived(data.sport === 'WSO' ? 'W' : 'M');
	const division    = $derived(data.division);
	const seasonYear  = $derived(data.seasonYear);

	// Tab: read from URL, default to 'players'
	const tab = $derived(page.url.searchParams.get('tab') ?? 'players');

	// ── Player sort: driven by URL params → server re-fetches sorted data ───
	const playerSortKey = $derived(data.sortBy as string);
	const playerSortDir = $derived(data.sortDir as string);

	// ── Team sort: client-side (only ~350 rows, no dataset-size concern) ────
	type TeamKey = keyof TeamStat;
	let teamSortKey = $state<TeamKey>('wins');
	let teamSortAsc = $state(false);

	const sortedTeams = $derived(
		[...teamStats].sort((a, b) => {
			const av = a[teamSortKey] ?? -Infinity;
			const bv = b[teamSortKey] ?? -Infinity;
			const cmp = typeof av === 'string'
				? (av as string).localeCompare(bv as string)
				: (Number(bv) - Number(av));
			return teamSortAsc ? -cmp : cmp;
		})
	);

	// ── Sort handlers ────────────────────────────────────────────────────────
	function sortPlayers(key: string) {
		// Same column → flip direction; new column → default desc
		const newDir = key === playerSortKey && playerSortDir === 'desc' ? 'asc' : 'desc';
		navigate({ sortBy: key, sortDir: newDir });
	}

	function sortTeams(key: TeamKey) {
		if (teamSortKey === key) teamSortAsc = !teamSortAsc;
		else { teamSortKey = key; teamSortAsc = false; }
	}

	// ── URL navigation ───────────────────────────────────────────────────────
	function navigate(overrides: Record<string, string | number> = {}) {
		const sp = new URLSearchParams({
			sport:    data.sport,
			division: String(division),
			season:   String(seasonYear),
			tab,
			sortBy:   playerSortKey,
			sortDir:  playerSortDir,
			...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)]))
		});
		goto(`?${sp}`);
	}

	function setTab(t: string) {
		navigate({ tab: t });
	}

	function setGender(g: string) {
		navigate({ sport: g === 'W' ? 'WSO' : 'MSO' });
	}

	// ── Link helpers ─────────────────────────────────────────────────────────
	function playerHref(p: PlayerStat) {
		return `/players/${p.ncaa_player_id}?sport=${data.sport}&division=${division}&season=${seasonYear}`;
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${data.sport}&division=${division}&season=${seasonYear}`;
	}

	// ── Sort indicators ──────────────────────────────────────────────────────
	// Player sort uses direction string from server; team sort uses boolean.
	function playerIndicator(thisKey: string) {
		if (playerSortKey !== thisKey) return '';
		return playerSortDir === 'asc' ? ' ↑' : ' ↓';
	}

	function teamIndicator(thisKey: string) {
		if (teamSortKey !== thisKey) return '';
		return teamSortAsc ? ' ↑' : ' ↓';
	}

	const divisions = [
		{ label: 'Division I',   value: 1 },
		{ label: 'Division II',  value: 2 },
		{ label: 'Division III', value: 3 },
	];

	const seasons = [2025, 2024];
	const divisionLabel = $derived(division === 1 ? 'DI' : division === 2 ? 'DII' : 'DIII');
	const genderLabel = $derived(gender === 'W' ? "Women's" : "Men's");
	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(`NCAA ${genderLabel} ${divisionLabel} Soccer Stats — ${seasonYear} | CollegeSoccer.IO`);
	const pageDesc = $derived(`NCAA ${genderLabel.toLowerCase()} ${divisionLabel} college soccer individual and team stats for the ${seasonYear} season. Sortable goals, assists, and more.`);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDesc} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={canonicalUrl} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDesc} />
</svelte:head>

<div class="flex flex-col gap-2 md:flex-row md:items-start">

	<!-- Navigation controls -->
	<aside class="w-full md:w-44 md:shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">

		<!-- Mobile: compact horizontal strip -->
		<div class="flex items-center gap-2 flex-wrap p-2 md:hidden">
			<!-- Gender -->
			<div class="flex gap-1">
				{#each [{ label: 'Men', value: 'M' }, { label: 'Women', value: 'W' }] as g}
					<button
						onclick={() => setGender(g.value)}
						class="px-2 py-1 text-xs rounded font-semibold transition-colors
							{gender === g.value
								? 'bg-primary-500 text-white'
								: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>{g.label}</button>
				{/each}
			</div>
			<!-- Season -->
			<select
				class="text-xs bg-transparent text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1"
				value={seasonYear}
				onchange={(e) => navigate({ season: parseInt((e.target as HTMLSelectElement).value) })}
			>
				{#each seasons as y}
					<option value={y}>{y}</option>
				{/each}
			</select>
			<!-- Division -->
			<div class="flex gap-1 ml-auto">
				{#each divisions as d}
					<button
						onclick={() => navigate({ division: d.value })}
						class="px-2 py-1 text-xs rounded font-semibold transition-colors
							{division === d.value
								? 'bg-primary-500 text-white'
								: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>D{d.value}</button>
				{/each}
			</div>
		</div>

		<!-- Desktop: vertical sidebar -->
		<div class="hidden md:block">
			<!-- Gender -->
			<div class="border-b border-gray-200 dark:border-gray-700 p-2 flex gap-1">
				{#each [{ label: 'Men', value: 'M' }, { label: 'Women', value: 'W' }] as g}
					<button
						onclick={() => setGender(g.value)}
						class="flex-1 text-xs py-1 rounded font-semibold transition-colors
							{gender === g.value
								? 'bg-primary-500 text-white'
								: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>
						{g.label}
					</button>
				{/each}
			</div>

			<!-- Season -->
			<div class="border-b border-gray-200 dark:border-gray-700 px-2 py-2">
				<p class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Season</p>
				<select
					class="w-full text-xs bg-transparent text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1"
					value={seasonYear}
					onchange={(e) => navigate({ season: parseInt((e.target as HTMLSelectElement).value) })}
				>
					{#each seasons as y}
						<option value={y}>{y}</option>
					{/each}
				</select>
			</div>

			<!-- Division -->
			<div>
				<p class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Division
				</p>
				{#each divisions as d}
					<button
						onclick={() => navigate({ division: d.value })}
						class="w-full flex items-center px-3 py-1.5 text-xs border-l-2 transition-colors
							{division === d.value
								? 'border-primary-500 text-primary-600 dark:text-primary-400 font-semibold bg-primary-50 dark:bg-primary-900/20'
								: 'border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'}"
					>
						{d.label}
					</button>
				{/each}
			</div>
		</div>
	</aside>

	<!-- Main content -->
	<section class="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
		<!-- Tab nav -->
		<div class="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
			{#each [{ key: 'players', label: 'Individual Stats' }, { key: 'teams', label: 'Team Stats' }] as t}
				<button
					onclick={() => setTab(t.key)}
					class="px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors
						{tab === t.key
							? 'border-primary-500 text-primary-600 dark:text-primary-400'
							: 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
				>
					{t.label}
				</button>
			{/each}

			<!-- Player count badge -->
			<span class="ml-auto self-center pr-3 text-[10px] text-gray-400 dark:text-gray-500">
				{tab === 'players' ? `${playerStats.length} players` : `${sortedTeams.length} teams`}
			</span>
		</div>

		<!-- ── PLAYERS TAB ─────────────────────────────────────────────────── -->
		{#if tab === 'players'}
			{#if playerStats.length === 0}
				<p class="py-12 text-center text-sm text-gray-400">No player stats available for this selection.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead>
							<tr class="bg-gray-50 dark:bg-gray-900 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
								<th class="px-3 py-2 text-left w-6 font-semibold">#</th>
								<th class="px-3 py-2 text-left font-semibold">
									<button onclick={() => sortPlayers('player_name')} class="hover:text-gray-800 dark:hover:text-gray-200">
										Player{playerIndicator('player_name')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">Pos</th>
								<th class="px-3 py-2 text-left font-semibold">
									<button onclick={() => sortPlayers('team_name')} class="hover:text-gray-800 dark:hover:text-gray-200">
										Team{playerIndicator('team_name')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('games_played')} class="hover:text-gray-800 dark:hover:text-gray-200">
										GP{playerIndicator('games_played')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('goals')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'goals' ? 'text-primary-600 dark:text-primary-400' : ''}">
										G{playerIndicator('goals')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('assists')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'assists' ? 'text-primary-600 dark:text-primary-400' : ''}">
										A{playerIndicator('assists')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('points')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'points' ? 'text-primary-600 dark:text-primary-400' : ''}">
										Pts{playerIndicator('points')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('shots')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'shots' ? 'text-primary-600 dark:text-primary-400' : ''}">
										Sh{playerIndicator('shots')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('shots_on_goal')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'shots_on_goal' ? 'text-primary-600 dark:text-primary-400' : ''}">
										SOG{playerIndicator('shots_on_goal')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('fouls')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'fouls' ? 'text-primary-600 dark:text-primary-400' : ''}">
										F{playerIndicator('fouls')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('yellow_cards')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'yellow_cards' ? 'text-primary-600 dark:text-primary-400' : ''}">
										YC{playerIndicator('yellow_cards')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('gk_saves')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'gk_saves' ? 'text-primary-600 dark:text-primary-400' : ''}">
										SV{playerIndicator('gk_saves')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortPlayers('gk_shutouts')} class="hover:text-gray-800 dark:hover:text-gray-200 {playerSortKey === 'gk_shutouts' ? 'text-primary-600 dark:text-primary-400' : ''}">
										SO{playerIndicator('gk_shutouts')}
									</button>
								</th>
							</tr>
						</thead>
						<tbody>
							{#each playerStats as p, i}
								<tr class="border-b border-gray-100 dark:border-gray-700/60 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
									<td class="px-3 py-1.5 text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</td>
									<td class="px-3 py-1.5">
										<a href={playerHref(p)} class="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 hover:underline">
											{p.player_name}
										</a>
									</td>
									<td class="px-2 py-1.5 text-center text-gray-500 dark:text-gray-400">{p.position ?? '—'}</td>
									<td class="px-3 py-1.5">
										<a href={teamHref(p.team_ncaa_id)} class="text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline truncate block max-w-35">
											{p.team_name}
										</a>
									</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.games_played}</td>
									<td class="px-2 py-1.5 text-center tabular-nums font-semibold {p.goals > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-600'}">{p.goals}</td>
									<td class="px-2 py-1.5 text-center tabular-nums {p.assists > 0 ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-600'}">{p.assists}</td>
									<td class="px-2 py-1.5 text-center tabular-nums {p.points > 0 ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-600'}">{p.points}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.shots}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.shots_on_goal}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.fouls}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.yellow_cards > 0 ? p.yellow_cards : '—'}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.gk_saves != null ? p.gk_saves : '—'}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.gk_shutouts > 0 ? p.gk_shutouts : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

		<!-- ── TEAMS TAB ───────────────────────────────────────────────────── -->
		{:else if tab === 'teams'}
			{#if sortedTeams.length === 0}
				<p class="py-12 text-center text-sm text-gray-400">No team stats available for this selection.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead>
							<tr class="bg-gray-50 dark:bg-gray-900 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
								<th class="px-3 py-2 text-left w-6 font-semibold">#</th>
								<th class="px-3 py-2 text-left font-semibold">
									<button onclick={() => sortTeams('team_name')} class="hover:text-gray-800 dark:hover:text-gray-200">
										Team{teamIndicator('team_name')}
									</button>
								</th>
								<th class="px-3 py-2 text-left font-semibold">
									<button onclick={() => sortTeams('conference')} class="hover:text-gray-800 dark:hover:text-gray-200">
										Conf{teamIndicator('conference')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('gp')} class="hover:text-gray-800 dark:hover:text-gray-200">
										GP{teamIndicator('gp')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('wins')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'wins' ? 'text-primary-600 dark:text-primary-400' : ''}">
										W{teamIndicator('wins')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('losses')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'losses' ? 'text-primary-600 dark:text-primary-400' : ''}">
										L{teamIndicator('losses')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('draws')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'draws' ? 'text-primary-600 dark:text-primary-400' : ''}">
										T{teamIndicator('draws')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('gf')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'gf' ? 'text-primary-600 dark:text-primary-400' : ''}">
										GF{teamIndicator('gf')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('ga')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'ga' ? 'text-primary-600 dark:text-primary-400' : ''}">
										GA{teamIndicator('ga')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('gd')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'gd' ? 'text-primary-600 dark:text-primary-400' : ''}">
										GD{teamIndicator('gd')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('shots')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'shots' ? 'text-primary-600 dark:text-primary-400' : ''}">
										Sh{teamIndicator('shots')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('shots_on_goal')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'shots_on_goal' ? 'text-primary-600 dark:text-primary-400' : ''}">
										SOG{teamIndicator('shots_on_goal')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('fouls')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'fouls' ? 'text-primary-600 dark:text-primary-400' : ''}">
										F{teamIndicator('fouls')}
									</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('yellow_cards')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'yellow_cards' ? 'text-primary-600 dark:text-primary-400' : ''}">
										YC{teamIndicator('yellow_cards')}
									</button>
								</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedTeams as t, i}
								<tr class="border-b border-gray-100 dark:border-gray-700/60 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
									<td class="px-3 py-1.5 text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</td>
									<td class="px-3 py-1.5">
										<a href={teamHref(t.ncaa_team_id)} class="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 hover:underline">
											{t.team_name}
										</a>
									</td>
									<td class="px-3 py-1.5 text-gray-500 dark:text-gray-400">{t.conference || '—'}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.gp}</td>
									<td class="px-2 py-1.5 text-center tabular-nums font-semibold text-gray-900 dark:text-white">{t.wins}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.losses}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.draws}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.gf}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.ga}</td>
									<td class="px-2 py-1.5 text-center tabular-nums font-medium
										{t.gd > 0 ? 'text-green-600 dark:text-green-400' : t.gd < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}">
										{t.gd > 0 ? '+' : ''}{t.gd}
									</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.shots}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.shots_on_goal}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.fouls}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.yellow_cards > 0 ? t.yellow_cards : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</section>
</div>
