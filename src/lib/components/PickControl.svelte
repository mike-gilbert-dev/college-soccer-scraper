<script lang="ts">
	// One pick affordance for one outcome of one game.
	//
	// The scoreboard composes three of these per card: 'away' on the away row,
	// 'draw' in a divider between the rows, and 'home' on the home row. Keeping
	// it to a single control means the parent stays in charge of layout.
	//
	// The card body is a role="link" that navigates to the box score, so every
	// interactive element here MUST stopPropagation or picking also navigates.
	import type { PickOutcome, PickResult } from '$lib/picks';

	let {
		outcome,
		selected = null,
		result = null,
		open,
		signedIn,
		label,
		busy = false,
		onpick
	}: {
		/** Which outcome this control represents. */
		outcome: PickOutcome;
		/** The user's current pick for this game, if any. */
		selected?: PickOutcome | null;
		result?: PickResult | null;
		/** Whether the game can still be picked (kickoff hasn't passed). */
		open: boolean;
		signedIn: boolean;
		/** Team name, or "Draw" — used for the accessible label. */
		label: string;
		busy?: boolean;
		/** Null clears the pick. Parent handles optimistic update + revert. */
		onpick: (next: PickOutcome | null) => void;
	} = $props();

	const isSelected = $derived(selected === outcome);
	const pickable = $derived(open && signedIn);

	function handle(event: MouseEvent) {
		event.stopPropagation();
		if (!pickable || busy) return;
		// Clicking the selected outcome clears it.
		onpick(isSelected ? null : outcome);
	}
</script>

{#if pickable}
	<button
		type="button"
		onclick={handle}
		onkeydown={(e) => e.stopPropagation()}
		disabled={busy}
		aria-pressed={isSelected}
		aria-label={isSelected ? `Clear your ${label} pick` : `Pick ${label}`}
		class="shrink-0 min-w-14 min-h-8 px-2 rounded text-[11px] font-semibold transition-colors
			disabled:opacity-50
			{isSelected
				? 'bg-primary-500 text-white hover:bg-primary-600'
				: 'border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400'}"
	>
		{isSelected ? 'Picked' : 'Pick'}
	</button>
{:else if isSelected}
	<!-- Locked: keep the pick visible, with its result once graded. -->
	<span
		class="shrink-0 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide
			text-primary-600 dark:text-primary-400"
		title="Your pick"
	>
		Your pick
		{#if result === 'win'}
			<span class="text-green-600 dark:text-green-400" title="Correct">✓</span>
		{:else if result === 'loss'}
			<span class="text-red-600 dark:text-red-400" title="Incorrect">✗</span>
		{:else if result === 'void'}
			<span class="text-gray-400 dark:text-gray-500" title="Game cancelled — pick voided">void</span>
		{/if}
	</span>
{/if}
