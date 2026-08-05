<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const myUsername = $derived(page.data.username as string | null);

	function navigate(overrides: Record<string, string> = {}) {
		const sp = new URLSearchParams({
			season: data.seasonLabel,
			sport: data.sportCode,
			board: data.board,
			...overrides
		});
		goto(`?${sp}`);
	}

	const pct = (v: number | null | undefined) =>
		v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`;

	const sportLabel = $derived(data.sportCode === 'WSO' ? "Women's" : "Men's");
	const hasPrev = $derived(data.page > 1);
	const hasNext = $derived(data.rows.length === data.pageSize);

	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(
		`Pick'em Leaderboard — NCAA ${sportLabel} DI Soccer ${data.seasonLabel} | CollegeSoccer.IO`
	);
	const pageDesc = $derived(
		`Who predicts NCAA ${sportLabel.toLowerCase()} Division I college soccer results best? Season ${data.seasonLabel} Pick'em standings by total wins and win percentage.`
	);
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

<div class="flex flex-col gap-3">
	<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 class="text-lg font-bold text-gray-900 dark:text-white">Pick'em Leaderboard</h1>
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
					{data.seasonLabel} · {sportLabel} DI · records are kept separately per sport
				</p>
			</div>

			<div class="flex items-center gap-2">
				<select
					class="text-xs bg-transparent text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1"
					value={data.sportCode}
					onchange={(e) => navigate({ sport: (e.target as HTMLSelectElement).value, page: '1' })}
				>
					<option value="MSO">Men's</option>
					<option value="WSO">Women's</option>
				</select>
				<select
					class="text-xs bg-transparent text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1"
					value={data.seasonLabel}
					onchange={(e) => navigate({ season: (e.target as HTMLSelectElement).value, page: '1' })}
				>
					{#each data.seasons as s (s.id)}
						<option value={s.label}>{s.label}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Board tabs -->
		<div class="flex gap-1 mt-3">
			{#each [{ key: 'wins', label: 'Most Wins' }, { key: 'pct', label: 'Best Win %' }] as b (b.key)}
				<button
					onclick={() => navigate({ board: b.key, page: '1' })}
					class="px-3 py-1.5 text-xs rounded font-semibold transition-colors
						{data.board === b.key
							? 'bg-primary-500 text-white'
							: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
				>{b.label}</button>
			{/each}
		</div>

		{#if data.board === 'pct'}
			<p class="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
				Requires {data.minPicks} graded picks this season to qualify. Voided games (cancelled)
				don't count toward your percentage.
			</p>
		{/if}

		<!-- Personal strip -->
		{#if data.position}
			<div class="mt-3 rounded bg-gray-50 dark:bg-gray-900/60 px-3 py-2 text-xs">
				{#if data.position.qualified && data.position.rank}
					<span class="text-gray-600 dark:text-gray-400">
						You're
						<span class="font-bold text-gray-900 dark:text-white">#{data.position.rank}</span>
						of {data.position.total_ranked} with
						<span class="font-semibold text-gray-800 dark:text-gray-200">
							{data.position.wins}–{data.position.losses}
						</span>
						({pct(data.position.win_pct)})
					</span>
				{:else}
					<span class="text-gray-600 dark:text-gray-400">
						You're at
						<span class="font-semibold text-gray-800 dark:text-gray-200">
							{data.position.wins}–{data.position.losses}
						</span>
						· {data.position.picks_needed} more graded
						{data.position.picks_needed === 1 ? 'pick' : 'picks'} to qualify for this board
					</span>
				{/if}
			</div>
		{/if}
	</section>

	<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
		{#if data.rows.length === 0}
			<div class="py-12 text-center px-4">
				<p class="text-sm font-semibold text-gray-800 dark:text-gray-200">Nobody on the board yet</p>
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
					Pick the winner — or the draw — on any upcoming game from the scoreboard. Picks lock at
					kickoff and grade themselves once the game is final.
				</p>
				<a
					href="/scores"
					class="inline-block mt-4 px-3 py-1.5 rounded bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-colors"
				>Make your first picks</a>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-xs">
					<thead>
						<tr class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
							<th class="text-left font-semibold px-4 py-2 w-12">#</th>
							<th class="text-left font-semibold px-2 py-2">User</th>
							<th class="text-right font-semibold px-2 py-2">W</th>
							<th class="text-right font-semibold px-2 py-2">L</th>
							<th class="text-right font-semibold px-2 py-2">Win %</th>
							<th class="text-right font-semibold px-4 py-2">Graded</th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as row (row.user_id)}
							{@const isMe = myUsername?.toLowerCase() === row.username?.toLowerCase()}
							<tr
								class="border-b border-gray-100 dark:border-gray-700/50 last:border-0
									{isMe ? 'bg-primary-50 dark:bg-primary-900/20' : ''}"
							>
								<td class="px-4 py-2 tabular-nums font-bold text-gray-400 dark:text-gray-500">
									{row.rank}
								</td>
								<td class="px-2 py-2">
									<a
										href="/u/{row.username}?season={data.seasonLabel}&sport={data.sportCode}"
										class="font-semibold hover:underline
											{isMe
												? 'text-primary-700 dark:text-primary-300'
												: 'text-gray-800 dark:text-gray-200'}"
									>@{row.username}</a>
									{#if isMe}
										<span class="ml-1 text-[9px] uppercase tracking-wide text-primary-600 dark:text-primary-400">you</span>
									{/if}
								</td>
								<td class="px-2 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.wins}</td>
								<td class="px-2 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{row.losses}</td>
								<td class="px-2 py-2 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-200">
									{pct(row.win_pct)}
								</td>
								<td class="px-4 py-2 text-right tabular-nums text-gray-400 dark:text-gray-500">{row.graded}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if hasPrev || hasNext}
				<div class="flex items-center justify-between gap-2 px-4 py-2 border-t border-gray-200 dark:border-gray-700">
					<button
						onclick={() => navigate({ page: String(data.page - 1) })}
						disabled={!hasPrev}
						class="px-3 py-1 text-xs rounded bg-primary-500 text-white font-semibold hover:bg-primary-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
					>‹ Prev</button>
					<span class="text-[11px] text-gray-400 dark:text-gray-500">Page {data.page}</span>
					<button
						onclick={() => navigate({ page: String(data.page + 1) })}
						disabled={!hasNext}
						class="px-3 py-1 text-xs rounded bg-primary-500 text-white font-semibold hover:bg-primary-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
					>Next ›</button>
				</div>
			{/if}
		{/if}
	</section>
</div>
