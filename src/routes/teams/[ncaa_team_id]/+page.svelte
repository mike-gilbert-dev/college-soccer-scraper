<script lang="ts">
	import { goto } from '$app/navigation';
	import { Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell } from 'flowbite-svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const team           = $derived(data.team);
	const teamSeason     = $derived(data.teamSeason);
	const conferenceName = $derived(data.conferenceName);
	const sport          = $derived(data.sport);
	const division       = $derived(data.division);
	const seasonYear     = $derived(data.seasonYear);

	const seasons = [2025, 2024];

	function navigateSeason(year: number) {
		const sp = new URLSearchParams({ sport, division: String(division), season: String(year) });
		goto(`/teams/${team.ncaa_team_id}?${sp}`);
	}

	const posOrder: Record<string, number> = { GK: 0, D: 1, M: 2, F: 3 };

	const sortedPlayers = $derived(
		[...data.players].sort((a, b) => {
			const pa = posOrder[a.position ?? ''] ?? 9;
			const pb = posOrder[b.position ?? ''] ?? 9;
			if (pa !== pb) return pa - pb;
			return (b.goals ?? 0) - (a.goals ?? 0);
		})
	);

	function playerHref(ncaaPlayerId: string) {
		return `/players/${ncaaPlayerId}?sport=${sport}&division=${division}&season=${seasonYear}`;
	}

	function gameHref(ncaaContestId: string) {
		return `/games/${ncaaContestId}?sport=${sport}&division=${division}&season=${seasonYear}&from=${team.ncaa_team_id}`;
	}

	function dash(v: number | null | undefined) {
		return v == null ? '—' : String(v);
	}

	function formatDate(iso: string) {
		return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', timeZone: 'UTC'
		});
	}

	type ScheduleGame = typeof data.schedule[number];

	function isHome(game: ScheduleGame) {
		return game.home_team_season_id === teamSeason?.id;
	}

	function opponent(game: ScheduleGame) {
		return isHome(game)
			? game.away_team_season?.team
			: game.home_team_season?.team;
	}

	function result(game: ScheduleGame): 'W' | 'L' | 'T' | null {
		if (game.home_score == null || game.away_score == null) return null;
		const myScore  = isHome(game) ? game.home_score : game.away_score;
		const oppScore = isHome(game) ? game.away_score : game.home_score;
		if (myScore > oppScore) return 'W';
		if (myScore < oppScore) return 'L';
		return 'T';
	}

	function scoreDisplay(game: ScheduleGame) {
		if (game.home_score == null || game.away_score == null) return '—';
		const myScore  = isHome(game) ? game.home_score : game.away_score;
		const oppScore = isHome(game) ? game.away_score : game.home_score;
		return `${myScore}–${oppScore}`;
	}

	const resultClasses: Record<string, string> = {
		W: 'text-green-600 dark:text-green-400 font-bold',
		L: 'text-red-600 dark:text-red-400 font-bold',
		T: 'text-gray-500 dark:text-gray-400 font-bold'
	};
</script>

