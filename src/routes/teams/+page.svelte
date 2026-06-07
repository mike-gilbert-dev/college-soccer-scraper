<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sport      = $derived(data.sport);
	const division   = $derived(data.division);
	const seasonYear = $derived(data.seasonYear);
	const teams      = $derived(data.teams);

	const divisions = [
		{ label: 'Division I',   value: 1 },
		{ label: 'Division II',  value: 2 },
		{ label: 'Division III', value: 3 }
	];

	const seasons = [2025, 2024];

	function navigate(overrides: Record<string, string | number> = {}) {
		const sp = new URLSearchParams({
			sport:    sport,
			division: String(division),
			season:   String(seasonYear),
			...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)]))
		});
		goto(`/teams?${sp}`);
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${sport}&division=${division}&season=${seasonYear}`;
	}
</script>

<div class="flex gap-2 items-start">
	<!-- Sidebar -->
	<aside class="w-44 shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
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
	</aside>

	<!-- Teams panel -->
	<section class="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
		<div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
			<h1 class="text-sm font-semibold text-gray-700 dark:text-gray-200">
				{sport === 'WSO' ? "Women's" : "Men's"} Soccer Teams — {seasonYear}
			</h1>
		</div>

		{#if teams.length === 0}
			<p class="px-4 py-8 text-xs text-gray-500 dark:text-gray-400 text-center">
				No teams found. Run the backfill for this season, division, and sport.
			</p>
		{:else}
			<div class="divide-y divide-gray-100 dark:divide-gray-700">
				{#each teams as row}
					<a
						href={teamHref(row.team.ncaa_team_id)}
						class="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
					>
						<span class="text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-primary-600 dark:group-hover:text-primary-400">
							{row.team.name}
						</span>
						<span class="text-xs text-gray-400 dark:text-gray-500">
							{row.conference?.name ?? ''}
						</span>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>
