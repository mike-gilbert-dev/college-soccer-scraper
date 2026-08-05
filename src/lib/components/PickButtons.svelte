<script lang="ts">
	// The pick'em affordance: one full-width row per outcome, stacked under a game
	// card while the sidebar Pick'em toggle is on.
	//
	// The same three rows serve before and after kickoff — that's the point. While
	// the game is open they're buttons; once it locks they become static rows that
	// colour the result: green for a correct pick, red for a wrong one, and a
	// neutral outline on whichever outcome actually happened.
	//
	// The card body is a role="link" that navigates to the box score, so every
	// button here MUST stopPropagation or picking also navigates.
	import type { PickOutcome, PickResult } from '$lib/picks';

	let {
		away,
		home,
		selected = null,
		open = true,
		actual = null,
		result = null,
		busy = false,
		onpick
	}: {
		/** Away team name — the row label. */
		away: string;
		/** Home team name — the row label. */
		home: string;
		/** The user's current pick for this game, if any. */
		selected?: PickOutcome | null;
		/** Open games are pickable; locked ones render as static result rows. */
		open?: boolean;
		/** The outcome that actually happened, once the game is decided. */
		actual?: PickOutcome | null;
		/** Grade of the user's pick, once graded. */
		result?: PickResult | null;
		busy?: boolean;
		/** Null clears the pick. Parent handles optimistic update + revert. */
		onpick: (next: PickOutcome | null) => void;
	} = $props();

	const options = $derived([
		{ outcome: 'away' as PickOutcome, label: away },
		{ outcome: 'draw' as PickOutcome, label: 'Draw' },
		{ outcome: 'home' as PickOutcome, label: home }
	]);

	function handle(event: MouseEvent, outcome: PickOutcome) {
		event.stopPropagation();
		if (busy) return;
		// Clicking the selected outcome clears it.
		onpick(selected === outcome ? null : outcome);
	}

	/**
	 * Colour for a locked row. A graded pick wins the tie against `actual` — the
	 * pick IS the winning row on a correct pick, and "you were right" is the more
	 * useful thing to say there than "this team won".
	 */
	function lockedClass(isSelected: boolean, isWinner: boolean): string {
		if (isSelected) {
			if (result === 'win')
				return 'border-green-500 bg-green-50 text-green-700 dark:border-green-500/60 dark:bg-green-500/10 dark:text-green-400';
			if (result === 'loss')
				return 'border-red-500 bg-red-50 text-red-700 dark:border-red-500/60 dark:bg-red-500/10 dark:text-red-400';
			// Void, or locked but not yet decided.
			return 'border-gray-400 bg-gray-50 text-gray-600 dark:border-gray-500 dark:bg-gray-700/40 dark:text-gray-300';
		}
		if (isWinner)
			return 'border-gray-300 bg-gray-50 text-gray-800 dark:border-gray-500 dark:bg-gray-700/40 dark:text-gray-200';
		return 'border-transparent bg-gray-100 text-gray-500 dark:bg-gray-700/30 dark:text-gray-400';
	}

	/** Trailing badge on a locked row. */
	function lockedBadge(isSelected: boolean, isWinner: boolean): string {
		if (isSelected) {
			if (result === 'win')  return 'Your pick · Won';
			if (result === 'void') return 'Your pick · Void';
			return 'Your pick';
		}
		return isWinner ? 'Winner' : '';
	}
</script>

<div class="flex flex-col gap-1.5">
	{#each options as option (option.outcome)}
		{@const isSelected = selected === option.outcome}
		{@const isWinner = actual === option.outcome}
		{#if open}
			<button
				type="button"
				onclick={(e) => handle(e, option.outcome)}
				onkeydown={(e) => e.stopPropagation()}
				disabled={busy}
				aria-pressed={isSelected}
				aria-label={isSelected ? `Clear your ${option.label} pick` : `Pick ${option.label}`}
				class="flex w-full min-h-8 items-center gap-2 rounded border px-2
					text-[11px] font-semibold transition-colors disabled:opacity-50
					{isSelected
						? 'border-primary-500 bg-primary-500 text-white hover:bg-primary-600'
						: 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400'}"
			>
				<span
					aria-hidden="true"
					class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] leading-none
						{isSelected ? 'bg-white text-primary-500' : 'border-[1.5px] border-current'}"
				>{isSelected ? '✓' : ''}</span>
				<span class="truncate">{option.label}</span>
			</button>
		{:else}
			{@const badge = lockedBadge(isSelected, isWinner)}
			<div
				class="flex w-full min-h-8 items-center gap-2 rounded border px-2 text-[11px] font-semibold
					{lockedClass(isSelected, isWinner)}"
			>
				<span aria-hidden="true" class="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
					<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
				</span>
				<span class="truncate">{option.label}</span>
				{#if badge}
					<span class="ml-auto shrink-0 text-[9px] uppercase tracking-wide">{badge}</span>
				{/if}
			</div>
		{/if}
	{/each}
</div>
