<script lang="ts">
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import GameBoxscore from '$lib/components/GameBoxscore.svelte';
	import { createSupabaseBrowserClient } from '$lib/supabase';
	import type { PageData } from './$types';
	import posthog from 'posthog-js';

	let { data }: { data: PageData } = $props();

	// Locally mutable copies so live updates can patch them in place, same
	// pattern as /scores. `game` (score/status/period) is patched directly from
	// the realtime payload; `homeStats`/`awayStats` come from a joined query the
	// payload can't carry, so those re-seed via `invalidate('boxscore:stats')`
	// instead — see onMount below.
	let game = $state(data.game);
	let homeStats = $state(data.homeStats);
	let awayStats = $state(data.awayStats);
	$effect(() => {
		game = data.game;
		homeStats = data.homeStats;
		awayStats = data.awayStats;
	});

	const homeTeam   = $derived(data.homeTeam);
	const awayTeam   = $derived(data.awayTeam);
	const sport      = $derived(data.sport);
	const division   = $derived(data.division);
	const seasonLabel = $derived(data.seasonLabel);
	const fromTeam   = $derived(data.fromTeam);

	function formatDate(iso: string) {
		return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
			weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
		});
	}

	function playerHref(ncaaPlayerId: string) {
		return `/players/${ncaaPlayerId}?sport=${sport}&division=${division}&season=${seasonLabel}`;
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${sport}&division=${division}&season=${seasonLabel}`;
	}

	const backHref = $derived(
		fromTeam
			? `/teams/${fromTeam}?sport=${sport}&division=${division}&season=${seasonLabel}`
			: `/teams?sport=${sport}&division=${division}&season=${seasonLabel}`
	);

	const backLabel = $derived(
		fromTeam === homeTeam?.ncaa_team_id ? homeTeam?.name
		: fromTeam === awayTeam?.ncaa_team_id ? awayTeam?.name
		: 'Teams'
	);

	const statusLabel = $derived(
		game.status === 'final'      ? (game.shootout ? 'Final / PK' : 'Final')
		: game.status === 'live'      ? (game.current_period || 'Live')
		: game.status === 'postponed' ? 'Postponed'
		: game.status === 'cancelled' ? 'Cancelled'
		: 'Scheduled'
	);

	// Which side won the penalty shootout and advanced (game itself stays a tie).
	const advancedTeamName = $derived(
		!game.shootout ? null
		: game.home_advanced ? homeTeam?.name
		: game.away_advanced ? awayTeam?.name
		: null
	);
	onMount(() => {
		posthog.capture('game_viewed', {
			contest_id: game.ncaa_contest_id,
			home_team: homeTeam?.name,
			away_team: awayTeam?.name,
			home_score: game.home_score,
			away_score: game.away_score,
			status: game.status,
			sport,
			division,
			season: seasonLabel
		});

		// Live updates. Subscribes broadly (no server-side filter) and matches
		// client-side against `game.id`, read live off the reactive `game` state
		// rather than captured at mount time — the same shape /scores uses — so
		// this stays correct even though SvelteKit reuses this component instance
		// across client-side navigations between two /games/[id] pages.
		//
		// `games` rows are self-sufficient (score/status/period live directly on
		// the row), so those patch `game` in place. `player_game_stats` rows need
		// the player/team_season joins the realtime payload doesn't carry, so an
		// insert or update there just re-runs the load instead, debounced since a
		// single live-reconcile pass upserts every player on the field at once.
		const supabase = createSupabaseBrowserClient();

		let statsTimer: ReturnType<typeof setTimeout> | null = null;
		function scheduleStatsRefresh() {
			if (statsTimer) return;
			statsTimer = setTimeout(() => {
				statsTimer = null;
				invalidate('boxscore:stats');
			}, 500);
		}

		const channel = supabase
			.channel(`game-${game.ncaa_contest_id}-live`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'games' },
				(payload) => {
					const row = payload.new as {
						id: number;
						home_score: number | null;
						away_score: number | null;
						shootout: boolean | null;
						shootout_winner_team_season_id: number | null;
						home_team_season_id: number;
						away_team_season_id: number;
						status: string;
						current_period: string | null;
					};
					if (row.id !== game.id) return;
					game = {
						...game,
						home_score: row.home_score,
						away_score: row.away_score,
						shootout: row.shootout ?? false,
						home_advanced: row.shootout ? row.shootout_winner_team_season_id === row.home_team_season_id : null,
						away_advanced: row.shootout ? row.shootout_winner_team_season_id === row.away_team_season_id : null,
						status: row.status,
						current_period: row.current_period
					};
				}
			)
			.on(
				'postgres_changes',
				{ event: 'INSERT', schema: 'public', table: 'player_game_stats' },
				(payload) => {
					if ((payload.new as { game_id: number }).game_id === game.id) scheduleStatsRefresh();
				}
			)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'player_game_stats' },
				(payload) => {
					if ((payload.new as { game_id: number }).game_id === game.id) scheduleStatsRefresh();
				}
			)
			.subscribe();

		return () => {
			if (statsTimer) clearTimeout(statsTimer);
			supabase.removeChannel(channel);
		};
	});

	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(
		game.home_score != null && game.away_score != null
			? `${awayTeam?.name ?? 'Away'} ${game.away_score}–${game.home_score} ${homeTeam?.name ?? 'Home'} Boxscore | CollegeSoccer.IO`
			: `${awayTeam?.name ?? 'Away'} vs ${homeTeam?.name ?? 'Home'} — ${formatDate(game.contest_date)} | CollegeSoccer.IO`
	);
	const pageDesc = $derived(
		game.home_score != null && game.away_score != null
			? `${awayTeam?.name ?? 'Away'} vs ${homeTeam?.name ?? 'Home'} final score ${game.away_score}–${game.home_score} on ${formatDate(game.contest_date)}. Full player boxscore and stats.`
			: `${awayTeam?.name ?? 'Away'} vs ${homeTeam?.name ?? 'Home'} on ${formatDate(game.contest_date)}. Player stats and boxscore.`
	);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDesc} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content={canonicalUrl} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDesc} />
</svelte:head>

<div class="space-y-6">
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
			<div class="flex-1 flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-3 min-w-0">
				{#if awayTeam?.logo_url_dark || awayTeam?.logo_url_light}
					<div class="shrink-0 w-10 h-10 flex items-center justify-center order-1 sm:order-2">
						<TeamLogo
							lightUrl={awayTeam.logo_url_light}
							darkUrl={awayTeam.logo_url_dark}
							name={awayTeam.name}
							size={40}
						/>
					</div>
				{/if}
				<div class="text-right min-w-0 order-2 sm:order-1">
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
				<p class="text-xs mt-0.5 {game.status === 'live' ? 'font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">
					{statusLabel}
				</p>
				{#if advancedTeamName}
					<p class="text-[11px] font-medium text-primary-600 dark:text-primary-400 mt-0.5">
						{advancedTeamName} won on penalties
					</p>
				{/if}
			</div>

			<!-- Home team -->
			<div class="flex-1 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3 min-w-0">
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
	{#if homeStats.length === 0 && awayStats.length === 0}
		<p class="text-sm text-gray-500 dark:text-gray-400">
			{#if game.status === 'live'}
				Stats will appear here shortly after kickoff — updated live as the game goes on.
			{:else}
				No player stats for this game yet. Check back later.
			{/if}
		</p>
	{:else}
		<GameBoxscore
			{awayTeam}
			{homeTeam}
			{awayStats}
			{homeStats}
			{playerHref}
			{teamHref}
		/>
	{/if}
</div>
