<script lang="ts">
	// Cumulative win % over a season: the user against the field.
	//
	// Hand-rolled SVG, following the pattern in PlayerFormChart.svelte — no
	// charting dependency. Y axis is a percentage, so it's pinned to 0–100 rather
	// than scaled to the data; that keeps "am I above or below average" readable
	// at a glance and stops an early 100% run from flattening the rest.
	interface Point {
		contest_date: string;
		user_cum_pct: number | null;
		field_cum_pct: number | null;
		user_wins: number;
		user_losses: number;
		user_cum_wins: number;
	}

	let {
		data,
		hoverIndex = $bindable(null)
	}: {
		data: Point[];
		hoverIndex?: number | null;
	} = $props();

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let w = $state(0);

	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver((entries) => {
			w = entries[0].contentRect.width;
		});
		ro.observe(containerEl);
		w = containerEl.clientWidth;
		return () => ro.disconnect();
	});

	const H = 220;
	const padL = 32;
	const padR = 12;
	const padT = 16;
	const padB = 26;
	const innerH = H - padT - padB;

	const n = $derived(data.length);
	const innerW = $derived(Math.max(0, w - padL - padR));

	const x = (i: number) => padL + (n <= 1 ? innerW / 2 : innerW * (i / (n - 1)));
	const y = (pct: number) => padT + innerH * (1 - pct);

	/** Percentage series can have leading nulls; skip those points. */
	function path(key: 'user_cum_pct' | 'field_cum_pct') {
		let started = false;
		const parts: string[] = [];
		data.forEach((d, i) => {
			const v = d[key];
			if (v === null) return;
			parts.push(`${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
			started = true;
		});
		return parts.join(' ');
	}

	const grid = [0, 0.25, 0.5, 0.75, 1];
	const showDots = $derived(n <= 30);

	const fmtPct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
	const fmtDate = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});

	// Label roughly six dates so the axis never crowds.
	const labelEvery = $derived(Math.max(1, Math.ceil(n / 6)));

	function nearestIndex(event: MouseEvent) {
		if (!containerEl || n === 0) return null;
		const rect = containerEl.getBoundingClientRect();
		const px = event.clientX - rect.left;
		if (n === 1) return 0;
		const ratio = (px - padL) / Math.max(1, innerW);
		return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
	}

	const hovered = $derived(hoverIndex !== null ? data[hoverIndex] : null);
</script>

<div class="w-full" bind:this={containerEl}>
	{#if w > 0 && n > 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			width={w}
			height={H}
			style="display:block;overflow:visible"
			role="img"
			aria-label="Cumulative win percentage compared with the field average"
			onmousemove={(e) => (hoverIndex = nearestIndex(e))}
			onmouseleave={() => (hoverIndex = null)}
		>
			{#each grid as g (g)}
				<line
					x1={padL}
					x2={w - padR}
					y1={y(g)}
					y2={y(g)}
					class="stroke-gray-200 dark:stroke-gray-700"
					stroke-width="1"
				/>
				<text
					x={padL - 6}
					y={y(g) + 3}
					text-anchor="end"
					font-size="9"
					class="fill-gray-400 dark:fill-gray-500"
				>
					{Math.round(g * 100)}%
				</text>
			{/each}

			{#if hoverIndex !== null}
				<line
					x1={x(hoverIndex)}
					x2={x(hoverIndex)}
					y1={padT}
					y2={padT + innerH}
					class="stroke-gray-300 dark:stroke-gray-600"
					stroke-width="1"
				/>
			{/if}

			<!-- Field average: muted, dashed, sits behind -->
			<path
				d={path('field_cum_pct')}
				fill="none"
				class="stroke-gray-400 dark:stroke-gray-500"
				stroke-width="1.5"
				stroke-dasharray="4 3"
				stroke-linejoin="round"
			/>

			<!-- The user: accent, solid, on top -->
			<path
				d={path('user_cum_pct')}
				fill="none"
				stroke="#e8463a"
				stroke-width="2"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>

			{#each data as d, i (d.contest_date)}
				{#if d.user_cum_pct !== null && (showDots || hoverIndex === i)}
					<circle
						cx={x(i)}
						cy={y(d.user_cum_pct)}
						r={hoverIndex === i ? 4 : 2.5}
						fill="#e8463a"
						class={hoverIndex === i ? 'stroke-white dark:stroke-gray-800' : ''}
						stroke-width={hoverIndex === i ? 1.5 : 0}
					/>
				{/if}
				{#if i % labelEvery === 0 || i === n - 1}
					<text
						x={x(i)}
						y={H - 8}
						text-anchor="middle"
						font-size="9"
						class="fill-gray-400 dark:fill-gray-500"
					>
						{fmtDate(d.contest_date)}
					</text>
				{/if}
			{/each}
		</svg>

		<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
			<span class="flex items-center gap-1.5">
				<span class="inline-block w-4 h-0.5 rounded" style="background:#e8463a"></span>
				<span class="text-gray-600 dark:text-gray-400">You</span>
			</span>
			<span class="flex items-center gap-1.5">
				<span class="inline-block w-4 border-t-2 border-dashed border-gray-400 dark:border-gray-500"></span>
				<span class="text-gray-600 dark:text-gray-400">Field average</span>
			</span>

			{#if hovered}
				<span class="ml-auto tabular-nums text-gray-500 dark:text-gray-400">
					{fmtDate(hovered.contest_date)} ·
					<span class="font-semibold text-gray-800 dark:text-gray-200">{fmtPct(hovered.user_cum_pct)}</span>
					vs {fmtPct(hovered.field_cum_pct)}
					· {hovered.user_wins}W&ndash;{hovered.user_losses}L that day
				</span>
			{/if}
		</div>
	{/if}
</div>
