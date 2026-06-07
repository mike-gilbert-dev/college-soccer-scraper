<script lang="ts">
	import { goto } from '$app/navigation';
	import { Badge } from 'flowbite-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type TeamInfo   = { name: string; short_name: string; ncaa_team_id: string };
	type ConfInfo   = { name: string; short_name: string } | null;
	type TeamSeason = { team: TeamInfo; conference: ConfInfo } | null;
	type Game = {
		id: number;
		ncaa_contest_id: string;
		contest_date: string;
		start_time: string | null;
		home_score: number | null;
		away_score: number | null;
		status: string;
		neutral_site: boolean;
		broadcaster_name: string | null;
		round_description: string | null;
		home_team_season: TeamSeason;
		away_team_season: TeamSeason;
	};

	const games           = $derived(data.games as unknown as Game[]);
	const contestDate     = $derived(data.contestDate);
	const gender          = $derived(data.gender);
	const division        = $derived(data.division);
	const seasonYear      = $derived(data.seasonYear);
	const sportCode       = $derived(gender === 'W' ? 'WSO' : 'MSO');

	function gameHref(ncaaContestId: string) {
		return `/games/${ncaaContestId}?sport=${sportCode}&division=${division}&season=${seasonYear}`;
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${sportCode}&division=${division}&season=${seasonYear}`;
	}

	// Always build the full URL from current state so no param ever gets dropped.
	function navigate(overrides: Record<string, string | number> = {}) {
		const sp = new URLSearchParams({
			gender,
			division: String(division),
			season:   String(seasonYear),
			date:     contestDate ?? '',
			...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)]))
		});
		goto(`?${sp}`);
	}

	function shiftDate(days: number) {
		const d = new Date((contestDate ?? '') + 'T00:00:00Z');
		d.setUTCDate(d.getUTCDate() + days);
		navigate({ date: d.toISOString().slice(0, 10) });
	}

	function navigateSeason(year: number) {
		// Omit date so the server picks the right default for the new season's range.
		const sp = new URLSearchParams({
			gender,
			division: String(division),
			season:   String(year)
		});
		goto(`?${sp}`);
	}

	function formatTime(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleTimeString('en-US', {
			hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
		});
	}

	function statusColor(s: string) {
		if (s === 'final') return 'dark';
		if (s === 'live')  return 'red';
		return 'gray';
	}

	function statusLabel(s: string) {
		if (s === 'final')     return 'Final';
		if (s === 'live')      return 'Live';
		if (s === 'postponed') return 'PPD';
		if (s === 'cancelled') return 'CXLD';
		return 'Sched';
	}

	const divisions = [
		{ label: 'Division I',   value: 1 },
		{ label: 'Division II',  value: 2 },
		{ label: 'Division III', value: 3 }
	];

	const seasons = [2025, 2024];

	const displayDate = $derived(
		new Date(contestDate + 'T00:00:00Z').toLocaleDateString('en-US', {
			weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
		})
	);
</script>

<div class="flex gap-2 items-start">
	<!-- Left sidebar -->
	<aside class="w-44 shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
		<!-- Gender toggle -->
		<div class="border-b border-gray-200 dark:border-gray-700 p-2 flex gap-1">
			{#each [{ label: 'Men', value: 'M' }, { label: 'Women', value: 'W' }] as g}
				<button
					onclick={() => navigate({ gender: g.value })}
					class="flex-1 text-xs py-1 rounded font-semibold transition-colors
						{gender === g.value
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
				onchange={(e) => navigateSeason(parseInt((e.target as HTMLSelectElement).value))}
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

	<!-- Scores panel -->
	<section class="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
		<!-- Date picker header -->
		<div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
			<button
				onclick={() => shiftDate(-1)}
				aria-label="Previous day"
				class="shrink-0 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary-500 hover:text-primary-500 transition-colors text-sm leading-none"
			>‹</button>

			<span class="flex-1 text-xs font-semibold text-gray-700 dark:text-gray-300 text-center">{displayDate}</span>

			<button
				onclick={() => shiftDate(1)}
				aria-label="Next day"
				class="shrink-0 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary-500 hover:text-primary-500 transition-colors text-sm leading-none"
			>›</button>

			<input
				type="date"
				value={contestDate}
				onchange={(e) => navigate({ date: (e.target as HTMLInputElement).value })}
				class="shrink-0 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
					border border-gray-200 dark:border-gray-600 rounded px-2 py-1
					focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500
					[color-scheme:light] dark:[color-scheme:dark]"
			/>
		</div>

		<!-- Game list -->
		{#if data.gamesError}
			<div class="py-8 text-center px-4">
				<p class="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">Query error</p>
				<p class="text-xs font-mono text-red-500 dark:text-red-400 break-all">{data.gamesError}</p>
			</div>
		{:else if games.length === 0}
			<div class="py-12 text-center">
				<p class="text-sm font-semibold text-gray-800 dark:text-gray-200">No games found</p>
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
					No {gender === 'W' ? "women's" : "men's"} Division {division} games on {contestDate}.
				</p>
			</div>
		{:else}
			<ul>
				{#each games as game}
					{@const home = game.home_team_season}
					{@const away = game.away_team_season}
					{@const isFinal = game.status === 'final'}
					{@const isLive  = game.status === 'live'}
					{@const homeWon = isFinal && game.home_score != null && game.away_score != null && game.home_score > game.away_score}
					{@const awayWon = isFinal && game.home_score != null && game.away_score != null && game.away_score > game.home_score}

					<li class="border-b border-gray-100 dark:border-gray-700/60 last:border-0 transition-colors">
						<div role="link" tabindex="0"
							onclick={() => goto(gameHref(game.ncaa_contest_id))}
							onkeydown={(e) => e.key === 'Enter' && goto(gameHref(game.ncaa_contest_id))}
							class="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer">
							<!-- Status / time -->
							<div class="w-14 shrink-0 text-right">
								{#if isFinal || isLive}
									<Badge color={statusColor(game.status)} class="text-[10px] px-1.5 py-0 font-semibold">
										{statusLabel(game.status)}
									</Badge>
								{:else}
									<span class="text-[11px] text-gray-400 dark:text-gray-500">
										{formatTime(game.start_time)}
									</span>
								{/if}
							</div>

							<!-- Teams + scores -->
							<div class="flex-1 min-w-0 space-y-0.5">
								<!-- Round / broadcaster -->
								{#if game.round_description || game.broadcaster_name}
									<div class="flex items-center gap-1.5 mb-0.5">
										{#if game.round_description}
											<span class="text-[10px] font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide">{game.round_description}</span>
										{/if}
										{#if game.round_description && game.broadcaster_name}
											<span class="text-[10px] text-gray-300 dark:text-gray-600">·</span>
										{/if}
										{#if game.broadcaster_name}
											<span class="text-[10px] text-gray-400 dark:text-gray-500">{game.broadcaster_name}</span>
										{/if}
									</div>
								{/if}
								<!-- Away -->
								<div class="flex items-center justify-between gap-2">
									<a href={away?.team.ncaa_team_id ? teamHref(away.team.ncaa_team_id) : '#'}
										onclick={(e) => e.stopPropagation()}
										class="text-xs truncate hover:underline
											{awayWon ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}">
										{away?.team.name ?? '—'}
									</a>
									{#if game.away_score != null}
										<span class="text-xs font-bold tabular-nums
											{awayWon ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">
											{game.away_score}
										</span>
									{/if}
								</div>
								<!-- Home -->
								<div class="flex items-center justify-between gap-2">
									<a href={home?.team.ncaa_team_id ? teamHref(home.team.ncaa_team_id) : '#'}
										onclick={(e) => e.stopPropagation()}
										class="text-xs truncate hover:underline
											{homeWon ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}">
										{home?.team.name ?? '—'}
										{#if !game.neutral_site}
											<span class="text-[10px] text-gray-400 dark:text-gray-500 font-normal"> (H)</span>
										{/if}
									</a>
									{#if game.home_score != null}
										<span class="text-xs font-bold tabular-nums
											{homeWon ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">
											{game.home_score}
										</span>
									{/if}
								</div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
