<script lang="ts">
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import GameBoxscore from '$lib/components/GameBoxscore.svelte';
	import PickButtons from '$lib/components/PickButtons.svelte';
	import { createSupabaseBrowserClient } from '$lib/supabase';
	import { isGameOpen, actualOutcome, gradePick, type PickOutcome, type PickResult } from '$lib/picks';
	import { predict, toPercents, isNeutralSite } from '$lib/prediction';
	import { carrierName, isWatchable } from '$lib/streams';
	import { formatTime } from '$lib/format';
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
		// No start_time = NCAA hasn't set a kickoff yet (see CLAUDE.md, TBD kickoffs).
		: formatTime(game.start_time) || 'Time TBD'
	);

	// ── Matchup preview ───────────────────────────────────────────────────
	// null once the game is final (the loader skips it — today's ratings would
	// misdescribe a game already played).
	const matchup = $derived(data.matchup);
	const links = $derived(data.links);
	// teams.short_name is an abbreviation ("UTTECH"), not a display name.
	const shortName = (t: { name: string } | null, fallback: string) => t?.name || fallback;

	// Team colours for the odds bar, as in the box score. Two teams with near-
	// identical colours (NC State and Stanford are both red) would make the bar
	// unreadable, so the away side falls back to slate when they collide.
	const FALLBACK_COLOR = '#64748b';
	function rgb(hex: string) {
		const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
		return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : null;
	}
	const barColors = $derived.by(() => {
		const home = homeTeam?.team_color ?? FALLBACK_COLOR;
		let away = awayTeam?.team_color ?? FALLBACK_COLOR;
		const a = rgb(away), h = rgb(home);
		if (a && h && Math.hypot(a[0] - h[0], a[1] - h[1], a[2] - h[2]) < 100) {
			away = home === FALLBACK_COLOR ? '#94a3b8' : FALLBACK_COLOR;
		}
		return { away, home };
	});

	// Pregame odds. Needs both teams rated — a non-D1 opponent has no Elo.
	const odds = $derived.by(() => {
		const h = matchup?.home.elo, a = matchup?.away.elo;
		if (!h || !a) return null;
		return toPercents(predict(h.value, a.value, game.sport_code, isNeutralSite(game.round_description)));
	});

	const rec = (r: { w: number; l: number; t: number }) => `${r.w}-${r.l}-${r.t}`;
	const resChip: Record<string, string> = {
		W: 'text-green-600 dark:text-green-400 bg-green-500/15',
		L: 'text-red-600 dark:text-red-400 bg-red-500/15',
		T: 'text-gray-500 dark:text-gray-400 bg-gray-500/15'
	};

	// Tale-of-the-tape rows. `better` marks the side to bold: a lower rank wins.
	type TapeRow = { label: string; away: string; home: string; better?: 'away' | 'home' | null };
	function rankRow(label: string, a: number | null, h: number | null): TapeRow {
		return {
			label,
			away: a != null ? `#${a}` : '—',
			home: h != null ? `#${h}` : '—',
			better: a == null || h == null || a === h ? null : a < h ? 'away' : 'home'
		};
	}
	const tape = $derived.by((): TapeRow[] => {
		if (!matchup) return [];
		const { home: h, away: a } = matchup;
		const rows: TapeRow[] = [{ label: 'Record', away: rec(a.record), home: rec(h.record) }];
		// Conference names in the DB are slugs ("mountain-west"), so the row
		// label carries the meaning and the cells show only the record.
		if (a.confRecord || h.confRecord) {
			rows.push({
				label: 'Conference',
				away: a.confRecord ? rec(a.confRecord) : '—',
				home: h.confRecord ? rec(h.confRecord) : '—'
			});
		}
		rows.push(rankRow('Elo', a.elo?.rank ?? null, h.elo?.rank ?? null));
		rows.push(rankRow('RPI', a.rpiRank, h.rpiRank));
		rows.push(rankRow('Power', a.powerRank, h.powerRank));
		return rows;
	});

	// ── Pick'em ───────────────────────────────────────────────────────────
	// Same optimistic write as /scores: update locally, revert if the server
	// disagrees. RLS owns the kickoff lock, so a 403 means it locked under us.
	let pick = $state(data.userPick);
	$effect(() => {
		pick = data.userPick;
	});
	let pickBusy = $state(false);
	const pickable = $derived(isGameOpen(game));

	async function setPick(next: PickOutcome | null) {
		const previous = pick;
		pickBusy = true;
		pick = next === null ? null : { outcome: next, result: previous?.result ?? null };
		try {
			const res = await fetch('/api/picks', {
				method: next === null ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(next === null ? { gameId: game.id } : { gameId: game.id, outcome: next })
			});
			if (!res.ok) pick = previous;
		} catch {
			pick = previous;
		} finally {
			pickBusy = false;
		}
	}

	// The grader runs every 10 minutes; derive the result as soon as a live game
	// goes final in an open tab. The stored value wins on reload.
	const pickResult = $derived<PickResult | null>(
		pick ? (pick.result ?? gradePick(pick.outcome, game)) : null
	);
	const loginHref = $derived(`/login?redirect=${encodeURIComponent(page.url.pathname + page.url.search)}`);

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
			: `${awayTeam?.name ?? 'Away'} vs ${homeTeam?.name ?? 'Home'} on ${formatDate(game.contest_date)}. Match preview with win probability, records, rankings, recent form and where to watch.`
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
		<p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
			{formatDate(game.contest_date)}
			{#if game.round_description}
				<span class="text-gray-300 dark:text-gray-600">·</span>
				<span class="font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">{game.round_description}</span>
			{/if}
		</p>

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
					<p class="text-[11px] text-gray-400 dark:text-gray-500">
						{#if matchup?.away.seed}<span class="font-semibold text-gray-500 dark:text-gray-400">#{matchup.away.seed} seed</span>{' · '}{/if}{#if matchup}{rec(matchup.away.record)}{' · '}{/if}Away
					</p>
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
					<p class="text-[11px] text-gray-400 dark:text-gray-500">
						Home{#if matchup}{' · '}{rec(matchup.home.record)}{/if}{#if matchup?.home.seed}{' · '}<span class="font-semibold text-gray-500 dark:text-gray-400">#{matchup.home.seed} seed</span>{/if}
					</p>
				</div>
			</div>
		</div>

		<!-- Where to follow it. Only per-game links on a service you can just open
		     become buttons (see isWatchable); a carrier with nothing clickable — a
		     cable-gated simulcast — is still named, as on /scores. -->
		{#if matchup && (links.video || links.audio || links.stats || links.tickets || game.broadcaster_name)}
			<div class="mt-4 flex flex-wrap items-center justify-center gap-2 border-t border-gray-100 pt-3 text-[11px] dark:border-gray-700">
				{#if isWatchable(links.video)}
					<a href={links.video.url} target="_blank" rel="noopener noreferrer"
						class="inline-flex items-center gap-1 rounded bg-primary-500 px-2.5 py-1 font-semibold text-white hover:bg-primary-600">
						<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
						Watch on {carrierName(links.video)}
					</a>
				{:else if links.video?.carrier || game.broadcaster_name}
					<span class="text-gray-500 dark:text-gray-400">
						TV: <span class="font-semibold">{links.video ? carrierName(links.video) : game.broadcaster_name}</span>
					</span>
				{/if}
				{#each [['audio', 'Listen'], ['stats', 'Live stats'], ['tickets', 'Tickets']] as const as [kind, label] (kind)}
					{@const l = links[kind]}
					{#if l?.url && l.is_deep_link}
						<a href={l.url} target="_blank" rel="noopener noreferrer"
							class="rounded border border-gray-300 px-2.5 py-1 font-semibold text-gray-600 hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-300 dark:hover:text-primary-400">
							{label}
						</a>
					{/if}
				{/each}
			</div>
		{/if}
	</div>

	{#snippet pickem()}
		{#if data.signedIn && (pickable || pick)}
			<PickButtons
				layout="row"
				away={shortName(awayTeam, 'Away')}
				home={shortName(homeTeam, 'Home')}
				selected={pick?.outcome ?? null}
				open={pickable}
				actual={actualOutcome(game)}
				result={pickResult}
				busy={pickBusy}
				onpick={setPick}
			/>
		{:else if !data.signedIn && pickable}
			<a href={loginHref}
				class="block rounded border border-dashed border-gray-300 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-400 dark:hover:text-primary-400">
				Sign in to make your pick
			</a>
		{/if}
	{/snippet}

	{#snippet preview()}
		{#if matchup}
			{@const awayColor = barColors.away}
			{@const homeColor = barColors.home}
			<section class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
				<div class="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
					{game.status === 'live' ? 'Pregame Preview' : 'Matchup Preview'}
				</div>

				<div class="space-y-4 px-4 py-4">
					<!-- Win probability: away left, home right, same as the header. -->
					{#if odds}
						{@const fav = odds.home >= odds.away && odds.home >= odds.draw ? 'home' : odds.away >= odds.draw ? 'away' : 'draw'}
						<div>
							<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Win probability</p>
							<div class="mb-1.5 grid grid-cols-3 text-xs">
								<div class="min-w-0">
									<span class="font-mono text-lg tabular-nums {fav === 'away' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">{odds.away}%</span>
									<span class="block truncate text-[11px] text-gray-500 dark:text-gray-400">{shortName(awayTeam, 'Away')}</span>
								</div>
								<div class="text-center">
									<span class="font-mono text-lg tabular-nums {fav === 'draw' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">{odds.draw}%</span>
									<span class="block text-[11px] text-gray-500 dark:text-gray-400">Draw</span>
								</div>
								<div class="min-w-0 text-right">
									<span class="font-mono text-lg tabular-nums {fav === 'home' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">{odds.home}%</span>
									<span class="block truncate text-[11px] text-gray-500 dark:text-gray-400">{shortName(homeTeam, 'Home')}</span>
								</div>
							</div>
							<div class="flex h-2.5 gap-0.5 overflow-hidden rounded-sm" role="img"
								aria-label="{shortName(awayTeam, 'Away')} {odds.away}%, draw {odds.draw}%, {shortName(homeTeam, 'Home')} {odds.home}%">
								<div style="width:{odds.away}%;background:{awayColor}"></div>
								<div class="bg-gray-300 dark:bg-gray-600" style="width:{odds.draw}%"></div>
								<div style="width:{odds.home}%;background:{homeColor}"></div>
							</div>
						</div>
					{/if}

					{@render pickem()}

					<!-- Tale of the tape -->
					<div class="border-t border-gray-100 pt-3 dark:border-gray-700">
						{#each tape as r (r.label)}
							<div class="grid items-center gap-2 py-1" style="grid-template-columns:1fr 84px 1fr">
								<div class="truncate text-right font-mono text-sm tabular-nums {r.better === 'away' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}">{r.away}</div>
								<div class="text-center text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{r.label}</div>
								<div class="truncate text-left font-mono text-sm tabular-nums {r.better === 'home' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}">{r.home}</div>
							</div>
						{/each}
						<div class="grid items-center gap-2 py-1" style="grid-template-columns:1fr 84px 1fr">
							{#each [matchup.away, null, matchup.home] as s, i (i)}
								{#if s === null}
									<div class="text-center text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Last 5</div>
								{:else}
									<div class="flex gap-1 {i === 0 ? 'justify-end' : 'justify-start'}">
										{#each s.form as f (f.contestId)}
											<a href="/games/{f.contestId}?sport={sport}&division={division}&season={seasonLabel}"
												title="{f.result} {f.score} {f.opponent}"
												class="inline-flex h-4.75 w-4.75 items-center justify-center rounded-sm font-mono text-[11px] font-bold hover:ring-1 hover:ring-current {resChip[f.result]}">{f.result}</a>
										{:else}
											<span class="text-sm text-gray-400 dark:text-gray-500">—</span>
										{/each}
									</div>
								{/if}
							{/each}
						</div>
					</div>

					<p class="text-[10px] leading-snug text-gray-400 dark:text-gray-500">
						Ranks are among {matchup.fieldSize} D{division} teams and update nightly. Records count games against D{division} opponents only.
						{#if odds}Win probability comes from Elo ratings, calibrated against 13,000+ D1 results since 2024.{/if}
					</p>
				</div>
			</section>
		{:else if pick}
			<!-- Final game: no preview, but show how the user's pick graded. -->
			<section class="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
				<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Your pick</p>
				{@render pickem()}
			</section>
		{/if}
	{/snippet}

	{#if game.status !== 'live'}{@render preview()}{/if}

	<!-- Player stats -->
	{#if homeStats.length === 0 && awayStats.length === 0}
		{#if game.status === 'live'}
			<p class="text-sm text-gray-500 dark:text-gray-400">
				Stats will appear here shortly after kickoff — updated live as the game goes on.
			</p>
		{:else if game.status === 'final'}
			<p class="text-sm text-gray-500 dark:text-gray-400">No player stats for this game yet. Check back later.</p>
		{/if}
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

	<!-- A live game leads with the score and box score; the preview drops below. -->
	{#if game.status === 'live'}{@render preview()}{/if}
</div>
