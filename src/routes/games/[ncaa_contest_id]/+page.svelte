<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import GameBoxscore from '$lib/components/GameBoxscore.svelte';
	import type { PageData } from './$types';
	import posthog from 'posthog-js';

	let { data }: { data: PageData } = $props();

	const game       = $derived(data.game);
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
		game.status === 'final' ? 'Final'
		: game.status === 'in_progress' ? 'In Progress'
		: 'Scheduled'
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
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{statusLabel}</p>
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
	{#if data.homeStats.length === 0 && data.awayStats.length === 0}
		<p class="text-sm text-gray-500 dark:text-gray-400">
			No player stats for this game yet. Check back later.
		</p>
	{:else}
		<GameBoxscore
			{awayTeam}
			{homeTeam}
			awayStats={data.awayStats}
			homeStats={data.homeStats}
			{playerHref}
			{teamHref}
		/>
	{/if}
</div>
