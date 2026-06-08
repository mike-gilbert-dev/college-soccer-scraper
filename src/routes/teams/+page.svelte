<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell, Dropdown, DropdownItem } from 'flowbite-svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sport        = $derived(data.sport);
	const division     = $derived(data.division);
	const seasonLabel  = $derived(data.seasonLabel);
	const seasons      = $derived(data.seasons);
	const teams        = $derived(data.teams);
	const conferences  = $derived(data.conferences);

	let selectedConf = $state('');

	// Reset conference filter when the teams list changes (sport/division/season change)
	$effect(() => {
		teams; // reactive dependency
		selectedConf = '';
	});

	const visibleTeams = $derived(
		selectedConf ? teams.filter(t => t.conference?.name === selectedConf) : teams
	);


	function navigate(overrides: Record<string, string | number> = {}) {
		const sp = new URLSearchParams({
			sport:    sport,
			division: String(division),
			season:   seasonLabel,
			...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)]))
		});
		goto(`/teams?${sp}`);
	}

	function navigateSeason(label: string) {
		navigate({ season: label });
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${sport}&division=${division}&season=${seasonLabel}`;
	}

	function sign(n: number) {
		if (n > 0) return `+${n}`;
		if (n < 0) return `${n}`;
		return '0';
	}
	const divisionLabel = $derived(division === 1 ? 'DI' : division === 2 ? 'DII' : 'DIII');
	const genderLabel = $derived(sport === 'WSO' ? "Women's" : "Men's");
	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(`NCAA ${genderLabel} ${divisionLabel} Soccer Teams — ${seasonLabel} | CollegeSoccer.IO`);
	const pageDesc = $derived(`NCAA ${genderLabel.toLowerCase()} ${divisionLabel} college soccer team standings and records for the ${seasonLabel} season.`);
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
				{#each [{ label: 'Men', value: 'MSO' }, { label: 'Women', value: 'WSO' }] as g}
					<button
						onclick={() => navigate({ sport: g.value })}
						class="px-2 py-1 text-xs rounded font-semibold transition-colors
							{sport === g.value
								? 'bg-primary-500 text-white'
								: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>{g.label}</button>
				{/each}
			</div>
			<!-- Season -->
			<button
				id="mob-season-teams"
				class="text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 rounded px-1.5 py-1 flex items-center gap-1"
			>
				{seasonLabel} <span class="text-gray-400 dark:text-gray-500 text-[10px]">▾</span>
			</button>
			<Dropdown triggeredBy="#mob-season-teams" placement="bottom-start" simple>
				{#each seasons as s}
					<DropdownItem onclick={() => navigateSeason(s.label)}>{s.label}</DropdownItem>
				{/each}
			</Dropdown>
		</div>

		<!-- Desktop: vertical sidebar -->
		<div class="hidden md:block">
			<!-- Gender toggle -->
			<div class="border-b border-gray-200 dark:border-gray-700 p-2 flex gap-1">
				{#each [{ label: 'Men', value: 'MSO' }, { label: 'Women', value: 'WSO' }] as g}
					<button
						onclick={() => navigate({ sport: g.value })}
						class="flex-1 text-xs py-1 rounded font-semibold transition-colors
							{sport === g.value
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

	<!-- Standings panel -->
	<section class="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
		<!-- Panel header -->
		<div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
			<h1 class="text-sm font-semibold text-gray-700 dark:text-gray-200 shrink-0">
				{sport === 'WSO' ? "Women's" : "Men's"} Division {division} — {seasonLabel}
			</h1>
			{#if conferences.length > 0}
				<select
					class="text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 max-w-45 truncate"
					value={selectedConf}
					onchange={(e) => (selectedConf = (e.target as HTMLSelectElement).value)}
				>
					<option value="">All conferences</option>
					{#each conferences as c}
						<option value={c.name}>{c.name}</option>
					{/each}
				</select>
			{/if}
		</div>

		{#if teams.length === 0}
			<p class="px-4 py-8 text-xs text-gray-500 dark:text-gray-400 text-center">
				No teams found. Run the backfill for this season, division, and sport.
			</p>
		{:else if visibleTeams.length === 0}
			<p class="px-4 py-8 text-xs text-gray-500 dark:text-gray-400 text-center">
				No teams found for this conference.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<Table hoverable class="text-xs whitespace-nowrap">
					<TableHead class="text-[11px] uppercase tracking-wide">
						<TableHeadCell class="py-2 w-px whitespace-nowrap text-right">#</TableHeadCell>
						<TableHeadCell class="py-2">Team</TableHeadCell>
						<TableHeadCell class="py-2 text-right">W</TableHeadCell>
						<TableHeadCell class="py-2 text-right">L</TableHeadCell>
						<TableHeadCell class="py-2 text-right">T</TableHeadCell>
						<TableHeadCell class="py-2 text-right">GF</TableHeadCell>
						<TableHeadCell class="py-2 text-right">GA</TableHeadCell>
						<TableHeadCell class="py-2 text-right">GD</TableHeadCell>
						{#if !selectedConf}
							<TableHeadCell class="py-2">Conf</TableHeadCell>
						{/if}
					</TableHead>
					<TableBody>
						{#each visibleTeams as row, i}
							<TableBodyRow>
								<TableBodyCell class="py-1.5 w-px whitespace-nowrap text-right text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</TableBodyCell>
								<TableBodyCell class="py-1.5 font-medium">
									<a href={teamHref(row.team.ncaa_team_id)} class="flex items-center gap-2 hover:text-gray-900 dark:hover:text-white hover:underline">
										<span class="shrink-0 w-5 h-5 flex items-center justify-center">
											<TeamLogo
												lightUrl={row.team.logo_url_light}
												darkUrl={row.team.logo_url_dark}
												name={row.team.name}
												size={20}
											/>
										</span>
										<span>{row.team.name}</span>
									</a>
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right font-semibold tabular-nums">{row.wins}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right tabular-nums">{row.losses}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right tabular-nums">{row.ties}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right tabular-nums">{row.goals_for}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right tabular-nums">{row.goals_against}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right tabular-nums
									{row.goal_diff > 0 ? 'text-green-600 dark:text-green-400' : row.goal_diff < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-400'}">
									{sign(row.goal_diff)}
								</TableBodyCell>
								{#if !selectedConf}
									<TableBodyCell class="py-1.5 text-gray-400 dark:text-gray-500">{row.conference?.short_name ?? '—'}</TableBodyCell>
								{/if}
							</TableBodyRow>
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</section>
</div>
