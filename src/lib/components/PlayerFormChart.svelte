<script lang="ts">
	// SVG line/form chart of a player's per-game stats. Renders one polyline per
	// visible stat series. When the data spans more than one season it draws
	// dashed season dividers + year labels; for a single season it labels each
	// game on the x-axis with the opponent code. Supports an external hover index
	// (driven by, and driving, the game-log table) for cross-highlighting.
	interface Series {
		key: string;
		label: string;
		color: string;
	}
	interface Datum {
		year: string;
		seasonStart?: boolean;
		op?: string;
		[key: string]: unknown;
	}

	let {
		data,
		series,
		visible,
		hoverIndex = null,
		onHover
	}: {
		data: Datum[];
		series: Series[];
		visible: Record<string, boolean>;
		hoverIndex?: number | null;
		onHover?: (i: number | null) => void;
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
	const padL = 28;
	const padR = 12;
	const padT = 16;
	const padB = 28;
	const innerH = H - padT - padB;

	const n = $derived(data.length);
	const innerW = $derived(Math.max(0, w - padL - padR));
	const active = $derived(series.filter((s) => visible[s.key]));
	const num = (d: Datum, key: string) => (typeof d[key] === 'number' ? (d[key] as number) : 0);
	const rawMax = $derived(Math.max(1, ...active.flatMap((s) => data.map((d) => num(d, s.key)))));
	const maxV = $derived(rawMax * 1.18);

	const x = (i: number) => padL + (n <= 1 ? 0 : innerW * (i / (n - 1)));
	const y = (v: number) => padT + innerH * (1 - v / maxV);
	const linePath = (key: string) =>
		data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(num(d, key)).toFixed(1)}`).join(' ');

	const grid = $derived([...new Set([0, Math.round(rawMax / 2), Math.ceil(rawMax)])]);
	const showDots = $derived(n <= 20);
	const multiSeason = $derived(new Set(data.map((d) => d.year)).size > 1);
	const showCodes = $derived(!multiSeason && n <= 22);
	const slot = $derived(n > 1 ? innerW / (n - 1) : innerW);

	const starts = $derived(data.map((_, i) => i).filter((i) => data[i].seasonStart));
	const ranges = $derived(
		starts.map((si, k) => {
			const endI = (k + 1 < starts.length ? starts[k + 1] : n) - 1;
			return { year: data[si].year, startI: si, endI, midX: (x(si) + x(endI)) / 2 };
		})
	);
</script>

<div class="chart" bind:this={containerEl} style="width:100%">
	{#if w > 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			width={w}
			height={H}
			style="display:block;overflow:visible;font-family:var(--font-mono,ui-monospace,monospace)"
			onmouseleave={() => onHover?.(null)}
		>
			{#each grid as g (g)}
				<line x1={padL} x2={w - padR} y1={y(g)} y2={y(g)} stroke="var(--c-border)" stroke-width="1" />
				<text x={padL - 7} y={y(g) + 3} text-anchor="end" font-size="9" fill="var(--c-muted)">{g}</text>
			{/each}

			{#if hoverIndex != null}
				<line
					x1={x(hoverIndex)}
					x2={x(hoverIndex)}
					y1={padT}
					y2={padT + innerH}
					stroke="var(--c-border-strong)"
					stroke-width="1"
				/>
			{/if}

			{#if multiSeason}
				{#each ranges as r, k (r.year)}
					{#if k > 0}
						<line
							x1={(x(r.startI) + x(r.startI - 1)) / 2}
							x2={(x(r.startI) + x(r.startI - 1)) / 2}
							y1={padT}
							y2={padT + innerH}
							stroke="var(--c-border)"
							stroke-width="1"
							stroke-dasharray="3 3"
						/>
					{/if}
					<text x={r.midX} y={H - 8} text-anchor="middle" font-size="10" font-weight="700" fill="var(--c-muted)">
						{r.year}
					</text>
				{/each}
			{/if}

			{#if showCodes}
				{#each data as d, i (i)}
					<text
						x={x(i)}
						y={H - 8}
						text-anchor="middle"
						font-size="8.5"
						font-weight="700"
						fill={hoverIndex === i ? 'var(--c-text)' : 'var(--c-muted)'}
					>
						{d.op}
					</text>
				{/each}
			{/if}

			{#each active as s (s.key)}
				<path
					d={linePath(s.key)}
					fill="none"
					stroke={s.color}
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
				{#each data as d, i (i)}
					{#if showDots || hoverIndex === i}
						<circle
							cx={x(i)}
							cy={y(num(d, s.key))}
							r={hoverIndex === i ? 4 : 2.5}
							fill={s.color}
							stroke={hoverIndex === i ? 'var(--c-surface)' : 'none'}
							stroke-width={hoverIndex === i ? 1.5 : 0}
						/>
					{/if}
				{/each}
			{/each}

			{#if active.length === 0}
				<text x={w / 2} y={H / 2} text-anchor="middle" font-size="11" fill="var(--c-muted)">
					Select a stat to plot
				</text>
			{/if}

			{#if onHover}
				{#each data as _, i (i)}
					<rect
						x={x(i) - slot / 2}
						y={padT}
						width={slot}
						height={innerH}
						fill="transparent"
						style="cursor:pointer"
						onmouseenter={() => onHover?.(i)}
					/>
				{/each}
			{/if}
		</svg>
	{/if}
</div>

<style>
	.chart {
		--c-border: var(--color-gray-200);
		--c-border-strong: var(--color-gray-300);
		--c-muted: var(--color-gray-400);
		--c-text: var(--color-gray-900);
		--c-surface: #ffffff;
	}
	:global(.dark) .chart {
		--c-border: var(--color-gray-700);
		--c-border-strong: var(--color-gray-600);
		--c-muted: var(--color-gray-500);
		--c-text: var(--color-gray-200);
		--c-surface: var(--color-gray-800);
	}
</style>
