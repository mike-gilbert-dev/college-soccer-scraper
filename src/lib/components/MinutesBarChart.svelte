<script lang="ts">
	// Thin per-game minutes bars. Shares padL/spacing with PlayerFormChart so the
	// bars line up under the trend chart above them; a dashed 90' line marks a
	// full match. Supports an external hover index for cross-highlighting with the
	// line chart and game-log table. Ported from the CollegeSoccer.IO design system.
	interface Datum {
		id: number;
		year: string;
		seasonStart?: boolean;
		min: number | null;
		[key: string]: unknown;
	}

	let {
		data,
		hoverIndex = null,
		onHover
	}: {
		data: Datum[];
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

	const H = 86;
	const padL = 28, padR = 12, padT = 12, padB = 22;
	const innerH = H - padT - padB;
	const base = padT + innerH;

	const m = (d: Datum) => d.min ?? 0;
	const n = $derived(data.length);
	const innerW = $derived(Math.max(0, w - padL - padR));
	const maxV = $derived(Math.max(90, ...data.map(m)) * 1.06);
	const slot = $derived(n > 0 ? innerW / n : innerW);
	const bw = $derived(Math.max(2, Math.min(slot * 0.62, 13)));

	const x = (i: number) => padL + slot * (i + 0.5);
	const y = (v: number) => padT + innerH * (1 - v / maxV);

	const multiSeason = $derived(new Set(data.map((d) => d.year)).size > 1);
	const starts = $derived(data.map((_, i) => i).filter((i) => data[i].seasonStart));
	const ranges = $derived(
		starts.map((si, k) => {
			const endI = (k + 1 < starts.length ? starts[k + 1] : n) - 1;
			return { year: data[si].year, startI: si, endI, midX: (x(si) + x(endI)) / 2 };
		})
	);
</script>

<div class="mins-chart" bind:this={containerEl} style="width:100%">
	{#if w > 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			width={w}
			height={H}
			style="display:block;overflow:visible;font-family:var(--font-mono,ui-monospace,monospace)"
			onmouseleave={() => onHover?.(null)}
		>
			<line x1={padL} x2={w - padR} y1={base} y2={base} stroke="var(--c-border)" stroke-width="1" />
			<line x1={padL} x2={w - padR} y1={y(90)} y2={y(90)} stroke="var(--c-border-strong)" stroke-width="1" stroke-dasharray="3 3" />
			<text x={padL - 7} y={y(90) + 3} text-anchor="end" font-size="9" fill="var(--c-muted)">90'</text>

			{#if multiSeason}
				{#each ranges as r, k (r.year)}
					{#if k > 0}
						<line
							x1={(x(r.startI) + x(r.startI - 1)) / 2}
							x2={(x(r.startI) + x(r.startI - 1)) / 2}
							y1={padT}
							y2={base}
							stroke="var(--c-border)"
							stroke-width="1"
							stroke-dasharray="3 3"
						/>
					{/if}
					<text x={r.midX} y={H - 6} text-anchor="middle" font-size="10" font-weight="700" fill="var(--c-muted)">{r.year}</text>
				{/each}
			{/if}

			{#if hoverIndex != null}
				<line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={padT} y2={base} stroke="var(--c-border-strong)" stroke-width="1" />
			{/if}

			{#each data as d, i (i)}
				{@const h = Math.max(1, base - y(m(d)))}
				{@const on = hoverIndex === i}
				<rect
					x={x(i) - bw / 2}
					y={base - h}
					width={bw}
					height={h}
					rx="1.5"
					fill={on ? 'var(--color-primary-500)' : '#7c8694'}
					opacity={on ? 1 : m(d) >= 60 ? 0.92 : 0.5}
				/>
			{/each}

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
	.mins-chart {
		--c-border: var(--color-gray-200);
		--c-border-strong: var(--color-gray-300);
		--c-muted: var(--color-gray-400);
	}
	:global(.dark) .mins-chart {
		--c-border: var(--color-gray-700);
		--c-border-strong: var(--color-gray-600);
		--c-muted: var(--color-gray-500);
	}
</style>
