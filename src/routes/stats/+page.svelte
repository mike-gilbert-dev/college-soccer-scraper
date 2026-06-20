<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Dropdown, DropdownItem } from 'flowbite-svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import StatLeaders from '$lib/components/StatLeaders.svelte';
	import type { PageData } from './$types';
	import type { TeamStat, Leader } from './+page.server';
	import posthog from 'posthog-js';

	let { data }: { data: PageData } = $props();

	const teamStats        = $derived(data.teamStats as TeamStat[]);
	const leaderCategories = $derived(data.leaderCategories);
	const gender           = $derived(data.sport === 'WSO' ? 'W' : 'M');
	const division         = $derived(data.division);
	const seasonLabel      = $derived(data.seasonLabel);
	const seasons          = $derived(data.seasons);
	const conferences      = $derived(data.conferences as string[]);

	let selectedConf = $state('');

	onMount(() => {
		posthog.capture('stats_viewed', {
			sport: data.sport,
			division,
			season: seasonLabel
		});
	});

	// Reset conference filter when sport/season changes
	$effect(() => { data.sport; data.seasonLabel; selectedConf = ''; });

	// Tab: read from URL, default to 'players'
	const tab = $derived(page.url.searchParams.get('tab') ?? 'players');

	// ── Team sort: client-side (only ~350 rows, no dataset-size concern) ────
	type TeamKey = keyof TeamStat;
	let teamSortKey = $state<TeamKey>('wins');
	let teamSortAsc = $state(false);

	const sortedTeams = $derived(
		[...(selectedConf ? teamStats.filter(t => t.conference === selectedConf) : teamStats)]
			.sort((a, b) => {
				const av = a[teamSortKey] ?? -Infinity;
				const bv = b[teamSortKey] ?? -Infinity;
				const cmp = typeof av === 'string'
					? (av as string).localeCompare(bv as string)
					: (Number(bv) - Number(av));
				return teamSortAsc ? -cmp : cmp;
			})
	);

	function sortTeams(key: TeamKey) {
		if (teamSortKey === key) teamSortAsc = !teamSortAsc;
		else { teamSortKey = key; teamSortAsc = false; }
	}

	// ── URL navigation ───────────────────────────────────────────────────────
	function navigate(overrides: Record<string, string | number> = {}) {
		const sp = new URLSearchParams({
			sport:    data.sport,
			division: String(division),
			season:   seasonLabel,
			tab,
			...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)]))
		});
		goto(`?${sp}`);
	}

	const navigateSeason = (label: string) => navigate({ season: label });
	const setTab = (t: string) => navigate({ tab: t });
	const setGender = (g: string) => navigate({ sport: g === 'W' ? 'WSO' : 'MSO' });

	// ── Link helpers ─────────────────────────────────────────────────────────
	const leaderHref = (l: Leader) =>
		`/players/${l.ncaa_player_id}?sport=${data.sport}&division=${division}&season=${seasonLabel}`;
	const teamHref = (ncaaTeamId: string) =>
		`/teams/${ncaaTeamId}?sport=${data.sport}&division=${division}&season=${seasonLabel}`;

	function teamIndicator(thisKey: string) {
		if (teamSortKey !== thisKey) return '';
		return teamSortAsc ? ' ↑' : ' ↓';
	}

	const divisionLabel = $derived(division === 1 ? 'DI' : division === 2 ? 'DII' : 'DIII');
	const genderWord    = $derived(gender === 'W' ? 'Women' : 'Men');
	const genderLabel   = $derived(gender === 'W' ? "Women's" : "Men's");
	const subtitle      = $derived(`NCAA ${divisionLabel} · ${genderWord}`);

	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(`NCAA ${genderLabel} ${divisionLabel} Soccer Stats — ${seasonLabel} | CollegeSoccer.IO`);
	const pageDesc = $derived(`NCAA ${genderLabel.toLowerCase()} ${divisionLabel} college soccer individual and team stats for the ${seasonLabel} season. Goals, assists, saves leaders and sortable team standings.`);
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
	<aside class="w-full rounded border border-gray-200 bg-white md:w-44 md:shrink-0 dark:border-gray-700 dark:bg-gray-800">

		<!-- Mobile: compact horizontal strip -->
		<div class="flex flex-wrap items-center gap-2 p-2 md:hidden">
			<div class="flex gap-1">
				{#each [{ label: 'Men', value: 'M' }, { label: 'Women', value: 'W' }] as g}
					<button
						onclick={() => setGender(g.value)}
						class="rounded px-2 py-1 text-xs font-semibold transition-colors
							{gender === g.value ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}"
					>{g.label}</button>
				{/each}
			</div>
			<button
				id="mob-season-stats"
				class="flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
			>
				{seasonLabel} <span class="text-[10px] text-gray-400 dark:text-gray-500">▾</span>
			</button>
			<Dropdown triggeredBy="#mob-season-stats" placement="bottom-start" simple>
				{#each seasons as s}
					<DropdownItem onclick={() => navigateSeason(s.label)}>{s.label}</DropdownItem>
				{/each}
			</Dropdown>
		</div>

		<!-- Desktop: vertical sidebar -->
		<div class="hidden md:block">
			<div class="flex gap-1 border-b border-gray-200 p-2 dark:border-gray-700">
				{#each [{ label: 'Men', value: 'M' }, { label: 'Women', value: 'W' }] as g}
					<button
						onclick={() => setGender(g.value)}
						class="flex-1 rounded py-1 text-xs font-semibold transition-colors
							{gender === g.value ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}"
					>{g.label}</button>
				{/each}
			</div>
			<div class="border-b border-gray-200 px-2 py-2 dark:border-gray-700">
				<p class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Season</p>
				<select
					class="w-full rounded border border-gray-200 bg-transparent px-1.5 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300"
					value={seasonLabel}
					onchange={(e) => navigateSeason((e.target as HTMLSelectElement).value)}
				>
					{#each seasons as s}
						<option value={s.label}>{s.label}</option>
					{/each}
				</select>
			</div>
		</div>
	</aside>

	<!-- Main content -->
	<section class="min-w-0 flex-1 overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<!-- Tab nav -->
		<div class="flex items-center border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
			{#each [{ key: 'players', label: 'Individual Stats' }, { key: 'teams', label: 'Team Stats' }] as t}
				<button
					onclick={() => setTab(t.key)}
					class="border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors
						{tab === t.key
							? 'border-primary-500 text-primary-600 dark:text-primary-400'
							: 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
				>{t.label}</button>
			{/each}

			<div class="ml-auto flex items-center gap-2 pr-3">
				{#if tab === 'players'}
					<span class="hidden text-[10px] text-gray-400 sm:inline dark:text-gray-500">Tap a name to compare their season pace</span>
				{:else}
					{#if conferences.length > 0}
						<select
							class="rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
							value={selectedConf}
							onchange={(e) => (selectedConf = (e.target as HTMLSelectElement).value)}
						>
							<option value="">All conferences</option>
							{#each conferences as c}
								<option value={c}>{c}</option>
							{/each}
						</select>
					{/if}
					<span class="text-[10px] text-gray-400 dark:text-gray-500">{sortedTeams.length} teams</span>
				{/if}
			</div>
		</div>

		<!-- ── INDIVIDUAL STATS TAB ──────────────────────────────────────────── -->
		{#if tab === 'players'}
			{#if leaderCategories.length === 0}
				<p class="py-12 text-center text-sm text-gray-400">No player stats available for this selection.</p>
			{:else}
				<div
					class="bg-gray-50 p-3.5 dark:bg-gray-900"
					style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;align-items:start"
				>
					{#each leaderCategories as cat (cat.key)}
						<StatLeaders
							category={cat.category}
							unit={cat.unit}
							{subtitle}
							n={cat.n}
							average={cat.average}
							leaders={cat.leaders}
							href={leaderHref}
						/>
					{/each}
				</div>
			{/if}

		<!-- ── TEAM STATS TAB ────────────────────────────────────────────────── -->
		{:else if tab === 'teams'}
			{#if sortedTeams.length === 0}
				<p class="py-12 text-center text-sm text-gray-400">No team stats available for this selection.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead>
							<tr class="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
								<th class="w-6 px-3 py-2 text-left font-semibold">#</th>
								<th class="px-3 py-2 text-left font-semibold">
									<button onclick={() => sortTeams('team_name')} class="hover:text-gray-800 dark:hover:text-gray-200">Team{teamIndicator('team_name')}</button>
								</th>
								<th class="px-3 py-2 text-left font-semibold">
									<button onclick={() => sortTeams('conference')} class="hover:text-gray-800 dark:hover:text-gray-200">Conf{teamIndicator('conference')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('gp')} class="hover:text-gray-800 dark:hover:text-gray-200">GP{teamIndicator('gp')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('wins')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'wins' ? 'text-primary-600 dark:text-primary-400' : ''}">W{teamIndicator('wins')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('losses')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'losses' ? 'text-primary-600 dark:text-primary-400' : ''}">L{teamIndicator('losses')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('draws')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'draws' ? 'text-primary-600 dark:text-primary-400' : ''}">T{teamIndicator('draws')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('gf')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'gf' ? 'text-primary-600 dark:text-primary-400' : ''}">GF{teamIndicator('gf')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('ga')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'ga' ? 'text-primary-600 dark:text-primary-400' : ''}">GA{teamIndicator('ga')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('gd')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'gd' ? 'text-primary-600 dark:text-primary-400' : ''}">GD{teamIndicator('gd')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('shots')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'shots' ? 'text-primary-600 dark:text-primary-400' : ''}">Sh{teamIndicator('shots')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('shots_on_goal')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'shots_on_goal' ? 'text-primary-600 dark:text-primary-400' : ''}">SOG{teamIndicator('shots_on_goal')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('fouls')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'fouls' ? 'text-primary-600 dark:text-primary-400' : ''}">F{teamIndicator('fouls')}</button>
								</th>
								<th class="px-2 py-2 text-center font-semibold">
									<button onclick={() => sortTeams('yellow_cards')} class="hover:text-gray-800 dark:hover:text-gray-200 {teamSortKey === 'yellow_cards' ? 'text-primary-600 dark:text-primary-400' : ''}">YC{teamIndicator('yellow_cards')}</button>
								</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedTeams as t, i}
								<tr class="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50 dark:border-gray-700/60 dark:hover:bg-gray-700/30">
									<td class="px-3 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{i + 1}</td>
									<td class="px-3 py-1.5">
										<a href={teamHref(t.ncaa_team_id)} class="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 hover:underline dark:text-gray-400 dark:hover:text-white">
											<span class="flex h-4 w-4 shrink-0 items-center justify-center">
												<TeamLogo lightUrl={t.logo_url_light} darkUrl={t.logo_url_dark} name={t.team_name} size={16} />
											</span>
											{t.team_name}
										</a>
									</td>
									<td class="px-3 py-1.5 text-gray-500 dark:text-gray-400">{t.conference || '—'}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.gp}</td>
									<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{t.wins}</td>
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
