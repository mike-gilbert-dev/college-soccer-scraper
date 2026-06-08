<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Badge, Dropdown, DropdownItem } from 'flowbite-svelte';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
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
	function navigate(overrides: Record<string, string | number> = {}) {
		const sp = new URLSearchParams({
			gender,
			division: String(division),
			season:   seasonLabel,
			date:     contestDate ?? '',
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

	function formatTime(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleTimeString('en-US', {
			hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
		});
	}

	function statusColor(s: string): 'gray' | 'red' {
		if (s === 'live') return 'red';
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
		</div>
	</aside>

	<!-- Scores panel -->
	<section class="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
		<!-- Date picker header -->
		<div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
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
							class="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer">

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
								<div class="shrink-0">
									{#if isFinal || isLive}
										<Badge color={statusColor(game.status)} class="text-[10px] px-1.5 py-0 font-semibold">
											{statusLabel(game.status)}
										</Badge>
									{:else if game.start_time}
										<span class="text-[11px] text-gray-400 dark:text-gray-500">{formatTime(game.start_time)}</span>
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
								{#if game.away_score != null}
									<span class="text-base font-bold tabular-nums shrink-0
										{awayWon ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">
										{game.away_score}
									</span>
								{/if}
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
								{#if game.home_score != null}
									<span class="text-base font-bold tabular-nums shrink-0
										{homeWon ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}">
										{game.home_score}
									</span>
								{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
