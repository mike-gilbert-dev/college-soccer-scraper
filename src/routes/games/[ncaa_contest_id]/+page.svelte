<script lang="ts">
	import { Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell } from 'flowbite-svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import type { PageData } from './$types';
	import type { PlayerStat } from './+page.server';

	let { data }: { data: PageData } = $props();

	const game       = $derived(data.game);
	const homeTeam   = $derived(data.homeTeam);
	const awayTeam   = $derived(data.awayTeam);
	const sport      = $derived(data.sport);
	const division   = $derived(data.division);
	const seasonYear = $derived(data.seasonYear);
	const fromTeam   = $derived(data.fromTeam);

	// Start on the tab for the team the user came from; default to away
	let activeTab = $state<'away' | 'home'>(
		data.fromTeam === data.homeTeam?.ncaa_team_id ? 'home' : 'away'
	);

	const posOrder: Record<string, number> = { GK: 0, D: 1, M: 2, F: 3 };

	function sortStats(stats: PlayerStat[]) {
		return [...stats].sort((a, b) => {
			if (a.starter !== b.starter) return a.starter ? -1 : 1;
			const pa = posOrder[a.position ?? ''] ?? 9;
			const pb = posOrder[b.position ?? ''] ?? 9;
			return pa - pb;
		});
	}

	const sortedHome = $derived(sortStats(data.homeStats));
	const sortedAway = $derived(sortStats(data.awayStats));

	function formatDate(iso: string) {
		return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
			weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
		});
	}

	function playerHref(ncaaPlayerId: string) {
		return `/players/${ncaaPlayerId}?sport=${sport}&division=${division}&season=${seasonYear}`;
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${sport}&division=${division}&season=${seasonYear}`;
	}

	function dash(v: number | null | undefined) {
		return v == null ? '—' : String(v);
	}

	const backHref = $derived(
		fromTeam
			? `/teams/${fromTeam}?sport=${sport}&division=${division}&season=${seasonYear}`
			: `/teams?sport=${sport}&division=${division}&season=${seasonYear}`
	);

	const backLabel = $derived(
		fromTeam === homeTeam?.ncaa_team_id ? homeTeam?.name
		: fromTeam === awayTeam?.ncaa_team_id ? awayTeam?.name
		: 'Teams'
	);

	const statusLabel = $derived(
		game.status === 'final' ? 'Final'
		: game.status === 'in_progress' ? 'In Progress'
		: 'Scheduled'
	);
</script>

<div class="space-y-6 max-w-4xl">
	<!-- Back link -->
	<a href={backHref}
		class="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 block">
		← {backLabel}
	</a>

	<!-- Game header -->
	<div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 pt-4 pb-5">
		<p class="text-xs text-gray-500 dark:text-gray-400 mb-4">{formatDate(game.contest_date)}</p>

		<div class="flex items-center gap-4">
			<!-- Away team -->
			<div class="flex-1 flex items-center justify-end gap-3 min-w-0">
				<div class="text-right min-w-0">
					{#if awayTeam}
						<a href={teamHref(awayTeam.ncaa_team_id)}
							class="text-sm font-semibold text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 block truncate">
							{awayTeam.name}
						</a>
					{:else}
						<span class="text-sm font-semibold text-gray-900 dark:text-white">Away</span>
					{/if}
					<p class="text-[11px] text-gray-400 dark:text-gray-500">Away</p>
				</div>
				{#if awayTeam?.logo_url_dark || awayTeam?.logo_url_light}
					<div class="shrink-0 w-10 h-10 flex items-center justify-center">
						<TeamLogo
							lightUrl={awayTeam.logo_url_light}
							darkUrl={awayTeam.logo_url_dark}
							name={awayTeam.name}
							size={40}
						/>
					</div>
				{/if}
			</div>

			<!-- Score -->
			<div class="text-center shrink-0 px-2">
				{#if game.home_score != null && game.away_score != null}
					<p class="text-2xl font-bold font-mono text-gray-900 dark:text-white tracking-wider">
						{game.away_score} – {game.home_score}
					</p>
				{:else}
					<p class="text-2xl font-bold text-gray-400">vs</p>
				{/if}
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{statusLabel}</p>
			</div>

			<!-- Home team -->
			<div class="flex-1 flex items-center gap-3 min-w-0">
				{#if homeTeam?.logo_url_dark || homeTeam?.logo_url_light}
					<div class="shrink-0 w-10 h-10 flex items-center justify-center">
						<TeamLogo
							lightUrl={homeTeam.logo_url_light}
							darkUrl={homeTeam.logo_url_dark}
							name={homeTeam.name}
							size={40}
						/>
					</div>
				{/if}
				<div class="text-left min-w-0">
					{#if homeTeam}
						<a href={teamHref(homeTeam.ncaa_team_id)}
							class="text-sm font-semibold text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 block truncate">
							{homeTeam.name}
						</a>
					{:else}
						<span class="text-sm font-semibold text-gray-900 dark:text-white">Home</span>
					{/if}
					<p class="text-[11px] text-gray-400 dark:text-gray-500">Home</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Player stats -->
	{#if data.homeStats.length === 0 && data.awayStats.length === 0}
		<p class="text-sm text-gray-500 dark:text-gray-400">
			No player stats for this game yet. Run the backfill with "Include player stats" to populate.
		</p>
	{:else}
		<!-- Team tabs -->
		<div class="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
			{#each [
				{ side: 'away' as const, team: awayTeam, count: sortedAway.length },
				{ side: 'home' as const, team: homeTeam, count: sortedHome.length }
			] as t}
				{@const isActive = activeTab === t.side}
				{@const hasColor = isActive && !!t.team?.team_color}
				<button
					class="flex-1 flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-medium transition-colors
						{isActive
							? hasColor ? 'text-white' : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
							: 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750'}"
					style={hasColor ? `background-color: ${t.team!.team_color};` : ''}
					onclick={() => (activeTab = t.side)}
				>
					{#if t.team?.logo_url_dark || t.team?.logo_url_light}
						<span class="shrink-0 w-7 h-7 flex items-center justify-center">
							<TeamLogo
								lightUrl={hasColor ? null : (t.team?.logo_url_light ?? null)}
								darkUrl={t.team?.logo_url_dark ?? t.team?.logo_url_light ?? null}
								name={t.team?.name ?? ''}
								size={28}
							/>
						</span>
					{/if}
					<span class="truncate">{t.team?.name ?? (t.side === 'away' ? 'Away' : 'Home')}</span>
					{#if t.count > 0}
						<span class="text-[11px] shrink-0 {hasColor ? 'text-white/60' : 'text-gray-400 dark:text-gray-500'}">
							{t.count}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Active team's stats table -->
		{#each [
			{ side: 'away' as const, stats: sortedAway },
			{ side: 'home' as const, stats: sortedHome }
		] as t}
			{#if activeTab === t.side}
				{#if t.stats.length === 0}
					<p class="text-xs text-gray-500 dark:text-gray-400">No stats recorded for this team.</p>
				{:else}
					<div class="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
						<Table hoverable striped class="text-xs whitespace-nowrap">
							<TableHead class="text-[11px] uppercase tracking-wide">
								<TableHeadCell class="py-2 w-8">#</TableHeadCell>
								<TableHeadCell class="py-2">Name</TableHeadCell>
								<TableHeadCell class="py-2">Pos</TableHeadCell>
								<TableHeadCell class="py-2 text-center">GS</TableHeadCell>
								<TableHeadCell class="py-2 text-right">Min</TableHeadCell>
								<TableHeadCell class="py-2 text-right">G</TableHeadCell>
								<TableHeadCell class="py-2 text-right">A</TableHeadCell>
								<TableHeadCell class="py-2 text-right">Sh</TableHeadCell>
								<TableHeadCell class="py-2 text-right">SOG</TableHeadCell>
								<TableHeadCell class="py-2 text-right">FC</TableHeadCell>
								<TableHeadCell class="py-2 text-right">YC</TableHeadCell>
								<TableHeadCell class="py-2 text-right">RC</TableHeadCell>
								<TableHeadCell class="py-2 text-right">Sv</TableHeadCell>
								<TableHeadCell class="py-2 text-right">GA</TableHeadCell>
								<TableHeadCell class="py-2 text-right">ShO</TableHeadCell>
							</TableHead>
							<TableBody>
								{#each t.stats as p}
									<TableBodyRow>
										<TableBodyCell class="py-1.5 text-gray-500">{p.jersey_number ?? '—'}</TableBodyCell>
										<TableBodyCell class="py-1.5 font-medium">
											<a href={playerHref(p.ncaa_player_id)}
												class="text-primary-600 dark:text-primary-400 hover:underline">
												{p.player_name}
											</a>
										</TableBodyCell>
										<TableBodyCell class="py-1.5">{p.position ?? '—'}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-center">{p.starter ? '●' : ''}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{dash(p.minutes_played)}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right font-semibold">{p.goals}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{p.assists}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{p.shots}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{p.shots_on_goal}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{p.fouls_committed || '—'}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{p.yellow_cards || '—'}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{p.red_cards || '—'}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{dash(p.gk_saves)}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{dash(p.gk_goals_against)}</TableBodyCell>
										<TableBodyCell class="py-1.5 text-right">{p.gk_shutout === true ? '✓' : '—'}</TableBodyCell>
									</TableBodyRow>
								{/each}
							</TableBody>
						</Table>
					</div>
				{/if}
			{/if}
		{/each}
	{/if}
</div>
