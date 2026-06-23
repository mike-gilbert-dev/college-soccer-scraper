<script lang="ts">
	// Interactive category leaderboard card: a cumulative stat-vs-field-average
	// trend chart for the selected player, that player's info, and a clickable
	// ranked list. First place is selected on mount. Ported from the
	// CollegeSoccer.IO design system (StatLeaders).
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import type { Leader } from '../../routes/stats/+page.server';

	let {
		category,
		unit,
		subtitle = '',
		n,
		average,
		leaders,
		href
	}: {
		category: string;
		unit: string;
		subtitle?: string;
		n: number;
		average: number[];
		leaders: Leader[];
		href: (l: Leader) => string;
	} = $props();

	let sel = $state(0);
	const p = $derived(leaders[sel] ?? leaders[0]);
	const values = $derived(p?.series ?? []);

	const lastName = $derived((p?.name ?? '').split(' ').slice(-1).join(' '));

	// ── chart geometry ────────────────────────────────────────────────────
	let chartEl = $state<HTMLDivElement | undefined>(undefined);
	let w = $state(0);
	$effect(() => {
		if (!chartEl) return;
		const ro = new ResizeObserver((entries) => {
			w = entries[0].contentRect.width;
		});
		ro.observe(chartEl);
		w = chartEl.clientWidth;
		return () => ro.disconnect();
	});

	const H = 188;
	const padL = 26, padR = 10, padT = 14, padB = 24;
	const innerH = H - padT - padB;
	const innerW = $derived(Math.max(0, w - padL - padR));
	const maxV = $derived(Math.max(...values, ...average, 1) * 1.12);

	const x = (i: number) => padL + (n <= 1 ? 0 : innerW * (i / (n - 1)));
	const y = (v: number) => padT + innerH * (1 - v / maxV);
	const path = (arr: number[]) =>
		arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	const areaPath = $derived(
		values.length
			? `${path(values)} L${x(values.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`
			: ''
	);
	const grid = $derived([0, Math.round(maxV / 2), Math.ceil(maxV)]);
	const every = $derived(n > 8 ? 2 : 1);
	const gid = $derived('cs-leaders-fill-' + category.replace(/\W+/g, '-'));
</script>

<div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
	<!-- Header -->
	<div class="flex items-baseline gap-2 border-b border-gray-200 px-3.5 py-3 dark:border-gray-700">
		<h3 class="text-sm font-bold text-gray-900 dark:text-white">{category} Leaders</h3>
		{#if subtitle}
			<span class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{subtitle}</span>
		{/if}
	</div>

	<!-- Chart -->
	<div class="leaders-chart px-3.5 pt-2.5 pb-1">
		<div bind:this={chartEl} style="width:100%">
			{#if w > 0}
				<svg width={w} height={H} style="display:block;overflow:visible;font-family:var(--font-mono,ui-monospace,monospace)">
					<defs>
						<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="var(--color-primary-500)" stop-opacity="0.22" />
							<stop offset="100%" stop-color="var(--color-primary-500)" stop-opacity="0" />
						</linearGradient>
					</defs>
					{#each grid as g (g)}
						<line x1={padL} x2={w - padR} y1={y(g)} y2={y(g)} stroke="var(--c-border)" stroke-width="1" />
						<text x={padL - 6} y={y(g) + 3} text-anchor="end" font-size="9" fill="var(--c-muted)">{g}</text>
					{/each}
					{#if areaPath}
						<path d={areaPath} fill="url(#{gid})" />
					{/if}
					<path d={path(average)} fill="none" stroke="var(--c-muted)" stroke-width="1.5" stroke-dasharray="4 4" />
					<path d={path(values)} fill="none" stroke="var(--color-primary-500)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
					{#each values as v, i (i)}
						<circle cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 3.5 : 2} fill="var(--color-primary-500)" />
					{/each}
					{#each values as _, i (i)}
						{#if i % every === 0 || i === values.length - 1}
							<text x={x(i)} y={H - 7} text-anchor="middle" font-size="9" fill="var(--c-muted)">G{i + 1}</text>
						{/if}
					{/each}
				</svg>
			{/if}
		</div>
		<!-- Legend -->
		<div class="flex justify-center gap-4 pb-2">
			<span class="inline-flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
				<span class="h-0.75 w-3.5 rounded-sm bg-primary-500"></span>{lastName}
			</span>
			<span class="inline-flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
				<span class="w-3.5 border-t-2 border-dashed border-gray-400 dark:border-gray-500"></span>Field average
			</span>
		</div>
	</div>

	<!-- Selected player -->
	{#if p}
		<div class="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-3.5 py-3 dark:border-gray-700 dark:bg-gray-900">
			{#if p.headshot_url}
				<img src={p.headshot_url} alt={p.name} class="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
			{:else}
				<TeamLogo lightUrl={p.logo_url_light} darkUrl={p.logo_url_dark} name={p.team} size={40} />
			{/if}
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<a href={href(p)} class="text-sm font-bold text-gray-900 hover:underline dark:text-white">{p.name}</a>
					{#if p.pos}
						<span class="rounded-sm border border-gray-200 bg-white px-1.5 py-px text-[10px] font-bold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{p.pos}</span>
					{/if}
				</div>
				<div class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
					{[p.team, p.gp != null ? `${p.gp} GP` : null].filter(Boolean).join(' · ')}
				</div>
			</div>
			<div class="text-right">
				<div class="font-mono text-2xl font-bold leading-none tabular-nums text-gray-900 dark:text-white">{p.value}</div>
				<div class="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{unit}</div>
			</div>
		</div>
	{/if}

	<!-- Leaderboard list -->
	<div>
		{#each leaders as l, i (l.ncaa_player_id)}
			{@const active = i === sel}
			<button
				onclick={() => (sel = i)}
				class="flex w-full items-center gap-2.5 border-t border-l-[3px] border-gray-200 py-2.5 pl-2.5 pr-3.5 text-left transition-colors dark:border-t-gray-700
					{active
						? 'border-l-primary-500 bg-primary-500/10'
						: 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-700/40'}"
			>
				<span class="w-4 text-right font-mono text-xs font-bold tabular-nums {active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}">{i + 1}</span>
				{#if l.headshot_url}
					<img src={l.headshot_url} alt={l.name} class="h-5.5 w-5.5 shrink-0 rounded object-cover" loading="lazy" />
				{:else}
					<TeamLogo lightUrl={l.logo_url_light} darkUrl={l.logo_url_dark} name={l.team} size={22} />
				{/if}
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm text-gray-900 dark:text-white {active ? 'font-semibold' : 'font-medium'}">{l.name}</span>
					<span class="block text-[10px] text-gray-400 dark:text-gray-500">{l.team}</span>
				</span>
				<span class="font-mono text-sm font-bold tabular-nums {active ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">{l.value}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.leaders-chart {
		--c-border: var(--color-gray-200);
		--c-muted: var(--color-gray-400);
	}
	:global(.dark) .leaders-chart {
		--c-border: var(--color-gray-700);
		--c-muted: var(--color-gray-500);
	}
</style>
