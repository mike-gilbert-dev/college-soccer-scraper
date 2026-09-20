<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import {
		splitBracket,
		cardX,
		CARD_W,
		CARD_H,
		COL_STEP,
		CENTRE_GAP,
		type BracketSide,
		type BracketGame,
		type PlacedQuadrant
	} from '$lib/bracket';

	let { data } = $props();

	const split = $derived(splitBracket(data.rounds));
	const sportLabel = $derived(data.gender === 'W' ? "Women's" : "Men's");
	const pageTitle = $derived(
		`${data.seasonLabel} NCAA Division I ${sportLabel} Soccer Tournament Bracket`
	);

	function navigate(params: Record<string, string>) {
		const q = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(params)) q.set(k, v);
		goto(`?${q}`, { keepFocus: true, noScroll: true });
	}

	const nameOf = (s: BracketSide) => s.shortName ?? s.name ?? 'TBD';

	function sideClass(side: BracketSide, status: string): string {
		if (status !== 'final' || side.won === null) return 'text-gray-600 dark:text-gray-300';
		return side.won
			? 'font-semibold text-gray-900 dark:text-white'
			: 'text-gray-400 dark:text-gray-500';
	}

	/** Round names per column, read off whichever quadrant is populated. */
	function roundNames(q: PlacedQuadrant): string[] {
		return Array.from(
			{ length: q.columns },
			(_, c) => q.games.find((g) => g.col === c)?.game.round ?? ''
		);
	}

	/**
	 * Elbow connector from a feeder's inner edge to the exact slot it feeds.
	 * Mirrored quadrants advance leftward, so the edges swap.
	 */
	function elbow(q: PlacedQuadrant, mirrored: boolean, link: { fromGameId: number; toGameId: number; side: 'home' | 'away' }): string {
		const from = q.games.find((g) => g.game.gameId === link.fromGameId);
		const to = q.games.find((g) => g.game.gameId === link.toGameId);
		if (!from || !to) return '';
		const fx = mirrored ? cardX(from, q, true) : cardX(from, q, false) + CARD_W;
		const tx = mirrored ? cardX(to, q, true) + CARD_W : cardX(to, q, false);
		// Meet the slot, not the card's middle — this is what makes a bye read right.
		const ty = to.y + (link.side === 'home' ? -CARD_H / 4 : CARD_H / 4);
		const mx = (fx + tx) / 2;
		return `M ${fx} ${from.y} H ${mx} V ${ty} H ${tx}`;
	}
</script>

<svelte:head>
	<title>{pageTitle} | College Soccer</title>
	<meta
		name="description"
		content="The complete {data.seasonLabel} NCAA Division I {sportLabel} College Cup bracket — every round, score and result."
	/>
</svelte:head>

