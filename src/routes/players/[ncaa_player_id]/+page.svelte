<script lang="ts">
	import { Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell } from 'flowbite-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const player         = $derived(data.player);
	const playerSeasons  = $derived(data.playerSeasons);
	const careerStats    = $derived(data.careerStats);
	const gameStats      = $derived(data.gameStats);
	const psTeamMap      = $derived(data.psTeamMap);
	const mostRecentTeam = $derived(data.mostRecentTeam);
	const sport          = $derived(data.sport);
	const division       = $derived(data.division);
	const seasonYear     = $derived(data.seasonYear);

	// Find position from most recent player_season
	const position = $derived(
		[...playerSeasons]
			.sort((a, b) => (b.team_season.season?.year ?? 0) - (a.team_season.season?.year ?? 0))[0]
			?.position ?? null
	);

	// Lookup helper: get team_season info for a player_season_id
	function getPsSeason(psId: number) {
		return playerSeasons.find(ps => ps.id === psId);
	}

	// Determine the opponent team in a game, given which team the player was on
	function getOpponent(
		game: (typeof gameStats)[number]['game'],
		playerTeamId: string
	) {
		const home = game.home_team_season?.team;
		const away = game.away_team_season?.team;
		return home?.ncaa_team_id === playerTeamId ? away : home;
	}

	// Show score from the player's perspective: player_team_score – opponent_score
	function getScore(
		game: (typeof gameStats)[number]['game'],
		playerTeamId: string
	) {
		if (game.home_score == null || game.away_score == null) return '–';
		const isHome = game.home_team_season?.team?.ncaa_team_id === playerTeamId;
		return isHome
			? `${game.home_score}–${game.away_score}`
			: `${game.away_score}–${game.home_score}`;
	}

	function formatDate(iso: string) {
		return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
		});
	}

	function dash(v: number | null | undefined) {
		return v == null ? '—' : String(v);
	}

	const isGk = $derived(position === 'GK');
</script>

