<script lang="ts">
	import { page } from '$app/state';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import { STAT_CATEGORIES } from '$lib/stat-categories';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const division    = $derived(data.division);
	const seasonLabel = $derived(data.seasonLabel);
	const totalPages  = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
	const hasPrev     = $derived(data.page > 1);
	const hasNext     = $derived(data.page < totalPages);

	// ── Link helpers ─────────────────────────────────────────────────────────
	const scope = $derived(`sport=${data.sport}&division=${division}&season=${encodeURIComponent(seasonLabel)}`);
	const pageHref     = (p: number) => `?${scope}${p > 1 ? `&page=${p}` : ''}`;
	const categoryHref = (key: string) => `/stats/${key}?${scope}`;
	const playerHref   = (id: string) => `/players/${id}?${scope}`;
	const teamHref     = (id: string) => `/teams/${id}?${scope}`;
	const backHref     = $derived(`/stats?${scope}&tab=players`);

	const perGame = (value: number, gp: number) => (gp > 0 ? (value / gp).toFixed(2) : '—');

	const divisionLabel = $derived(division === 1 ? 'DI' : division === 2 ? 'DII' : 'DIII');
	const genderLabel   = $derived(data.sport === 'WSO' ? "Women's" : "Men's");

	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(`NCAA ${genderLabel} ${divisionLabel} Soccer ${data.category} Leaders — ${seasonLabel} | CollegeSoccer.IO`);
	const pageDesc = $derived(`Every NCAA ${genderLabel.toLowerCase()} ${divisionLabel} college soccer player ranked by ${data.category.toLowerCase()} for the ${seasonLabel} season.`);
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

<section class="overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
	<!-- Header -->
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900">
		<a href={backHref} class="text-xs text-gray-500 hover:text-gray-800 hover:underline dark:text-gray-400 dark:hover:text-gray-200">‹ All stats</a>
		<h1 class="text-sm font-bold text-gray-900 dark:text-white">{data.category} Leaders</h1>
		<span class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
			NCAA {divisionLabel} · {data.sport === 'WSO' ? 'Women' : 'Men'} · {seasonLabel}
		</span>
		<span class="ml-auto text-[10px] text-gray-400 dark:text-gray-500">{data.total} players</span>
	</div>

	<!-- Category switcher -->
	<div class="flex gap-1 overflow-x-auto border-b border-gray-200 px-3 py-2 dark:border-gray-700">
		{#each STAT_CATEGORIES as c (c.key)}
			<a
				href={categoryHref(c.key)}
				class="shrink-0 rounded px-2 py-1 text-xs font-semibold transition-colors
					{c.key === data.key ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}"
			>{c.category}</a>
		{/each}
	</div>

	{#if data.players.length === 0}
		<p class="py-12 text-center text-sm text-gray-400">No player stats available for this selection.</p>
	{:else}
		{@render pager('border-b')}
		<div class="overflow-x-auto">
			<table class="w-full text-xs">
				<thead>
					<tr class="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
						<th class="w-10 px-3 py-2 text-left font-semibold">#</th>
						<th class="px-3 py-2 text-left font-semibold">Player</th>
						<th class="px-3 py-2 text-left font-semibold">Team</th>
						<th class="px-2 py-2 text-center font-semibold">GP</th>
						<th class="px-2 py-2 text-center font-semibold text-primary-600 dark:text-primary-400">{data.unit}</th>
						<th class="px-3 py-2 text-center font-semibold">Per GP</th>
					</tr>
				</thead>
				<tbody>
					{#each data.players as p (p.ncaa_player_id)}
						<tr class="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50 dark:border-gray-700/60 dark:hover:bg-gray-700/30">
							<td class="whitespace-nowrap px-3 py-1.5 tabular-nums text-gray-500 dark:text-gray-400">{p.tied ? 'T-' : ''}{p.rank}</td>
							<td class="px-3 py-1.5">
								<div class="flex items-center gap-2">
									{#if p.headshot_url}
										<img src={p.headshot_url} alt={p.name} class="h-6 w-6 shrink-0 rounded object-cover" loading="lazy" />
									{:else}
										<span class="flex h-6 w-6 shrink-0 items-center justify-center">
											<TeamLogo lightUrl={p.logo_url_light} darkUrl={p.logo_url_dark} name={p.team} size={20} />
										</span>
									{/if}
									<a href={playerHref(p.ncaa_player_id)} class="font-medium text-gray-900 hover:underline dark:text-white">{p.name}</a>
									{#if p.pos}
										<span class="rounded-sm border border-gray-200 px-1 py-px text-[9px] font-bold text-gray-500 dark:border-gray-700 dark:text-gray-400">{p.pos}</span>
									{/if}
								</div>
							</td>
							<td class="px-3 py-1.5">
								<a href={teamHref(p.team_ncaa_id)} class="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 hover:underline dark:text-gray-400 dark:hover:text-white">
									<span class="flex h-4 w-4 shrink-0 items-center justify-center">
										<TeamLogo lightUrl={p.logo_url_light} darkUrl={p.logo_url_dark} name={p.team} size={16} />
									</span>
									<span class="truncate">{p.team}</span>
								</a>
							</td>
							<td class="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-400">{p.gp}</td>
							<td class="px-2 py-1.5 text-center font-mono font-bold tabular-nums text-gray-900 dark:text-white">{p.value}</td>
							<td class="px-3 py-1.5 text-center tabular-nums text-gray-500 dark:text-gray-400">{perGame(p.value, p.gp)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{@render pager('border-t')}
	{/if}
</section>

{#snippet pager(border: string)}
	{#if totalPages > 1}
		<nav class="flex items-center justify-between gap-2 {border} border-gray-200 px-4 py-2 dark:border-gray-700">
			{#if hasPrev}
				<a href={pageHref(data.page - 1)} class="rounded bg-primary-500 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-600">‹ Prev</a>
			{:else}
				<span class="rounded bg-primary-500 px-3 py-1 text-xs font-semibold text-white opacity-30">‹ Prev</span>
			{/if}
			<span class="text-[11px] text-gray-400 dark:text-gray-500">Page {data.page} of {totalPages}</span>
			{#if hasNext}
				<a href={pageHref(data.page + 1)} class="rounded bg-primary-500 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary-600">Next ›</a>
			{:else}
				<span class="rounded bg-primary-500 px-3 py-1 text-xs font-semibold text-white opacity-30">Next ›</span>
			{/if}
		</nav>
	{/if}
{/snippet}
