<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Badge, Dropdown, DropdownItem } from 'flowbite-svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import PickButtons from '$lib/components/PickButtons.svelte';
	import { createSupabaseBrowserClient } from '$lib/supabase';
	import { isGameOpen, actualOutcome, type PickOutcome, type PickResult } from '$lib/picks';
	import { formatTime } from '$lib/format';
	import type { PageData } from './$types';
	import flatpickr from 'flatpickr';
	import type { Instance } from 'flatpickr/dist/types/instance';

	let { data }: { data: PageData } = $props();
	type TeamInfo   = { name: string; short_name: string; ncaa_team_id: string; logo_url_dark: string | null; logo_url_light: string | null };
	type ConfInfo   = { name: string; short_name: string } | null;
	type TeamSeason = { team: TeamInfo; conference: ConfInfo } | null;
	type Game = {
		id: number;
		ncaa_contest_id: string;
		contest_date: string;
		start_time: string | null;
		home_score: number | null;
		away_score: number | null;
		shootout: boolean;
		shootout_winner_team_season_id: number | null;
		home_team_season_id: number;
		away_team_season_id: number;
		status: string;
		neutral_site: boolean;
		broadcaster_name: string | null;
		round_description: string | null;
		current_period: string | null;
		home_team_season: TeamSeason;
		away_team_season: TeamSeason;
	};

	// Locally mutable copy of the SSR game list so live updates can patch it in
	// place. Seeded from data.games (SSR/hydration render the real list — no flash)
	// and re-seeded whenever we navigate to a new date / sport / season.
	let games = $state<Game[]>((data.games as unknown as Game[]) ?? []);
	$effect(() => {
		games = (data.games as unknown as Game[]) ?? [];
	});

	// Slate ordering: live → upcoming → finished → TBD, each by kickoff.
	//
	// Done here rather than in the PostgREST query because the order depends on
	// `status`, which realtime mutates in place: a game going live has to jump to
	// the top without a reload, and a game going final has to drop to the bottom.
	// A server-side ORDER BY would only be right until the first live update.
	// SSR runs this too, so the first paint is already correctly ordered.
	function slateRank(g: Game): number {
		if (g.status === 'live') return 0;
		// A TBD kickoff only means anything while the game is still ahead of us —
		// a played-out game with no recorded time belongs with the finals, not
		// stranded at the bottom of the page.
		if (g.status === 'scheduled') return g.start_time ? 1 : 3;
		return 2; // final / postponed / cancelled
	}

	// Divider groups are the sort buckets themselves: a rule falls at every change
	// of slateRank, so live games are fenced off from the upcoming slate as well
	// as from the finals. Indexed by rank, so SECTIONS[slateRank(g)] is the group
	// a card belongs to — the same list drives the dividers and the filters.
	const SECTIONS = [
		{ key: 'live',     label: 'Live' },
		{ key: 'upcoming', label: 'Upcoming' },
		{ key: 'final',    label: 'Final' },
		{ key: 'tbd',      label: 'TBD' }
	] as const;
	type SectionKey = (typeof SECTIONS)[number]['key'];

	function sectionLabel(section: number): string {
		return SECTIONS[section].label;
	}

	const sortedGames = $derived(
		[...games].sort((a, b) => {
			const ra = slateRank(a);
			const rb = slateRank(b);
			if (ra !== rb) return ra - rb;

			// Within a bucket: earliest kickoff first, unknown times last.
			if (a.start_time && b.start_time) {
				const d = Date.parse(a.start_time) - Date.parse(b.start_time);
				if (d) return d;
			} else if (!a.start_time !== !b.start_time) {
				return a.start_time ? -1 : 1;
			}
			return a.id - b.id; // stable tiebreak so equal kickoffs don't shuffle
		})
	);

	// Status filters. Like the pick'em toggle this is a viewing preference, not
	// page state, so it's persisted rather than put in the URL — the URL belongs
	// to the slate being viewed, and a shared /scores link should show the whole
	// slate rather than whatever the sender had hidden.
	const FILTER_PREF = 'scores:sections';
	let shown = $state<Record<SectionKey, boolean>>({ live: true, upcoming: true, final: true, tbd: true });

	function toggleSection(key: SectionKey) {
		shown[key] = !shown[key];
		try {
			localStorage.setItem(
				FILTER_PREF,
				SECTIONS.filter((s) => shown[s.key]).map((s) => s.key).join(',')
			);
		} catch {
			// Storage can be unavailable (private mode); filtering still works for the session.
		}
	}

	function showAllSections() {
		for (const s of SECTIONS) shown[s.key] = true;
		try {
			localStorage.setItem(FILTER_PREF, SECTIONS.map((s) => s.key).join(','));
		} catch {
			// ignore
		}
	}

	// Counts come off the unfiltered slate, so a hidden group still shows how many
	// games turning it back on would reveal.
	const sectionCounts = $derived(
		games.reduce(
			(acc, g) => {
				acc[SECTIONS[slateRank(g)].key]++;
				return acc;
			},
			{ live: 0, upcoming: 0, final: 0, tbd: 0 } as Record<SectionKey, number>
		)
	);

	const visibleGames = $derived(sortedGames.filter((g) => shown[SECTIONS[slateRank(g)].key]));

	// Pick'em state is kept OUT of the games array so the realtime patching above
	// and the date/sport re-seed can't wipe it. Keyed by game id.
	type UserPick = { outcome: PickOutcome; result: PickResult | null };
	let picks = $state<Record<number, UserPick>>(
		(data.userPicks as unknown as Record<number, UserPick>) ?? {}
	);
	$effect(() => {
		picks = (data.userPicks as unknown as Record<number, UserPick>) ?? {};
	});

	// Games currently mid-request, so their controls disable without blocking others.
	let pending = $state<Record<number, boolean>>({});

	const signedIn = $derived(!!page.data.user);

	// Pick'em is off by default: the scoreboard reads as a scoreboard until you ask
	// for the picker. It's a viewing preference, not page state, so it's persisted
	// rather than carried in the URL — the URL belongs to the slate being viewed.
	const PICKEM_PREF = 'scores:pickem';
	let pickemOn = $state(false);

	function togglePickem() {
		pickemOn = !pickemOn;
		try {
			localStorage.setItem(PICKEM_PREF, pickemOn ? '1' : '0');
		} catch {
			// Storage can be unavailable (private mode); the toggle still works for the session.
		}
	}

	/**
	 * Optimistic write: update local state immediately, revert if the server
	 * disagrees. The server is authoritative — RLS owns the kickoff lock.
	 */
	async function setPick(gameId: number, next: PickOutcome | null) {
		const previous = picks[gameId];
		pending[gameId] = true;

		if (next === null) {
			delete picks[gameId];
		} else {
			picks[gameId] = { outcome: next, result: previous?.result ?? null };
		}

		try {
			const res = await fetch('/api/picks', {
				method: next === null ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(next === null ? { gameId } : { gameId, outcome: next })
			});

			if (!res.ok) {
				// Revert. A 403 means the game locked out from under us.
				if (previous) picks[gameId] = previous;
				else delete picks[gameId];
			}
		} catch {
			if (previous) picks[gameId] = previous;
			else delete picks[gameId];
		} finally {
			pending[gameId] = false;
		}
	}

	/**
	 * A graded result arrives from the grader up to 10 minutes after a final. When
	 * a game flips to final in an open tab, derive the result immediately so the
	 * card gives instant feedback; the stored value wins on reload.
	 */
	function displayResult(game: Game, pick: UserPick | undefined): PickResult | null {
		if (!pick) return null;
		if (pick.result) return pick.result;
		if (game.status === 'cancelled') return 'void';

		const actual = actualOutcome(game);
		if (actual === null) return null;
		return actual === pick.outcome ? 'win' : 'loss';
	}

	// Live scores: subscribe to UPDATEs on `games` and patch any row currently on
	// screen, matched by id. The list is a single day's slate, so updates for games
	// on other dates won't match and are ignored — no server-side filter needed.
	onMount(() => {
		// Read after hydration — SSR has no localStorage, so the server and the
		// first client render must agree on the defaults (pick'em off, all
		// sections shown).
		try {
			pickemOn = localStorage.getItem(PICKEM_PREF) === '1';

			const saved = localStorage.getItem(FILTER_PREF);
			if (saved !== null) {
				const keys = saved.split(',');
				for (const s of SECTIONS) shown[s.key] = keys.includes(s.key);
			}
		} catch {
			// ignore
		}

		const supabase = createSupabaseBrowserClient();
		const channel = supabase
			.channel('scoreboard-live-scores')
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
						status: string;
						start_time: string | null;
						current_period: string | null;
					};
					const idx = games.findIndex((g) => g.id === row.id);
					if (idx === -1) return;
					games[idx] = {
						...games[idx],
						home_score: row.home_score,
						away_score: row.away_score,
						shootout: row.shootout ?? false,
						shootout_winner_team_season_id: row.shootout_winner_team_season_id,
						status: row.status,
						start_time: row.start_time,
						current_period: row.current_period
					};
				}
			)
			.subscribe();
		return () => {
			supabase.removeChannel(channel);
		};
	});

	const contestDate     = $derived(data.contestDate);
	const gender          = $derived(data.gender);
	const division        = $derived(data.division);
	const seasonLabel     = $derived(data.seasonLabel);
	const seasons         = $derived(data.seasons);
	const sportCode       = $derived(gender === 'W' ? 'WSO' : 'MSO');

	function gameHref(ncaaContestId: string) {
		return `/games/${ncaaContestId}?sport=${sportCode}&division=${division}&season=${seasonLabel}`;
	}

	function teamHref(ncaaTeamId: string) {
		return `/teams/${ncaaTeamId}?sport=${sportCode}&division=${division}&season=${seasonLabel}`;
	}

	// Always build the full URL from current state so no param ever gets dropped.
	// Switching gender or division drops the date so the server picks the right
	// default for that sport/division rather than carrying over an unrelated date.
	function navigate(overrides: Record<string, string | number> = {}) {
		const switchingSport = 'gender' in overrides || 'division' in overrides;
		const sp = new URLSearchParams({
			gender,
			division: String(division),
			season:   seasonLabel,
			...(switchingSport ? {} : { date: contestDate ?? '' }),
			...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)]))
		});
		goto(`?${sp}`);
	}

	const hasPrev = $derived(
		((data.availableDates ?? []) as string[]).some(d => d < (data.contestDate ?? ''))
	);
	const hasNext = $derived(
		((data.availableDates ?? []) as string[]).some(d => d > (data.contestDate ?? ''))
	);

	function prevDate() {
		const dates = (data.availableDates ?? []) as string[];
		const prev = [...dates].reverse().find(d => d < (data.contestDate ?? ''));
		if (prev) navigate({ date: prev });
	}

	function nextDate() {
		const dates = (data.availableDates ?? []) as string[];
		const next = dates.find(d => d > (data.contestDate ?? ''));
		if (next) navigate({ date: next });
	}

	function datepicker(node: HTMLInputElement, opts: { dates: string[]; value: string }) {
		let fp: Instance = flatpickr(node, {
			dateFormat: 'Y-m-d',
			defaultDate: opts.value || undefined,
			enable: opts.dates,
			disableMobile: true,
			onChange([date]) {
				if (date) navigate({ date: date.toISOString().slice(0, 10) });
			}
		}) as Instance;

		return {
			update({ dates, value }: { dates: string[]; value: string }) {
				fp.set('enable', dates);
				fp.setDate(value, false);
			},
			destroy() { fp.destroy(); }
		};
	}

	// 'primary' is the brand accent (#e8463a, design.md) — not Tailwind's default
	// red, which is only remapped for loss/error semantics elsewhere.
	//
	// Flowbite's primary Badge is a *tint* of that accent (primary-100/900), which
	// next to the solid primary-500 date-nav buttons reads as a dimmer, muddier red
	// rather than the same accent. The Live badge overrides the fill at the call
	// site to match those buttons exactly; Final keeps the stock gray tint.
	function statusColor(s: string): 'gray' | 'primary' {
		if (s === 'live') return 'primary';
		return 'gray';
	}

	function statusLabel(s: string) {
		if (s === 'final')     return 'Final';
		if (s === 'live')      return 'Live';
		if (s === 'postponed') return 'PPD';
		if (s === 'cancelled') return 'CXLD';
		return 'Sched';
	}


	function navigateSeason(label: string) {
		const sp = new URLSearchParams({ gender, division: String(division), season: label });
		goto(`?${sp}`);
	}

	const displayDate = $derived(
		new Date(contestDate + 'T00:00:00Z').toLocaleDateString('en-US', {
			weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
		})
	);
	const shortDate = $derived(
		contestDate
			? new Date(contestDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
			: ''
	);
	const genderLabel = $derived(gender === 'W' ? "Women's" : "Men's");
	const divisionLabel = $derived(division === 1 ? 'DI' : division === 2 ? 'DII' : 'DIII');
	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(`NCAA ${genderLabel} ${divisionLabel} Soccer Scores — ${shortDate} | CollegeSoccer.IO`);
	const pageDesc = $derived(`Live NCAA ${genderLabel.toLowerCase()} ${divisionLabel} college soccer scores for ${displayDate}. Results, boxscores, and player stats.`);
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

<!-- Status filters, shared by the mobile strip (wrapping row) and the desktop
     sidebar (stacked list). The count sits hard right on desktop via ml-auto,
     which is a no-op in the shrink-wrapped mobile chips. -->
{#snippet sectionFilters(cls: string)}
	<div class="flex gap-x-3 gap-y-1 {cls}">
		{#each SECTIONS as s}
			{@const on = shown[s.key]}
			<button
				type="button"
				role="checkbox"
				aria-checked={on}
				aria-label="Show {s.label} games ({sectionCounts[s.key]})"
				onclick={() => toggleSection(s.key)}
				class="flex items-center gap-1.5 text-[11px] rounded px-0.5 py-px hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
			>
				<span
					class="shrink-0 h-3 w-3 rounded-[3px] border flex items-center justify-center transition-colors
						{on ? 'bg-primary-500 border-primary-500' : 'border-gray-300 dark:border-gray-600'}"
				>
					{#if on}
						<svg viewBox="0 0 10 10" class="h-2 w-2 text-white" aria-hidden="true">
							<path d="M1 5.2 3.6 8 9 2" fill="none" stroke="currentColor" stroke-width="2"
								stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{/if}
				</span>
				<span class={on ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}>{s.label}</span>
				<span class="ml-auto pl-1 tabular-nums text-[10px] text-gray-400 dark:text-gray-500">{sectionCounts[s.key]}</span>
			</button>
		{/each}
	</div>
{/snippet}

<!-- One switch, two placements: the mobile strip and the desktop sidebar. -->
{#snippet pickemToggle(cls: string)}
	<div class="flex items-center gap-2 {cls}">
		<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Pick'em</span>
		<button
			type="button"
			role="switch"
			aria-checked={pickemOn}
			aria-label="Show pick'em controls on game cards"
			onclick={togglePickem}
			class="shrink-0 flex h-5 w-9 items-center rounded-full p-0.5 transition-colors
				{pickemOn ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}"
		>
			<span
				class="h-4 w-4 rounded-full bg-white shadow-sm transition-transform
					{pickemOn ? 'translate-x-4' : 'translate-x-0'}"
			></span>
		</button>
	</div>
{/snippet}

<div class="flex flex-col gap-2 md:flex-row md:items-start">

	<!-- Navigation controls -->
	<aside class="w-full md:w-44 md:shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">

		<!-- Mobile: compact horizontal strip -->
		<div class="flex items-center gap-2 flex-wrap p-2 md:hidden">
			<!-- Gender -->
			<div class="flex gap-1">
				{#each [{ label: 'Men', value: 'M' }, { label: 'Women', value: 'W' }] as g}
					<button
						onclick={() => navigate({ gender: g.value })}
						class="px-2 py-1 text-xs rounded font-semibold transition-colors
							{gender === g.value
								? 'bg-primary-500 text-white'
								: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}"
					>{g.label}</button>
				{/each}
			</div>
			<!-- Season -->
			<button
				id="mob-season-scores"
				class="text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 rounded px-1.5 py-1 flex items-center gap-1"
			>
				{seasonLabel} <span class="text-gray-400 dark:text-gray-500 text-[10px]">▾</span>
			</button>
			<Dropdown triggeredBy="#mob-season-scores" placement="bottom-start" simple>
				{#each seasons as s}
					<DropdownItem onclick={() => navigateSeason(s.label)}>{s.label}</DropdownItem>
				{/each}
			</Dropdown>
			<!-- Pick'em -->
			{@render pickemToggle('ml-auto')}
		</div>

		<!-- Mobile: filters get their own row — four chips plus the strip above
		     would wrap into an unreadable jumble on a narrow phone. -->
		<div class="md:hidden border-t border-gray-200 dark:border-gray-700 px-2 py-1.5">
			{@render sectionFilters('flex-wrap')}
		</div>

		<!-- Desktop: vertical sidebar -->
		<div class="hidden md:block">
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
					value={seasonLabel}
					onchange={(e) => navigateSeason((e.target as HTMLSelectElement).value)}
				>
					{#each seasons as s}
						<option value={s.label}>{s.label}</option>
					{/each}
				</select>
			</div>

			<!-- Show / hide by status -->
			<div class="border-b border-gray-200 dark:border-gray-700 px-2 py-2">
				<p class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Show</p>
				{@render sectionFilters('flex-col')}
			</div>

			<!-- Pick'em -->
			<div class="p-2">
				{@render pickemToggle('w-full justify-between')}
			</div>
		</div>
	</aside>

	<!-- Scores panel -->
	<section class="flex-1 min-w-0 bg-gray-50 dark:bg-gray-900/60 rounded overflow-hidden">
		<!-- Date picker header -->
		<div class="flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-900">
			<button
				onclick={prevDate}
				disabled={!hasPrev}
				aria-label="Previous day with games"
				class="shrink-0 px-3 py-1.5 rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
			>‹</button>

			<span class="flex-1 text-xs font-semibold text-gray-700 dark:text-gray-300 text-center">{displayDate}</span>

			<button
				onclick={nextDate}
				disabled={!hasNext}
				aria-label="Next day with games"
				class="shrink-0 px-3 py-1.5 rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
			>›</button>

			<input
				use:datepicker={{ dates: (data.availableDates ?? []) as string[], value: data.contestDate ?? '' }}
				type="text"
				readonly
				class="shrink-0 w-28 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
					border border-gray-200 dark:border-gray-600 rounded px-2 py-1 cursor-pointer
					focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
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
			{#snippet cardInner(game: Game)}
				{@const home = game.home_team_season}
				{@const away = game.away_team_season}
				{@const isFinal = game.status === 'final'}
				{@const isLive  = game.status === 'live'}
				{@const homeAdvanced = isFinal && game.shootout && game.shootout_winner_team_season_id === game.home_team_season_id}
				{@const awayAdvanced = isFinal && game.shootout && game.shootout_winner_team_season_id === game.away_team_season_id}
				{@const homeWon = (isFinal && game.home_score != null && game.away_score != null && game.home_score > game.away_score) || homeAdvanced}
				{@const awayWon = (isFinal && game.home_score != null && game.away_score != null && game.away_score > game.home_score) || awayAdvanced}
				{@const pick     = picks[game.id]}
				{@const pickable = isGameOpen(game)}
				{@const verdict  = displayResult(game, pick)}

				<!-- Header row: round/broadcaster left, status/time right -->
							<div class="flex items-center justify-between gap-2 mb-1.5">
								<div class="flex items-center gap-1.5 min-w-0 text-[10px]">
									{#if game.round_description}
										<span class="font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide">{game.round_description}</span>
									{/if}
									{#if game.round_description && game.broadcaster_name}
										<span class="text-gray-300 dark:text-gray-600">·</span>
									{/if}
									{#if game.broadcaster_name}
										<span class="text-gray-400 dark:text-gray-500">{game.broadcaster_name}</span>
									{/if}
								</div>
								<div class="shrink-0 flex items-center gap-1">
									{#if isFinal && game.shootout}
										<span title="Decided by penalty-kick shootout (counts as a tie)"
											class="rounded-sm bg-gray-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">PK</span>
									{/if}
									{#if isLive && game.current_period}
										<!-- Feed's `currentPeriod`, already uppercase ("1ST HALF"). The
										     matching `contestClock` is deliberately not shown: it only
										     refreshes on the one-minute live cron, so a ticking-looking
										     clock would sit frozen and up to a minute stale. -->
										<span class="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
											{game.current_period}
										</span>
									{/if}
									{#if isFinal || isLive}
										<Badge
											color={statusColor(game.status)}
											class="text-[10px] px-1.5 py-0 font-semibold
												{isLive ? 'bg-primary-500 text-white dark:bg-primary-500 dark:text-white' : ''}"
										>
											{statusLabel(game.status)}
										</Badge>
									{:else}
										<!-- No start_time = NCAA hasn't set a kickoff yet (feed flags it TBA and
										     ships a placeholder epoch, which the ingest discards). Label it rather
										     than rendering blank space, which reads as a broken card. -->
										<span class="text-[11px] text-gray-400 dark:text-gray-500">
											{formatTime(game.start_time) || 'TBD'}
										</span>
									{/if}
								</div>
							</div>

							<!-- Away row -->
							<div class="flex items-center justify-between gap-2">
								<a href={away?.team.ncaa_team_id ? teamHref(away.team.ncaa_team_id) : '#'}
									onclick={(e) => e.stopPropagation()}
									class="flex items-center gap-2 min-w-0 text-xs hover:underline
										{awayWon ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}">
									<TeamLogo lightUrl={away?.team.logo_url_light} darkUrl={away?.team.logo_url_dark} name={away?.team.name ?? ''} size={32} />
									<span class="truncate">{away?.team.name ?? '—'}</span>
								</a>
								<div class="shrink-0 flex items-center gap-2">
									{#if game.away_score != null}
										<span class="text-base font-bold tabular-nums
											{awayWon ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">
											{game.away_score}
										</span>
									{/if}
								</div>
							</div>

							<!-- Home row -->
							<div class="flex items-center justify-between gap-2 mt-2">
								<a href={home?.team.ncaa_team_id ? teamHref(home.team.ncaa_team_id) : '#'}
									onclick={(e) => e.stopPropagation()}
									class="flex items-center gap-2 min-w-0 text-xs hover:underline
										{homeWon ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}">
									<TeamLogo lightUrl={home?.team.logo_url_light} darkUrl={home?.team.logo_url_dark} name={home?.team.name ?? ''} size={32} />
									<span class="truncate">
										{home?.team.name ?? '—'}
										{#if !game.neutral_site}
											<span class="text-[10px] text-gray-400 dark:text-gray-500 font-normal"> (H)</span>
										{/if}
									</span>
								</a>
								<div class="shrink-0 flex items-center gap-2">
									{#if game.home_score != null}
										<span class="text-base font-bold tabular-nums
											{homeWon ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">
											{game.home_score}
										</span>
									{/if}
								</div>
							</div>

							<!-- Pick'em tools: the same three rows before and after kickoff —
							     pickable while the game is open, a coloured result once it
							     locks. Anonymous visitors get the prompt instead of controls,
							     and no result rows: there's no pick of theirs to grade. -->
							{#if pickemOn && signedIn}
								<div class="mt-2.5">
									<PickButtons
										away={away?.team.name ?? 'Away'}
										home={home?.team.name ?? 'Home'}
										selected={pick?.outcome ?? null}
										open={pickable}
										actual={actualOutcome(game)}
										result={verdict}
										busy={pending[game.id] ?? false}
										onpick={(next) => setPick(game.id, next)}
									/>
								</div>
							{:else if pickemOn && pickable}
								<a
									href="/login?redirect=/scores"
									onclick={(e) => e.stopPropagation()}
									class="mt-2.5 block text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400"
								>Sign in to pick</a>
							{/if}
			{/snippet}

			{#if visibleGames.length === 0}
				<div class="py-12 text-center">
					<p class="text-sm font-semibold text-gray-800 dark:text-gray-200">Nothing to show</p>
					<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
						All {games.length} {games.length === 1 ? 'game' : 'games'} on this date are hidden by your filters.
					</p>
					<button
						onclick={showAllSections}
						class="mt-3 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
					>Show all</button>
				</div>
			{/if}

			<ul class="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-2">
				{#each visibleGames as game, i}
					{@const isLive = game.status === 'live'}
					<!-- Rule at each section change. Comparing against the previous card means
					     a divider only exists where both sides do, so an all-final slate (or one
					     with no TBD games) never renders a stray leading rule. The one exception
					     is a leading "Live" rule, which needs no card above it to be meaningful —
					     it's what the following "Upcoming" rule is dividing from. Decorative only —
					     each card already states its own status. -->
					{#if i === 0 ? isLive : slateRank(game) !== slateRank(visibleGames[i - 1])}
						<li aria-hidden="true" class="lg:col-span-2 flex items-center gap-2 {i > 0 ? 'mt-1' : ''}">
							<span class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
							<span class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
								{sectionLabel(slateRank(game))}
							</span>
							<span class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
						</li>
					{/if}
					<li class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
						{#if isLive}
							<!-- Live games don't link into the box score — player stats aren't scraped
							     until the overnight reconcile, so the box-score page would be empty. -->
							<div class="px-3 py-2 h-full flex flex-col justify-between">
								{@render cardInner(game)}
							</div>
						{:else}
							<div role="link" tabindex="0"
								onclick={() => goto(gameHref(game.ncaa_contest_id))}
								onkeydown={(e) => e.key === 'Enter' && goto(gameHref(game.ncaa_contest_id))}
								class="px-3 py-2 h-full flex flex-col justify-between hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer">
								{@render cardInner(game)}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
