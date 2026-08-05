<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import PickPerformanceChart from '$lib/components/PickPerformanceChart.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let hoverIndex = $state<number | null>(null);

	const summary = $derived(data.summary);
	const graded = $derived(summary?.graded ?? 0);
	const decided = $derived((summary?.wins ?? 0) + (summary?.losses ?? 0));

	const isOwnProfile = $derived(
		page.data.username?.toLowerCase() === data.profileUsername.toLowerCase()
	);

	function navigate(overrides: Record<string, string> = {}) {
		const sp = new URLSearchParams({
			season: data.seasonLabel,
			sport: data.sportCode,
			...overrides
		});
		goto(`?${sp}`);
	}

	const pct = (v: number | null | undefined) =>
		v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`;

	const fmtDate = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});

	function outcomeLabel(p: { outcome: string; home_team: string; away_team: string }) {
		if (p.outcome === 'draw') return 'Draw';
		return p.outcome === 'home' ? p.home_team : p.away_team;
	}

	function scoreLine(p: { home_score: number | null; away_score: number | null }) {
		if (p.home_score === null || p.away_score === null) return '—';
		return `${p.away_score}–${p.home_score}`;
	}

	const pageTitle = $derived(`${data.profileUsername} — Pick'em | CollegeSoccer.IO`);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<!-- Public and shareable by link, but individual users are not search surface. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-3">
	<!-- Header -->
	<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 class="text-lg font-bold text-gray-900 dark:text-white">{data.profileUsername}</h1>
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
					Pick'em record · {data.seasonLabel} · {data.sportCode === 'WSO' ? "Women's" : "Men's"} DI
				</p>
			</div>

			<div class="flex items-center gap-2">
				<select
					class="text-xs bg-transparent text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1"
					value={data.sportCode}
					onchange={(e) => navigate({ sport: (e.target as HTMLSelectElement).value })}
				>
					<option value="MSO">Men's</option>
					<option value="WSO">Women's</option>
				</select>
				<select
					class="text-xs bg-transparent text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1"
					value={data.seasonLabel}
					onchange={(e) => navigate({ season: (e.target as HTMLSelectElement).value })}
				>
					{#each data.seasons as s (s.id)}
						<option value={s.label}>{s.label}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if graded > 0}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
				{#each [{ label: 'Record', value: `${summary?.wins ?? 0}–${summary?.losses ?? 0}` }, { label: 'Win %', value: pct(summary?.win_pct) }, { label: 'Rank', value: summary?.rank ? `#${summary.rank}` : '—' }, { label: 'Best streak', value: String(summary?.best_streak ?? 0) }] as stat (stat.label)}
					<div class="flex flex-col items-center py-2 rounded bg-gray-50 dark:bg-gray-900/60">
						<span class="text-xl font-bold font-mono text-gray-900 dark:text-white tabular-nums">{stat.value}</span>
						<span class="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-0.5">{stat.label}</span>
					</div>
				{/each}
			</div>

			<p class="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
				{decided} decided {decided === 1 ? 'pick' : 'picks'}
				{#if (summary?.voids ?? 0) > 0}
					· {summary?.voids} voided (cancelled games)
				{/if}
				{#if (summary?.current_streak ?? 0) > 1}
					· on a {summary?.current_streak}-game winning streak
				{/if}
			</p>
		{/if}
	</section>

	{#if graded === 0}
		<!-- Empty state -->
		<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded py-12 px-4 text-center">
			<p class="text-sm font-semibold text-gray-800 dark:text-gray-200">No graded picks yet</p>
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
				{#if isOwnProfile}
					Pick some games on the scoreboard — results appear here once those games finish.
				{:else}
					{data.profileUsername} hasn't had any picks graded for this season and sport yet.
				{/if}
			</p>
			{#if isOwnProfile}
				<a
					href="/scores"
					class="inline-block mt-4 px-3 py-1.5 rounded bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-colors"
				>Go to the scoreboard</a>
			{/if}
		</section>
	{:else}
		<!-- Season chart -->
		<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
			<h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
				Cumulative win % vs. the field
			</h2>
			{#if data.timeline.length > 0}
				<PickPerformanceChart data={data.timeline as never} bind:hoverIndex />
			{:else}
				<p class="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">
					Not enough graded picks to plot yet.
				</p>
			{/if}
		</section>

		<!-- Recent picks -->
		<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
			<h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-4 pt-4 pb-2">
				Recent picks
			</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-xs">
					<thead>
						<tr class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
							<th class="text-left font-semibold px-4 py-2">Date</th>
							<th class="text-left font-semibold px-2 py-2">Matchup</th>
							<th class="text-left font-semibold px-2 py-2">Pick</th>
							<th class="text-right font-semibold px-2 py-2">Score</th>
							<th class="text-center font-semibold px-4 py-2">Result</th>
						</tr>
					</thead>
					<tbody>
						{#each data.recentPicks as p (p.game_id)}
							<tr class="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
								<td class="px-4 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400 tabular-nums">
									{fmtDate(p.contest_date)}
								</td>
								<td class="px-2 py-2">
									<span class="flex items-center gap-1.5 min-w-0">
										<TeamLogo
											lightUrl={p.away_logo_light}
											darkUrl={p.away_logo_dark}
											name={p.away_team ?? ''}
											size={18}
										/>
										<span class="truncate text-gray-700 dark:text-gray-300">{p.away_team ?? '—'}</span>
										<span class="text-gray-300 dark:text-gray-600">@</span>
										<TeamLogo
											lightUrl={p.home_logo_light}
											darkUrl={p.home_logo_dark}
											name={p.home_team ?? ''}
											size={18}
										/>
										<span class="truncate text-gray-700 dark:text-gray-300">{p.home_team ?? '—'}</span>
									</span>
								</td>
								<td class="px-2 py-2 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
									{outcomeLabel(p)}
								</td>
								<td class="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400 whitespace-nowrap">
									{scoreLine(p)}{#if p.shootout}<span class="ml-1 text-[9px] uppercase text-gray-400 dark:text-gray-500">PK</span>{/if}
								</td>
								<td class="px-4 py-2 text-center">
									{#if p.result === 'win'}
										<span class="font-bold text-green-600 dark:text-green-400" title="Correct">✓</span>
									{:else if p.result === 'loss'}
										<span class="font-bold text-red-600 dark:text-red-400" title="Incorrect">✗</span>
									{:else}
										<span class="text-[10px] uppercase text-gray-400 dark:text-gray-500" title="Cancelled">void</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
