<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import PlayerFormChart from '$lib/components/PlayerFormChart.svelte';
	import MinutesBarChart from '$lib/components/MinutesBarChart.svelte';
	import type { PageData } from './$types';
	import { PUBLIC_SUPABASE_URL } from '$env/static/public';
	import posthog from 'posthog-js';

	let { data }: { data: PageData } = $props();

	const player         = $derived(data.player);
	const playerSeasons  = $derived(data.playerSeasons);
	const careerStats    = $derived(data.careerStats);
	const gameStats      = $derived(data.gameStats);
	const psTeamMap      = $derived(data.psTeamMap);
	const mostRecentTeam = $derived(data.mostRecentTeam);
	const sport          = $derived(data.sport);
	const division       = $derived(data.division);
	const seasonLabel    = $derived(data.seasonLabel);

	// Most-recent player_season drives position / jersey / class / team meta.
	const sortedPlayerSeasons = $derived(
		[...playerSeasons].sort(
			(a, b) => (b.team_season.season?.year ?? 0) - (a.team_season.season?.year ?? 0)
		)
	);
	const currentPs = $derived(sortedPlayerSeasons[0] ?? null);
	// Headshot from the most-recent season that has one (downloaded copy in Storage);
	// shown in place of the team logo. Falls back to the logo when none exists.
	const headshotPath = $derived(sortedPlayerSeasons.find((ps) => ps.headshot_path)?.headshot_path ?? null);
	const headshotUrl = $derived(
		headshotPath
			? `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/player-headshots/${headshotPath}`
			: null
	);
	const position  = $derived(currentPs?.position ?? null);
	const isGk      = $derived(position === 'GK');

	const positionLong: Record<string, string> = {
		GK: 'Goalkeeper', D: 'Defender', M: 'Midfielder', F: 'Forward'
	};

	function getPsSeason(psId: number) {
		return playerSeasons.find((ps) => ps.id === psId);
	}

	function seasonYearOf(psId: number): string {
		const ps = playerSeasons.find((p) => p.id === psId);
		return String(ps?.team_season.season?.label ?? ps?.team_season.season?.year ?? '');
	}

	// --- per-game helpers (player's perspective) -----------------------------
	type GameRow = (typeof gameStats)[number];
	type Game = GameRow['game'];

	function getOpponent(game: Game, playerTeamId: string) {
		const home = game.home_team_season?.team;
		const away = game.away_team_season?.team;
		return home?.ncaa_team_id === playerTeamId ? away : home;
	}

	function isHomeGame(game: Game, playerTeamId: string) {
		return game.home_team_season?.team?.ncaa_team_id === playerTeamId;
	}

	function getScore(game: Game, playerTeamId: string) {
		if (game.home_score == null || game.away_score == null) return '–';
		return isHomeGame(game, playerTeamId)
			? `${game.home_score}–${game.away_score}`
			: `${game.away_score}–${game.home_score}`;
	}

	function resultOf(game: Game, playerTeamId: string): 'W' | 'L' | 'T' | null {
		if (game.home_score == null || game.away_score == null) return null;
		const isHome = isHomeGame(game, playerTeamId);
		const my = isHome ? game.home_score : game.away_score;
		const ot = isHome ? game.away_score : game.home_score;
		return my > ot ? 'W' : my < ot ? 'L' : 'T';
	}

	// Short opponent code for the chart x-axis (single-season view).
	function abbr(name: string | null | undefined): string {
		if (!name) return '';
		const words = name.replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
		if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
		const initials = words.map((w) => w[0]).join('');
		return (initials.length >= 2 ? initials : words[0]).slice(0, 4).toUpperCase();
	}

	function formatDate(iso: string) {
		return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', timeZone: 'UTC'
		});
	}

	function dash(v: number | null | undefined) {
		return v == null ? '—' : String(v);
	}

	// --- enriched per-game data for charts + table ---------------------------
	interface Datum {
		id: number;
		psId: number;
		year: string;
		seasonStart: boolean;
		date: string;
		opp: string | null;
		oppId: string | null;
		oppLight: string | null;
		oppDark: string | null;
		home: boolean;
		res: 'W' | 'L' | 'T' | null;
		score: string;
		gs: boolean;
		sho: boolean;
		min: number | null;
		op: string;
		g: number; a: number; sh: number; sog: number; sv: number; ga: number;
		[key: string]: unknown;
	}

	function enrich(gs: GameRow): Datum {
		const teamId = psTeamMap[gs.player_season_id] ?? '';
		const opp = getOpponent(gs.game, teamId);
		return {
			id: gs.id,
			psId: gs.player_season_id,
			year: seasonYearOf(gs.player_season_id),
			seasonStart: false,
			date: formatDate(gs.game.contest_date),
			opp: opp?.name ?? null,
			oppId: opp?.ncaa_team_id ?? null,
			oppLight: opp?.logo_url_light ?? null,
			oppDark: opp?.logo_url_dark ?? null,
			home: isHomeGame(gs.game, teamId),
			res: resultOf(gs.game, teamId),
			score: getScore(gs.game, teamId),
			gs: gs.starter,
			sho: gs.gk_shutout === true,
			min: gs.minutes_played,
			op: abbr(opp?.name),
			g: gs.goals,
			a: gs.assists,
			sh: gs.shots,
			sog: gs.shots_on_goal,
			sv: gs.gk_saves ?? 0,
			ga: gs.gk_goals_against ?? 0
		};
	}

	function withSeasonStarts(list: Datum[]): Datum[] {
		let prev = '';
		return list.map((d) => {
			const start = d.year !== prev;
			prev = d.year;
			return start ? { ...d, seasonStart: true } : d;
		});
	}

	// Sort chronologically (oldest→newest) so charts read left-to-right as a
	// timeline. contest_date is ISO (YYYY-MM-DD), so string compare is correct;
	// don't rely on the DB row order, which referenced-table ordering can't
	// reliably control.
	const allDatums = $derived(
		[...gameStats]
			.sort((a, b) => a.game.contest_date.localeCompare(b.game.contest_date))
			.map(enrich)
	);
	const careerGames = $derived(withSeasonStarts(allDatums));

	// --- stat series + toggles -----------------------------------------------
	const series = $derived(
		isGk
			? [
					{ key: 'sv', label: 'Saves', color: '#1f9d57' },
					{ key: 'ga', label: 'GA', color: '#e8463a' }
				]
			: [
					{ key: 'g', label: 'Goals', color: '#e8463a' },
					{ key: 'a', label: 'Assists', color: '#1f9d57' },
					{ key: 'sh', label: 'Shots', color: '#7c8694' },
					{ key: 'sog', label: 'SOG', color: '#c2870a' }
				]
	);

	let careerVisible = $state<Record<string, boolean>>({
		g: true, a: true, sh: true, sog: true, sv: true, ga: true
	});
	let logVisible = $state<Record<string, boolean>>({
		g: true, a: true, sh: true, sog: true, sv: true, ga: true
	});
	const toggleCareer = (k: string) => (careerVisible[k] = !careerVisible[k]);
	const toggleLog = (k: string) => (logVisible[k] = !logVisible[k]);

	// --- game-log season filter ----------------------------------------------
	let selectedPsId = $state<number | null>(null);
	const effectivePsId = $derived(selectedPsId ?? sortedPlayerSeasons[0]?.id ?? null);
	const logGames = $derived(
		withSeasonStarts(
			playerSeasons.length > 1 && effectivePsId !== null
				? allDatums.filter((d) => d.psId === effectivePsId)
				: allDatums
		)
	);
	const logTableRows = $derived([...logGames].reverse()); // most-recent first

	// --- chart ⇄ table hover sync --------------------------------------------
	let hoverId = $state<number | null>(null);
	const hoverIndex = $derived(
		hoverId == null ? null : logGames.findIndex((d) => d.id === hoverId)
	);

	// --- career totals (hero stat tiles) -------------------------------------
	const totals = $derived(
		careerStats.reduce(
			(acc, s) => ({
				gp: acc.gp + s.games_played,
				min: acc.min + s.minutes_played,
				g: acc.g + s.goals,
				a: acc.a + s.assists,
				pts: acc.pts + s.points,
				sh: acc.sh + s.shots,
				sog: acc.sog + s.shots_on_goal,
				sv: acc.sv + (s.gk_saves ?? 0),
				ga: acc.ga + (s.gk_goals_against ?? 0),
				sho: acc.sho + s.gk_shutouts
			}),
			{ gp: 0, min: 0, g: 0, a: 0, pts: 0, sh: 0, sog: 0, sv: 0, ga: 0, sho: 0 }
		)
	);
	const tiles = $derived(
		isGk
			? [
					{ label: 'GP', value: totals.gp },
					{ label: 'Saves', value: totals.sv },
					{ label: 'GA', value: totals.ga },
					{ label: 'ShO', value: totals.sho }
				]
			: [
					{ label: 'GP', value: totals.gp },
					{ label: 'Goals', value: totals.g },
					{ label: 'Assists', value: totals.a },
					{ label: 'Points', value: totals.pts }
				]
	);

	const resClass: Record<string, string> = {
		W: 'text-green-600 dark:text-green-400',
		L: 'text-red-600 dark:text-red-400',
		T: 'text-gray-500 dark:text-gray-400'
	};

	function teamHref(ncaaTeamId: string, season?: string) {
		return `/teams/${ncaaTeamId}?sport=${sport}&division=${division}&season=${season ?? seasonLabel}`;
	}

	onMount(() => {
		posthog.capture('player_viewed', {
			player_id: player.ncaa_player_id,
			player_name: player.name,
			position,
			team: mostRecentTeam?.name,
			sport,
			division,
			season: seasonLabel
		});
	});

	// --- SEO ------------------------------------------------------------------
	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(
		mostRecentTeam
			? `${player.name} — ${mostRecentTeam.name} Soccer Stats | CollegeSoccer.IO`
			: `${player.name} Soccer Stats | CollegeSoccer.IO`
	);
	const pageDesc = $derived(
		`${player.name} NCAA college soccer stats${position ? ` (${position})` : ''}${mostRecentTeam ? `, ${mostRecentTeam.name}` : ''}. Career totals and game log.`
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

{#snippet statToggles(vis: Record<string, boolean>, toggle: (k: string) => void)}
	<div class="flex flex-wrap gap-1.5">
		{#each series as s (s.key)}
			{@const on = vis[s.key]}
			<button
				onclick={() => toggle(s.key)}
				aria-pressed={on}
				class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.75 text-[10px] font-semibold transition-colors
					{on
						? 'border-transparent text-gray-900 dark:text-white'
						: 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500'}"
				style={on ? `border-color:${s.color};background:color-mix(in srgb, ${s.color} 14%, transparent)` : ''}
			>
				<span
					class="h-2 w-2 rounded-xs"
					style="background:{on ? s.color : 'var(--color-gray-300)'}"
				></span>
				{s.label}
			</button>
		{/each}
	</div>
{/snippet}

<div class="space-y-3.5">
	<!-- Breadcrumb -->
	<nav class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
		<a href="/teams?sport={sport}&division={division}&season={seasonLabel}"
			class="hover:text-primary-500 dark:hover:text-primary-400">Teams</a>
		{#if mostRecentTeam}
			<span>/</span>
			<a href="{teamHref(mostRecentTeam.ncaa_team_id)}&tab=roster"
				class="hover:text-primary-500 dark:hover:text-primary-400">{mostRecentTeam.name}</a>
		{/if}
		<span>/</span>
		<span class="text-gray-600 dark:text-gray-300">{player.name}</span>
	</nav>

	<!-- Identity hero -->
	<section class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
		<div class="flex flex-wrap items-center gap-4">
			{#if headshotUrl}
				<div class="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
					<img src={headshotUrl} alt={player.name} class="h-24 w-24 object-cover" loading="lazy" />
				</div>
			{:else if currentPs && (currentPs.team_season.team.logo_url_dark || currentPs.team_season.team.logo_url_light)}
				<div class="flex h-12 w-12 shrink-0 items-center justify-center">
					<TeamLogo
						lightUrl={currentPs.team_season.team.logo_url_light}
						darkUrl={currentPs.team_season.team.logo_url_dark}
						name={currentPs.team_season.team.name}
						size={48}
					/>
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{player.name}</h1>
				<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
					{#if currentPs?.jersey_number != null}
						<span class="font-mono font-semibold text-gray-700 dark:text-gray-300">#{currentPs.jersey_number}</span>
					{/if}
					{#if position}
						<span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300">
							{position}{#if positionLong[position]} · {positionLong[position]}{/if}
						</span>
					{/if}
					{#if currentPs?.class_year}<span>{currentPs.class_year}</span>{/if}
					{#if mostRecentTeam}
						<a href={teamHref(mostRecentTeam.ncaa_team_id)}
							class="hover:text-primary-500 dark:hover:text-primary-400">{mostRecentTeam.name}</a>
					{/if}
				</div>
			</div>
		</div>

		<!-- Career total tiles -->
		{#if careerStats.length > 0}
			<div class="mt-4 grid grid-cols-4 gap-2">
				{#each tiles as t (t.label)}
					<div class="flex flex-col gap-1 rounded border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t.label}</span>
						<span
							class="font-mono text-2xl font-bold leading-none tabular-nums text-gray-900 dark:text-white"
						>{t.value}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Career: per-game trend chart + season totals -->
	<section class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3.5 py-2.5 dark:border-gray-700 dark:bg-gray-900">
			<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Career</h2>
			{#if careerGames.length > 0}{@render statToggles(careerVisible, toggleCareer)}{/if}
		</div>

		{#if careerStats.length === 0}
			<p class="px-3.5 py-6 text-xs text-gray-500 dark:text-gray-400">No career stats recorded yet.</p>
		{:else}
			{#if careerGames.length > 0}
				<div class="border-b border-gray-200 p-3.5 dark:border-gray-700">
					<PlayerFormChart data={careerGames} {series} visible={careerVisible} />
				</div>
				<div class="border-b border-gray-200 px-3.5 py-3 dark:border-gray-700">
					<div class="mb-1 flex items-baseline justify-between">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Minutes per game</span>
						<span class="text-[10px] text-gray-400 dark:text-gray-500">{careerGames.length} career games</span>
					</div>
					<MinutesBarChart data={careerGames} />
				</div>
			{/if}

			<div class="overflow-x-auto">
				<table class="w-full whitespace-nowrap text-xs">
					<thead>
						<tr class="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
							<th class="px-2.5 py-2 font-semibold">Year</th>
							<th class="px-2.5 py-2 font-semibold">Team</th>
							<th class="px-2.5 py-2 text-right font-semibold">GP</th>
							<th class="px-2.5 py-2 text-right font-semibold">Min</th>
							<th class="px-2.5 py-2 text-right font-semibold">G</th>
							<th class="px-2.5 py-2 text-right font-semibold">A</th>
							<th class="px-2.5 py-2 text-right font-semibold">Pts</th>
							<th class="px-2.5 py-2 text-right font-semibold">Sh</th>
							<th class="px-2.5 py-2 text-right font-semibold">SOG</th>
							{#if isGk}
								<th class="px-2.5 py-2 text-right font-semibold">Sv</th>
								<th class="px-2.5 py-2 text-right font-semibold">GA</th>
								<th class="px-2.5 py-2 text-right font-semibold">ShO</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each careerStats as stat (stat.player_season_id)}
							{@const ps = getPsSeason(stat.player_season_id)}
							<tr class="border-t border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/40">
								<td class="px-2.5 py-1.5 font-semibold text-gray-900 dark:text-white">
									{ps?.team_season.season?.label ?? ps?.team_season.season?.year ?? '—'}
								</td>
								<td class="px-2.5 py-1.5">
									{#if ps}
										<a href={teamHref(ps.team_season.team.ncaa_team_id, String(ps.team_season.season?.label ?? ps.team_season.season?.year))}
											class="flex items-center gap-1.5 text-gray-800 hover:underline dark:text-gray-200">
											<TeamLogo lightUrl={ps.team_season.team.logo_url_light} darkUrl={ps.team_season.team.logo_url_dark} name={ps.team_season.team.name} size={16} />
											{ps.team_season.team.name}
										</a>
									{:else}—{/if}
								</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.games_played}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.minutes_played.toLocaleString()}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.goals}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.assists}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.points}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.shots}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.shots_on_goal}</td>
								{#if isGk}
									<td class="px-2.5 py-1.5 text-right tabular-nums">{dash(stat.gk_saves)}</td>
									<td class="px-2.5 py-1.5 text-right tabular-nums">{dash(stat.gk_goals_against)}</td>
									<td class="px-2.5 py-1.5 text-right tabular-nums">{stat.gk_shutouts > 0 ? stat.gk_shutouts : '—'}</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<!-- Game log: per-season chart + table with hover sync -->
	<section class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<div class="flex flex-wrap items-center justify-between gap-2.5 border-b border-gray-200 bg-gray-50 px-3.5 py-2.5 dark:border-gray-700 dark:bg-gray-900">
			<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Game Log</h2>
			{#if logGames.length > 0}
				<div class="flex flex-wrap items-center gap-2.5">
					{@render statToggles(logVisible, toggleLog)}
					{#if playerSeasons.length > 1}
						<span class="h-4 w-px bg-gray-200 dark:bg-gray-700"></span>
						<div class="flex gap-1">
							{#each sortedPlayerSeasons as ps (ps.id)}
								{@const on = effectivePsId === ps.id}
								<button
									onclick={() => (selectedPsId = ps.id)}
									class="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors
										{on
											? 'border-primary-500 bg-primary-500 text-white'
											: 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'}"
								>
									{ps.team_season.season?.label ?? ps.team_season.season?.year ?? '?'}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		{#if logGames.length === 0}
			<p class="px-3.5 py-6 text-xs text-gray-500 dark:text-gray-400">No game log data recorded yet.</p>
		{:else}
			<div class="border-b border-gray-200 p-3.5 dark:border-gray-700">
				<PlayerFormChart
					data={logGames}
					{series}
					visible={logVisible}
					hoverIndex={hoverIndex != null && hoverIndex >= 0 ? hoverIndex : null}
					onHover={(i) => (hoverId = i == null ? null : logGames[i].id)}
				/>
			</div>

			<div class="border-b border-gray-200 px-3.5 py-3 dark:border-gray-700">
				<div class="mb-1 flex items-baseline justify-between">
					<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Minutes per game</span>
					<span class="text-[10px] text-gray-400 dark:text-gray-500">{logGames.length} games</span>
				</div>
				<MinutesBarChart
					data={logGames}
					hoverIndex={hoverIndex != null && hoverIndex >= 0 ? hoverIndex : null}
					onHover={(i) => (hoverId = i == null ? null : logGames[i].id)}
				/>
			</div>

			<div class="overflow-x-auto" onmouseleave={() => (hoverId = null)} role="rowgroup">
				<table class="w-full whitespace-nowrap text-xs">
					<thead>
						<tr class="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
							<th class="px-2.5 py-2 font-semibold">Date</th>
							<th class="px-2.5 py-2 font-semibold">Opponent</th>
							<th class="px-2.5 py-2 font-semibold">Result</th>
							<th class="px-2.5 py-2 text-center font-semibold">GS</th>
							<th class="px-2.5 py-2 text-right font-semibold">Min</th>
							<th class="px-2.5 py-2 text-right font-semibold">G</th>
							<th class="px-2.5 py-2 text-right font-semibold">A</th>
							<th class="px-2.5 py-2 text-right font-semibold">Sh</th>
							<th class="px-2.5 py-2 text-right font-semibold">SOG</th>
							{#if isGk}
								<th class="px-2.5 py-2 text-right font-semibold">Sv</th>
								<th class="px-2.5 py-2 text-right font-semibold">GA</th>
								<th class="px-2.5 py-2 text-right font-semibold">ShO</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each logTableRows as r (r.id)}
							{@const on = r.id === hoverId}
							<tr
								onmouseenter={() => (hoverId = r.id)}
								class="border-t border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400 {on ? 'bg-primary-50 shadow-[inset_3px_0_0_var(--color-primary-500)] dark:bg-primary-500/10' : ''}"
							>
								<td class="px-2.5 py-1.5 text-gray-500 dark:text-gray-400">{r.date}</td>
								<td class="px-2.5 py-1.5 font-medium text-gray-900 dark:text-white">
									{#if r.oppId}
										<a href={teamHref(r.oppId)} class="flex items-center gap-1.5 hover:underline">
											<span class="w-3.5 text-[10px] text-gray-400 dark:text-gray-500">{r.home ? 'vs' : '@'}</span>
											<TeamLogo lightUrl={r.oppLight} darkUrl={r.oppDark} name={r.opp ?? ''} size={16} />
											{r.opp}
										</a>
									{:else}—{/if}
								</td>
								<td class="px-2.5 py-1.5 font-mono font-bold">
									{#if r.res}
										<span class={resClass[r.res]}>{r.res}</span>
										<span class="font-medium text-gray-500 dark:text-gray-400"> {r.score}</span>
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
								<td class="px-2.5 py-1.5 text-center">
									<span class={r.gs ? 'text-primary-500' : 'text-gray-300 dark:text-gray-600'}>{r.gs ? '●' : '—'}</span>
								</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{dash(r.min)}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{r.g}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{r.a}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{r.sh}</td>
								<td class="px-2.5 py-1.5 text-right tabular-nums">{r.sog}</td>
								{#if isGk}
									<td class="px-2.5 py-1.5 text-right tabular-nums">{r.sv}</td>
									<td class="px-2.5 py-1.5 text-right tabular-nums">{r.ga}</td>
									<td class="px-2.5 py-1.5 text-right">{r.sho ? '✓' : '—'}</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
