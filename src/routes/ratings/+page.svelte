<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell, Dropdown, DropdownItem } from 'flowbite-svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import type { PageData } from './$types';
	import posthog from 'posthog-js';

	let { data }: { data: PageData } = $props();

	const sport       = $derived(data.sport);
	const division    = $derived(data.division);
	const seasonLabel = $derived(data.seasonLabel);
	const seasons     = $derived(data.seasons);
	const ratings     = $derived(data.ratings);
	const system      = $derived(data.system);

	const systems = [
		{ label: 'ELO', value: 'elo' },
		{ label: 'RPI', value: 'rpi' },
		{ label: 'Power', value: 'power' }
	];
	const systemLabel = $derived(system === 'rpi' ? 'RPI' : system === 'power' ? 'Power' : 'ELO');

	function formatValue(v: number | null): string {
		if (v === null) return '—';
		if (system === 'elo') return String(Math.round(v));
		if (system === 'rpi') return v.toFixed(4);
		return (v >= 0 ? '+' : '') + v.toFixed(2);
	}

	onMount(() => {
		posthog.capture('ratings_viewed', {
			system,
			season: seasonLabel,
			sport,
			division
		});
	});

	function navigate(overrides: Record<string, string | number> = {}) {
		const sp = new URLSearchParams({
			sport,
			division: String(division),
			season: seasonLabel,
			system,
			...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)]))
		});
		goto(`/ratings?${sp}`);
	}

	function navigateSeason(label: string) {
		navigate({ season: label });
	}

	function navigateSystem(newSystem: string) {
		if (newSystem !== system) {
			posthog.capture('rating_system_changed', {
				from_system: system,
				to_system: newSystem,
				season: seasonLabel,
				sport,
				division
			});
		}
		navigate({ system: newSystem });
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${sport}&division=${division}&season=${seasonLabel}`;
	}

	// Division is fixed to D-I in the UI for now; the server still honours a
	// ?division= query param, so other divisions can be enabled by re-adding a
	// toggle here (see git history) once they're populated.
	const divisionLabel = $derived(division === 1 ? 'DI' : division === 2 ? 'DII' : 'DIII');
	const genderLabel = $derived(sport === 'WSO' ? "Women's" : "Men's");
	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(`NCAA ${genderLabel} ${divisionLabel} Soccer ${systemLabel} Ratings — ${seasonLabel} | CollegeSoccer.IO`);
	const pageDesc = $derived(`${systemLabel} ratings for NCAA ${genderLabel.toLowerCase()} ${divisionLabel} college soccer, ${seasonLabel} season. Ratings are derived from every result.`);
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
			<div class="flex gap-1">
				{#each [{ label: 'Men', value: 'MSO' }, { label: 'Women', value: 'WSO' }] as g}
					<button
						onclick={() => navigate({ sport: g.value })}
						class="px-2 py-1 text-xs rounded font-semibold transition-colors
							{sport === g.value ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>{g.label}</button>
				{/each}
			</div>
			<div class="flex gap-1">
				{#each systems as sys}
					<button
						onclick={() => navigateSystem(sys.value)}
						class="px-2 py-1 text-xs rounded font-semibold transition-colors
							{system === sys.value ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>{sys.label}</button>
				{/each}
			</div>
			<button
				id="mob-season-ratings"
				class="text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 rounded px-1.5 py-1 flex items-center gap-1"
			>
				{seasonLabel} <span class="text-gray-400 dark:text-gray-500 text-[10px]">▾</span>
			</button>
			<Dropdown triggeredBy="#mob-season-ratings" placement="bottom-start" simple>
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
							{sport === g.value ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>{g.label}</button>
				{/each}
			</div>

			<!-- System toggle -->
			<div class="border-b border-gray-200 dark:border-gray-700 p-2 flex gap-1">
				{#each systems as sys}
					<button
						onclick={() => navigateSystem(sys.value)}
						class="flex-1 text-xs py-1 rounded font-semibold transition-colors
							{system === sys.value ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>{sys.label}</button>
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

	<!-- Ratings panel -->
	<section class="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
		<!-- Panel header -->
		<div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
			<h1 class="text-sm font-semibold text-gray-700 dark:text-gray-200 shrink-0">
				{genderLabel} Division {division} {systemLabel} — {seasonLabel}
			</h1>
			<a href="/teams?sport={sport}&division={division}&season={seasonLabel}" class="text-xs text-primary-600 dark:text-primary-400 hover:underline shrink-0">
				Standings →
			</a>
		</div>

		{#if ratings.length === 0}
			<p class="px-4 py-8 text-xs text-gray-500 dark:text-gray-400 text-center">
				No ratings found. Recompute ratings for this season, division, and sport from the admin panel.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<Table hoverable class="text-xs whitespace-nowrap">
					<TableHead class="text-[11px] uppercase tracking-wide">
						<TableHeadCell class="py-2 w-px whitespace-nowrap text-right">#</TableHeadCell>
						<TableHeadCell class="py-2">Team</TableHeadCell>
						<TableHeadCell class="py-2 text-right">{systemLabel}</TableHeadCell>
						<TableHeadCell class="py-2 text-right">GP</TableHeadCell>
						<TableHeadCell class="py-2">Conf</TableHeadCell>
					</TableHead>
					<TableBody>
						{#each ratings as row, i}
							<TableBodyRow>
								<TableBodyCell class="py-1.5 w-px whitespace-nowrap text-right text-gray-400 dark:text-gray-500 tabular-nums">
									{row.rank ?? i + 1}
								</TableBodyCell>
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
								<TableBodyCell class="py-1.5 text-right font-semibold tabular-nums">
									{formatValue(row.value)}
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
									{row.games_played}
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-gray-400 dark:text-gray-500">{row.conference?.short_name ?? '—'}</TableBodyCell>
							</TableBodyRow>
						{/each}
					</TableBody>
				</Table>
			</div>

			<p class="px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
				{#if system === 'elo'}
					ELO is a margin-of-victory power rating derived from every result. Ratings update when an admin recomputes, and carry over between seasons with regression toward 1500.
				{:else if system === 'rpi'}
					RPI (Rating Percentage Index) blends a team's location-weighted winning percentage (25%) with strength of schedule — opponents' winning percentage (50%) and opponents' opponents' (25%).
				{:else}
					Power rating derived from every result.
				{/if}
			</p>
		{/if}
	</section>
</div>