<div class="space-y-6 max-w-4xl">
	<!-- Breadcrumb + header -->
	<div>
		<nav class="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
			<a href="/teams?sport={sport}&division={division}&season={seasonYear}"
				class="hover:text-primary-500">Teams</a>
			{#if mostRecentTeam}
				<span>/</span>
				<a href="/teams/{mostRecentTeam.ncaa_team_id}?sport={sport}&division={division}&season={seasonYear}"
					class="hover:text-primary-500">{mostRecentTeam.name}</a>
			{/if}
			<span>/</span>
			<span class="text-gray-700 dark:text-gray-300">{player.name}</span>
		</nav>

		<h1 class="text-xl font-bold text-gray-900 dark:text-white">{player.name}</h1>
		{#if position}
			<span class="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
				{position}
			</span>
		{/if}
	</div>

	<!-- Career stats -->
	<div>
		<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Career Stats</h2>

		{#if careerStats.length === 0}
			<p class="text-xs text-gray-500 dark:text-gray-400">No career stats recorded yet.</p>
		{:else}
			<div class="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
				<Table hoverable striped class="text-xs whitespace-nowrap">
					<TableHead class="text-[11px] uppercase tracking-wide">
						<TableHeadCell class="py-2">Year</TableHeadCell>
						<TableHeadCell class="py-2">Team</TableHeadCell>
						<TableHeadCell class="py-2 text-right">GP</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Min</TableHeadCell>
						<TableHeadCell class="py-2 text-right">G</TableHeadCell>
						<TableHeadCell class="py-2 text-right">A</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Pts</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Sh</TableHeadCell>
						<TableHeadCell class="py-2 text-right">SOG</TableHeadCell>
						{#if isGk}
							<TableHeadCell class="py-2 text-right">Sv</TableHeadCell>
							<TableHeadCell class="py-2 text-right">GA</TableHeadCell>
							<TableHeadCell class="py-2 text-right">ShO</TableHeadCell>
						{/if}
					</TableHead>
					<TableBody>
						{#each careerStats as stat}
							{@const ps = getPsSeason(stat.player_season_id)}
							<TableBodyRow>
								<TableBodyCell class="py-1.5 font-medium">{ps?.team_season.season?.year ?? '—'}</TableBodyCell>
								<TableBodyCell class="py-1.5">
									{#if ps}
										<a href="/teams/{ps.team_season.team.ncaa_team_id}?sport={sport}&division={division}&season={ps.team_season.season?.year}"
											class="text-primary-600 dark:text-primary-400 hover:underline">
											{ps.team_season.team.name}
										</a>
									{:else}—{/if}
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{stat.games_played}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{stat.minutes_played}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right font-semibold">{stat.goals}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{stat.assists}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{stat.points}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{stat.shots}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{stat.shots_on_goal}</TableBodyCell>
								{#if isGk}
									<TableBodyCell class="py-1.5 text-right">{dash(stat.gk_saves)}</TableBodyCell>
									<TableBodyCell class="py-1.5 text-right">{dash(stat.gk_goals_against)}</TableBodyCell>
									<TableBodyCell class="py-1.5 text-right">{stat.gk_shutouts > 0 ? stat.gk_shutouts : '—'}</TableBodyCell>
								{/if}
							</TableBodyRow>
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</div>

	<!-- Game log -->
	<div>
		<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Game Log</h2>

		{#if gameStats.length === 0}
			<p class="text-xs text-gray-500 dark:text-gray-400">No game log data recorded yet.</p>
		{:else}
			<div class="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
				<Table hoverable striped class="text-xs whitespace-nowrap">
					<TableHead class="text-[11px] uppercase tracking-wide">
						<TableHeadCell class="py-2">Date</TableHeadCell>
						<TableHeadCell class="py-2">Opponent</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Score</TableHeadCell>
						<TableHeadCell class="py-2 text-center">GS</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Min</TableHeadCell>
						<TableHeadCell class="py-2 text-right">G</TableHeadCell>
						<TableHeadCell class="py-2 text-right">A</TableHeadCell>
						<TableHeadCell class="py-2 text-right">Sh</TableHeadCell>
						<TableHeadCell class="py-2 text-right">SOG</TableHeadCell>
						{#if isGk}
							<TableHeadCell class="py-2 text-right">Sv</TableHeadCell>
							<TableHeadCell class="py-2 text-right">GA</TableHeadCell>
							<TableHeadCell class="py-2 text-right">ShO</TableHeadCell>
						{/if}
					</TableHead>
					<TableBody>
						{#each gameStats as gs}
							{@const playerTeamId = psTeamMap[gs.player_season_id] ?? ''}
							{@const opponent = getOpponent(gs.game, playerTeamId)}
							<TableBodyRow>
								<TableBodyCell class="py-1.5 text-gray-500">{formatDate(gs.game.contest_date)}</TableBodyCell>
								<TableBodyCell class="py-1.5">
									{#if opponent}
										<a href="/teams/{opponent.ncaa_team_id}?sport={sport}&division={division}&season={seasonYear}"
											class="text-primary-600 dark:text-primary-400 hover:underline">
											{opponent.name}
										</a>
									{:else}—{/if}
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right font-mono">{getScore(gs.game, playerTeamId)}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-center">{gs.starter ? '●' : ''}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{dash(gs.minutes_played)}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right font-semibold">{gs.goals}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{gs.assists}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{gs.shots}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-right">{gs.shots_on_goal}</TableBodyCell>
								{#if isGk}
									<TableBodyCell class="py-1.5 text-right">{dash(gs.gk_saves)}</TableBodyCell>
									<TableBodyCell class="py-1.5 text-right">{dash(gs.gk_goals_against)}</TableBodyCell>
									<TableBodyCell class="py-1.5 text-right">{gs.gk_shutout ? '✓' : '—'}</TableBodyCell>
								{/if}
							</TableBodyRow>
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</div>
</div>