<!-- One game card. Absolutely positioned by the layout engine, so its height is
     fixed at exactly two slots; the status tag floats above without affecting it. -->
{#snippet card(g: BracketGame, x: number, y: number, mirrored: boolean)}
	<a
		href="/games/{g.ncaaContestId}"
		class="absolute rounded-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800
			overflow-hidden hover:border-primary-500 dark:hover:border-primary-500 transition-colors"
		style="left:{x}px; top:{y - CARD_H / 2}px; width:{CARD_W}px; height:{CARD_H}px"
	>
		{#each [g.home, g.away] as side, i}
			<div
				class="flex items-center gap-1 px-1 text-[11px] leading-none
					{i === 0 ? 'border-b border-gray-100 dark:border-gray-700/60' : ''}
					{sideClass(side, g.status)}"
				style="height:{CARD_H / 2}px"
			>
				<span class="w-2.5 shrink-0 text-[8px] tabular-nums text-gray-400 dark:text-gray-500">
					{side.seed ?? ''}
				</span>
				<TeamLogo
					lightUrl={side.logoLight}
					darkUrl={side.logoDark}
					name={side.name ?? ''}
					size={12}
				/>
				<span class="truncate flex-1">{nameOf(side)}</span>
				{#if side.score !== null}
					<span class="tabular-nums shrink-0 pr-0.5">{side.score}</span>
				{/if}
			</div>
		{/each}
	</a>
	{#if g.shootout}
		<!--
			A shootout is a draw on the scoreline, so the card alone cannot show who
			advanced. The marker sits in the column gutter beside the card rather than
			above it, where it collided with the round header. It goes on the side the
			bracket advances TOWARD, which flips with the quadrant — on the mirrored
			half the outer gutter is the left one, and keeping it right pushed the
			first-round markers off the edge of the board.
		-->
		<span
			class="absolute text-[8px] font-semibold leading-none text-gray-400 dark:text-gray-500 pointer-events-none"
			style="left:{mirrored ? x - 13 : x + CARD_W + 1}px; top:{y - 4}px"
		>PK</span>
	{/if}
{/snippet}

{#snippet quadrant(q: PlacedQuadrant, mirrored: boolean)}
	<div class="relative" style="width:{q.width}px; height:{q.height}px">
		<svg
			class="absolute inset-0 pointer-events-none text-gray-300 dark:text-gray-600"
			width={q.width}
			height={q.height}
			aria-hidden="true"
		>
			{#each q.links as link}
				<path d={elbow(q, mirrored, link)} fill="none" stroke="currentColor" stroke-width="1" />
			{/each}
		</svg>
		{#each q.games as p}
			{@render card(p.game, cardX(p, q, mirrored), p.y, mirrored)}
		{/each}
	</div>
{/snippet}

<div class="space-y-3">
	<!-- Header + controls -->
	<div
		class="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2"
	>
		<h1 class="text-sm font-semibold text-gray-900 dark:text-white">
			NCAA Tournament
			<span class="text-gray-400 dark:text-gray-500 font-normal">· Division I</span>
		</h1>

		<div class="flex gap-1">
			{#each [{ label: 'Men', value: 'M' }, { label: 'Women', value: 'W' }] as g}
				<button
					onclick={() => navigate({ gender: g.value })}
					class="px-2 py-1 text-xs rounded font-semibold transition-colors
						{data.gender === g.value
						? 'bg-primary-500 text-white'
						: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
				>{g.label}</button>
			{/each}
		</div>

		<select
			class="text-xs bg-transparent text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1"
			value={data.seasonLabel}
			onchange={(e) => navigate({ season: (e.target as HTMLSelectElement).value })}
		>
			{#each data.seasons as s}
				<option value={s.label}>{s.label}{s.released ? '' : ' — no bracket'}</option>
			{/each}
		</select>

		{#if data.champion}
			<div class="ml-auto flex items-center gap-2 text-xs">
				<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Champion
				</span>
				<TeamLogo
					lightUrl={data.champion.logoLight}
					darkUrl={data.champion.logoDark}
					name={data.champion.name ?? ''}
					size={18}
				/>
				<span class="font-semibold text-gray-900 dark:text-white">{data.champion.name}</span>
			</div>
		{/if}
	</div>

	{#if data.rounds.length === 0}
		<div
			class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-4 py-10 text-center"
		>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				The {data.seasonLabel} bracket hasn't been released yet.
			</p>
			<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
				It appears here as soon as the NCAA announces the field.
			</p>
		</div>
	{:else if split.mode === 'mirrored'}
		{@const left = split.halves[0]}
		{@const right = split.halves[1]}
		{@const names = roundNames(left.top)}
		<!-- The board is sized to the container, but still scrolls on a phone rather
		     than shrinking the cards past legibility. -->
		<div class="overflow-x-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3">
			<div style="width:{split.width}px">
				<!-- Round headers, mirrored on the right half like the NCAA's own board -->
				<div class="flex text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
					{#each names as n}
						<span class="shrink-0 text-center" style="width:{CARD_W}px; margin-right:{COL_STEP - CARD_W}px">{n}</span>
					{/each}
					<span class="shrink-0" style="width:{CENTRE_GAP - (COL_STEP - CARD_W)}px"></span>
					{#each [...names].reverse() as n}
						<span class="shrink-0 text-center" style="width:{CARD_W}px; margin-right:{COL_STEP - CARD_W}px">{n}</span>
					{/each}
				</div>

				<!-- Top band: left half's top quadrant, right half's top quadrant mirrored -->
				<div class="flex justify-between">
					{@render quadrant(left.top, false)}
					{@render quadrant(right.top, true)}
				</div>

				<!--
					Centre row: each half's semifinal flanking the championship.
					`items-start` matters — the championship column is taller because of
					the champion badge, and centring the three columns would push its
					card out of line with the two semifinals beside it.
				-->
				<div class="flex items-start justify-center gap-5 py-5">
					{#snippet centreSlot(g: BracketGame | null, heading: string, accent: boolean)}
						<div class="flex flex-col items-center gap-1" style="width:{CARD_W}px">
							<span
								class="text-[9px] font-semibold uppercase tracking-wider leading-none h-3
									{accent
									? 'text-primary-600 dark:text-primary-400'
									: 'text-gray-400 dark:text-gray-500'}"
							>{heading}</span>
							<div class="relative" style="width:{CARD_W}px; height:{CARD_H}px">
								{#if g}{@render card(g, 0, CARD_H / 2, false)}{/if}
							</div>
						</div>
					{/snippet}

					{@render centreSlot(left.semifinal, 'Semifinal', false)}

					<div class="flex flex-col items-center" style="width:{CARD_W}px">
						{@render centreSlot(split.final, 'Championship', true)}
						{#if data.champion}
							<div
								class="mt-2 flex items-center gap-1.5 rounded border border-primary-500/40 bg-primary-500/5 px-2 py-1"
							>
								<TeamLogo
									lightUrl={data.champion.logoLight}
									darkUrl={data.champion.logoDark}
									name={data.champion.name ?? ''}
									size={14}
								/>
								<span class="text-[11px] font-semibold text-gray-900 dark:text-white whitespace-nowrap">
									{data.champion.name}
								</span>
							</div>
						{/if}
					</div>

					{@render centreSlot(right.semifinal, 'Semifinal', false)}
				</div>

				<!-- Bottom band -->
				<div class="flex justify-between">
					{@render quadrant(left.bottom, false)}
					{@render quadrant(right.bottom, true)}
				</div>
			</div>
		</div>
	{:else}
		<!-- Before the quarterfinals exist there is no tree to fold, so the board
		     stays a plain set of columns. Few enough games that it fits. -->
		<div class="overflow-x-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3">
			<div class="flex gap-3 min-w-max">
				{#each split.rounds as round}
					<div class="flex flex-col shrink-0" style="width:{CARD_W}px">
						<p class="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 text-center">
							{round.round}
						</p>
						<div class="flex flex-col justify-around flex-1 gap-2">
							{#each round.games as g}
								<div class="relative" style="height:{CARD_H}px">
									{@render card(g, 0, CARD_H / 2, false)}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