<div class="space-y-6">
	<!-- Header row -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<a href="/teams?sport={sport}&division={division}&season={seasonYear}"
				class="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 mb-2 block">
				← Teams
			</a>
			<div class="flex items-center gap-3">
				{#if team.logo_url_dark || team.logo_url_light}
					<div class="w-12 h-12 shrink-0 flex items-center justify-center">
						<TeamLogo
							lightUrl={team.logo_url_light}
							darkUrl={team.logo_url_dark}
							name={team.name}
							size={48}
						/>
					</div>
				{/if}
				<div>
					<h1 class="text-lg font-bold text-gray-900 dark:text-white">{team.name}</h1>
					{#if conferenceName}
						<p class="text-xs text-gray-500 dark:text-gray-400">{conferenceName}</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Season selector -->
		<div class="shrink-0">
			<p class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Season</p>
			<select
				class="text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
				value={seasonYear}
				onchange={(e) => navigateSeason(parseInt((e.target as HTMLSelectElement).value))}
			>
				{#each seasons as y}
					<option value={y}>{y}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Roster table -->
	<div>
		<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Roster</h2>

		{#if !teamSeason}
			<p class="text-sm text-gray-500 dark:text-gray-400">
				No team data found for the {seasonYear} season.
			</p>
		{:else if sortedPlayers.length === 0}
			<p class="text-sm text-gray-500 dark:text-gray-400">
				No player stats available for this season yet. Run the backfill with "Include player stats" to populate.
			</p>
		{:else}
			<div class="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
				<Table hoverable striped class="text-xs whitespace-nowrap">
					<TableHead class="text-[11px] uppercase tracking-wide">
						<TableHeadCell class="py-2 w-8">#</TableHeadCell>
						<TableHeadCell class="py-2">Name</TableHeadCell>
						<TableHeadCell class="py-2">Pos</TableHeadCell>
						<TableHeadCell class="py-2">Yr</TableHeadCell>
						<TableHeadCell class="py-2 text-right">GP</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Min</TableHeadCell>
						<TableHeadCell class="py-2 text-right">G</TableHeadCell>
						<TableHeadCell class="py-2 text-right">A</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Pts</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Sh</TableHeadCell>
						<TableHeadCell class="py-2 text-right">SOG</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Sv</TableHeadCell>
						<TableHeadCell class="py-2 text-right">GA</TableHeadCell>
						<TableHeadCell class="py-2 text-right">ShO</TableHeadCell>
					</TableHead>
					<TableBody>
						{#each sortedPlayers as p}
							<TableBodyRow>
								<TableBodyCell class="py-1.5 text-gray-500">{p.jersey_number ?? '—'}</TableBodyCell>
								<TableBodyCell class="py-1.5 font-medium">
									<a href={playerHref(p.ncaa_player_id)}
										class="text-primary-600 dark:text-primary-400 hover:underline">
										{p.player_name}
									</a>
								</TableBodyCell>
								<TableBodyCell class="py-1.5">{p.position ?? '—'}</TableBodyCell>
								<TableBodyCell class="py-1.5">{p.class_year ?? '—'}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{p.games_played}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{p.minutes_played}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right font-semibold">{p.goals}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{p.assists}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{p.points}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{p.shots}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{p.shots_on_goal}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{dash(p.gk_saves)}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{dash(p.gk_goals_against)}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{p.gk_shutouts > 0 ? p.gk_shutouts : '—'}</TableBodyCell>
							</TableBodyRow>
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</div>

	<!-- Schedule -->
	<div>
		<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Schedule</h2>

		{#if !teamSeason}
			<p class="text-sm text-gray-500 dark:text-gray-400">No schedule data for the {seasonYear} season.</p>
		{:else if data.schedule.length === 0}
			<p class="text-sm text-gray-500 dark:text-gray-400">No games found. Run the backfill to populate.</p>
		{:else}
			<div class="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
				<Table hoverable striped class="text-xs whitespace-nowrap">
					<TableHead class="text-[11px] uppercase tracking-wide">
						<TableHeadCell class="py-2">Date</TableHeadCell>
						<TableHeadCell class="py-2">H/A</TableHeadCell>
						<TableHeadCell class="py-2">Opponent</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Score</TableHeadCell>
						<TableHeadCell class="py-2 text-center">Result</TableHeadCell>
					</TableHead>
					<TableBody>
						{#each data.schedule as game}
							{@const opp = opponent(game)}
							{@const res = result(game)}
							<TableBodyRow>
								<TableBodyCell class="py-1.5 text-gray-500">
									<a href={gameHref(game.ncaa_contest_id)}
										class="hover:text-primary-500 hover:underline">
										{formatDate(game.contest_date)}
									</a>
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-gray-400">{isHome(game) ? 'H' : 'A'}</TableBodyCell>
								<TableBodyCell class="py-1.5 font-medium">
									{#if opp}
										<a href="/teams/{opp.ncaa_team_id}?sport={sport}&division={division}&season={seasonYear}"
											class="text-primary-600 dark:text-primary-400 hover:underline">
											{opp.name}
										</a>
									{:else}—{/if}
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right font-mono">
									{#if res}
										<a href={gameHref(game.ncaa_contest_id)} class="hover:underline">
											{scoreDisplay(game)}
										</a>
									{:else}
										<span class="text-gray-400">{game.status === 'scheduled' ? 'TBD' : scoreDisplay(game)}</span>
									{/if}
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-center">
									{#if res}
										<span class={resultClasses[res]}>{res}</span>
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</TableBodyCell>
							</TableBodyRow>
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</div>
</div>
