<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Button, Dropdown, DropdownItem } from 'flowbite-svelte';
	import { ChevronDownOutline } from 'flowbite-svelte-icons';
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import TeamRoster from '$lib/components/TeamRoster.svelte';
	import ArticleCard from '$lib/components/ArticleCard.svelte';
	import type { ArticleCard as ArticleCardType } from '$lib/server/articles';
	import { formatTime } from '$lib/format';
	import type { PageData } from './$types';
	import type { ScheduleGame } from './+page.server';
	import posthog from 'posthog-js';

	let { data }: { data: PageData } = $props();

	const team           = $derived(data.team);
	const teamSeason     = $derived(data.teamSeason);
	const conferenceName = $derived(data.conferenceName);
	const sport          = $derived(data.sport);
	const division       = $derived(data.division);
	const seasonLabel    = $derived(data.seasonLabel);
	const seasons        = $derived(data.seasons);
	const tc             = $derived(team.team_color);

	// The News tab only exists for teams that have connected published articles.
	const hasNews = $derived((data.news?.length ?? 0) > 0);
	const tabs = $derived([
		{ key: 'schedule' as const, label: 'Schedule' },
		{ key: 'roster' as const, label: 'Roster' },
		...(hasNews ? [{ key: 'news' as const, label: 'News' }] : [])
	]);

	// Honor ?tab=roster|news (e.g. linked from a player page breadcrumb); default
	// to schedule. ?tab=news is only respected when the team actually has news.
	const tabParam = page.url.searchParams.get('tab');
	let activeTab = $state<'roster' | 'schedule' | 'news'>(
		tabParam === 'roster' ? 'roster' : tabParam === 'news' && (data.news?.length ?? 0) > 0 ? 'news' : 'schedule'
	);

	const gender      = $derived(sport === 'WSO' ? 'W' : 'M');
	const genderLabel = $derived(gender === 'W' ? "Women's" : "Men's");
	const divLabel    = $derived(division === 1 ? 'DI' : division === 2 ? 'DII' : 'DIII');

	// Returns a darker, slightly desaturated version of a hex color — same hue, looks like a shadow.
	function shadowColor(hex: string): string {
		const h = hex.startsWith('#') ? hex.slice(1) : hex;
		if (h.length !== 6) return hex;
		const r = parseInt(h.slice(0, 2), 16) / 255;
		const g = parseInt(h.slice(2, 4), 16) / 255;
		const b = parseInt(h.slice(4, 6), 16) / 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		const l = (max + min) / 2;
		const d = max - min;
		let hue = 0, sat = 0;
		if (d !== 0) {
			sat = d / (l > 0.5 ? 2 - max - min : max + min);
			hue = max === r ? (g - b) / d + (g < b ? 6 : 0)
				: max === g ? (b - r) / d + 2
				: (r - g) / d + 4;
			hue /= 6;
		}
		return `hsl(${Math.round(hue * 360)}, ${Math.round(sat * 85)}%, ${Math.round(l * 70 * 100) / 100}%)`;
	}

	onMount(() => {
		posthog.capture('team_viewed', {
			team_id: team.ncaa_team_id,
			team_name: team.name,
			sport,
			division,
			season: seasonLabel,
			conference: conferenceName
		});
	});

	let seasonDropdownOpen = $state(false);
	function navigateSeason(label: string) {
		posthog.capture('team_season_changed', {
			team_id: team.ncaa_team_id,
			team_name: team.name,
			old_season: seasonLabel,
			new_season: label,
			sport,
			division
		});
		const sp = new URLSearchParams({ sport, division: String(division), season: label });
		goto(`/teams/${team.ncaa_team_id}?${sp}`);
		seasonDropdownOpen = false;
	}

	const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);
	const pageTitle = $derived(`${team.name} — ${seasonLabel} Soccer Schedule & Roster | CollegeSoccer.IO`);
	const pageDesc = $derived(`${team.name} ${seasonLabel} NCAA soccer schedule, roster, and player stats.${conferenceName ? ` ${conferenceName}.` : ''}`);

	function playerHref(ncaaPlayerId: string) {
		return `/players/${ncaaPlayerId}?sport=${sport}&division=${division}&season=${seasonLabel}`;
	}
	function gameHref(ncaaContestId: string) {
		return `/games/${ncaaContestId}?sport=${sport}&division=${division}&season=${seasonLabel}&from=${team.ncaa_team_id}`;
	}

	// ── News tab: paginated "Load more" over the team's tagged articles ─────
	// Local appendable list seeded from SSR; re-seeded on season/sport nav.
	let newsCards = $state<ArticleCardType[]>((data.news as ArticleCardType[]) ?? []);
	let newsOffset = $state<number>(data.newsNextOffset ?? 0);
	let newsHasMore = $state<boolean>(data.newsHasMore ?? false);
	let newsLoading = $state(false);
	let newsError = $state('');

	$effect(() => {
		newsCards = (data.news as ArticleCardType[]) ?? [];
		newsOffset = data.newsNextOffset ?? 0;
		newsHasMore = data.newsHasMore ?? false;
	});

	async function loadMoreNews() {
		newsLoading = true;
		newsError = '';
		try {
			const res = await fetch(`/api/news?team=${team.id}&sport=${sport}&offset=${newsOffset}&limit=9`);
			if (!res.ok) throw new Error(`${res.status}`);
			const body = await res.json();
			newsCards = [...newsCards, ...(body.articles ?? [])];
			newsOffset = body.nextOffset ?? newsOffset;
			newsHasMore = !!body.hasMore;
		} catch (e) {
			newsError = e instanceof Error ? e.message : String(e);
		} finally {
			newsLoading = false;
		}
	}

	// ── Schedule helpers (team's perspective) ──────────────────────────────
	const isHome      = (g: ScheduleGame) => g.home_team_season_id === teamSeason?.id;
	const opponent    = (g: ScheduleGame) => (isHome(g) ? g.away_team_season?.team : g.home_team_season?.team);
	const oppConfName = (g: ScheduleGame) => (isHome(g) ? g.away_team_season?.conference?.name : g.home_team_season?.conference?.name) ?? null;
	const oppConfShort= (g: ScheduleGame) => (isHome(g) ? g.away_team_season?.conference?.short_name : g.home_team_season?.conference?.short_name) ?? null;
	const isFinal     = (g: ScheduleGame) => g.status === 'final' && g.home_score != null && g.away_score != null;
	// A game counts toward the division record only when the opponent is a
	// division member, mirroring get_standings. The per-division NCAA feed
	// includes non-D1 opponents; those games show in the schedule but aren't counted.
	const oppTeamSeason = (g: ScheduleGame) => (isHome(g) ? g.away_team_season : g.home_team_season);
	const oppIsMember   = (g: ScheduleGame) => oppTeamSeason(g)?.division_member !== false;

	function myScore(g: ScheduleGame) {
		if (g.home_score == null || g.away_score == null) return null;
		return isHome(g) ? g.home_score : g.away_score;
	}
	function oppScore(g: ScheduleGame) {
		if (g.home_score == null || g.away_score == null) return null;
		return isHome(g) ? g.away_score : g.home_score;
	}
	function result(g: ScheduleGame): 'W' | 'L' | 'T' | null {
		const my = myScore(g), op = oppScore(g);
		if (my == null || op == null) return null;
		return my > op ? 'W' : my < op ? 'L' : 'T';
	}
	// Penalty-shootout outcome from this team's perspective. The game itself stays a
	// tie (NCAA convention), so result() is unchanged; this only flags who advanced.
	function pkResult(g: ScheduleGame): 'won' | 'lost' | null {
		if (!g.shootout || teamSeason?.id == null) return null;
		return g.shootout_winner_team_season_id === teamSeason.id ? 'won' : 'lost';
	}

	function dateParts(iso: string) {
		const d = new Date(iso + 'T00:00:00Z');
		const fmt = (opt: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', { ...opt, timeZone: 'UTC' });
		return {
			key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
			monthAbbr: fmt({ month: 'short' }),
			monthName: fmt({ month: 'long' }),
			day: d.getUTCDate(),
			weekday: fmt({ weekday: 'short' })
		};
	}

	// Group games by month, preserving schedule (date) order.
	const groups = $derived.by(() => {
		const out: { key: string; monthName: string; games: ScheduleGame[] }[] = [];
		for (const g of data.schedule) {
			const p = dateParts(g.contest_date);
			const last = out[out.length - 1];
			if (last && last.key === p.key) last.games.push(g);
			else out.push({ key: p.key, monthName: p.monthName, games: [g] });
		}
		return out;
	});

	// Season-record summary derived from completed games. Only games against
	// fellow division members count toward the record/goals/form, matching the
	// standings page; non-division (e.g. non-D1) games still appear below.
	const finals = $derived(data.schedule.filter(isFinal));
	const countedFinals = $derived(finals.filter(oppIsMember));
	const summary = $derived.by(() => {
		let w = 0, l = 0, t = 0, cw = 0, cl = 0, ct = 0, gf = 0, ga = 0;
		for (const g of countedFinals) {
			const r = result(g)!;
			gf += myScore(g)!;
			ga += oppScore(g)!;
			if (r === 'W') w++; else if (r === 'L') l++; else t++;
			if (oppConfName(g) && oppConfName(g) === conferenceName) {
				if (r === 'W') cw++; else if (r === 'L') cl++; else ct++;
			}
		}
		let streak: { type: 'W' | 'L' | 'T' | null; n: number } = { type: null, n: 0 };
		for (let i = countedFinals.length - 1; i >= 0; i--) {
			const r = result(countedFinals[i])!;
			if (streak.type == null) streak = { type: r, n: 1 };
			else if (r === streak.type) streak.n++;
			else break;
		}
		const form = countedFinals.slice(-10).map((g) => result(g)!);
		return { w, l, t, cw, cl, ct, gf, ga, gd: gf - ga, streak, form };
	});

	const rec = (w: number, l: number, t: number) => `${w}-${l}-${t}`;

	const summaryCells = $derived([
		{ label: 'Overall', value: rec(summary.w, summary.l, summary.t) },
		{ label: conferenceName ?? 'Conference', value: rec(summary.cw, summary.cl, summary.ct) },
		{ label: 'Goals For', value: String(summary.gf) },
		{ label: 'Goals Against', value: String(summary.ga) },
		{ label: 'Goal Diff', value: (summary.gd > 0 ? '+' : '') + summary.gd }
	]);

	// Result → color classes (chips, accent line, scoreline emphasis).
	const resChip: Record<string, string> = {
		W: 'text-green-600 dark:text-green-400 bg-green-500/15',
		L: 'text-red-600 dark:text-red-400 bg-red-500/15',
		T: 'text-gray-500 dark:text-gray-400 bg-gray-500/15'
	};
	const resLine: Record<string, string> = {
		W: 'bg-green-500 dark:bg-green-400',
		L: 'bg-red-500 dark:bg-red-400',
		T: 'bg-gray-300 dark:bg-gray-600'
	};
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

{#snippet statCell(label: string, value: string)}
	{#if tc}
		<div class="min-w-19.5 flex-1 rounded px-3 py-2.5" style="background:rgba(255,255,255,.12)">
			<div class="font-mono text-xl font-bold leading-tight whitespace-nowrap text-white">{value}</div>
			<div class="mt-1 text-[10px] uppercase tracking-wider" style="color:rgba(255,255,255,.72)">{label}</div>
		</div>
	{:else}
		<div class="min-w-19.5 flex-1 rounded border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900">
			<div class="font-mono text-xl font-bold leading-tight whitespace-nowrap text-gray-900 dark:text-white">{value}</div>
			<div class="mt-1 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
		</div>
	{/if}
{/snippet}

<div class="space-y-3">
	<!-- Team-color hero with embedded season summary -->
	<div
		class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 {!tc ? 'bg-white dark:bg-gray-800' : ''}"
		style={tc ? `background-color: ${tc}` : ''}
	>
		<!-- Back link -->
		<div class="px-4 pt-3 pb-1">
			<a href="/teams?sport={sport}&division={division}&season={seasonLabel}"
				class="text-xs {tc ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-primary-500 dark:text-gray-400 dark:hover:text-primary-400'}">
				← Teams
			</a>
		</div>

		<!-- Logo + name + season selector -->
		<div class="flex items-center justify-between gap-4 px-4 pb-4">
			<div class="flex items-center gap-4">
				{#if team.logo_url_dark || team.logo_url_light}
					<div class="flex h-14 w-14 shrink-0 items-center justify-center">
						<TeamLogo
							lightUrl={tc ? null : team.logo_url_light}
							darkUrl={team.logo_url_dark ?? team.logo_url_light}
							name={team.name}
							size={56}
						/>
					</div>
				{/if}
				<div>
					<h1 class="text-xl font-bold tracking-tight {tc ? 'text-white' : 'text-gray-900 dark:text-white'}">{team.name}</h1>
					<p class="mt-0.5 text-xs {tc ? 'text-white/75' : 'text-gray-500 dark:text-gray-400'}">
						{conferenceName ? `${conferenceName} · ` : ''}{genderLabel} {divLabel}
					</p>
				</div>
			</div>

			<div class="shrink-0">
				<p class="mb-1 text-[10px] font-semibold uppercase tracking-wider {tc ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}">Season</p>
				<button
					onclick={() => (seasonDropdownOpen = !seasonDropdownOpen)}
					class="flex items-center gap-1.5 rounded border px-2 py-1 text-xs {tc ? 'border-white/30 bg-white/20 text-white' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'}"
				>
					{seasonLabel}
					<ChevronDownOutline class="h-3 w-3 shrink-0 opacity-70" />
				</button>
				<Dropdown bind:isOpen={seasonDropdownOpen} placement="bottom-end">
					{#each seasons as s}
						<DropdownItem onclick={() => navigateSeason(s.label)}>{s.label}</DropdownItem>
					{/each}
				</Dropdown>
			</div>
		</div>

		<!-- Season summary cells -->
		{#if finals.length > 0}
			<div class="flex flex-wrap gap-2 px-4 pb-4">
				{#each summaryCells as c (c.label)}
					{@render statCell(c.label, c.value)}
				{/each}
				<!-- Streak (colored) -->
				{#if tc}
					<div class="min-w-19.5 flex-1 rounded px-3 py-2.5" style="background:rgba(255,255,255,.12)">
						<div class="font-mono text-xl font-bold leading-tight" style="color:{summary.streak.type === 'L' ? '#ffd9d4' : '#fff'}">
							{summary.streak.type ? summary.streak.type + summary.streak.n : '—'}
						</div>
						<div class="mt-1 text-[10px] uppercase tracking-wider" style="color:rgba(255,255,255,.72)">Streak</div>
					</div>
				{:else}
					<div class="min-w-19.5 flex-1 rounded border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900">
						<div class="font-mono text-xl font-bold leading-tight
							{summary.streak.type === 'W' ? 'text-green-600 dark:text-green-400' : summary.streak.type === 'L' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}">
							{summary.streak.type ? summary.streak.type + summary.streak.n : '—'}
						</div>
						<div class="mt-1 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Streak</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Schedule / Roster / News tabs -->
	<div class="flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
		{#each tabs as tab (tab.key)}
			{@const isActive = activeTab === tab.key}
			<button
				class="flex flex-1 items-center justify-center gap-2.5 px-4 py-3 text-sm font-medium transition-colors
					{tc
						? isActive ? 'text-white' : 'text-white/60'
						: isActive
							? 'bg-gray-700 text-white dark:bg-gray-600'
							: 'bg-white text-gray-500 hover:bg-gray-700 hover:text-white dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-600'}"
				style={tc ? (isActive ? `background-color: ${tc};` : `background-color: ${shadowColor(tc)};`) : ''}
				onclick={() => {
					posthog.capture('team_tab_switched', {
						tab: tab.key,
						team_id: team.ncaa_team_id,
						team_name: team.name,
						sport,
						division,
						season: seasonLabel
					});
					activeTab = tab.key;
				}}
			>
				<span>{tab.label}</span>
			</button>
		{/each}
	</div>

	<!-- ── SCHEDULE TAB ──────────────────────────────────────────────────── -->
	{#if activeTab === 'schedule'}
		{#if !teamSeason}
			<p class="text-sm text-gray-500 dark:text-gray-400">No schedule data for the {seasonLabel} season.</p>
		{:else if data.schedule.length === 0}
			<p class="text-sm text-gray-500 dark:text-gray-400">No games found. Run the backfill to populate.</p>
		{:else}
			<div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
				<!-- Recent form guide -->
				{#if summary.form.length > 0}
					<div class="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-3.5 py-2.5 dark:border-gray-700 dark:bg-gray-900">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Last {summary.form.length}</span>
						<div class="flex gap-1">
							{#each summary.form as r, i (i)}
								<span class="inline-flex h-4.75 w-4.75 items-center justify-center rounded-sm font-mono text-[11px] font-bold {resChip[r]}">{r}</span>
							{/each}
						</div>
						<span class="ml-auto text-[10px] text-gray-400 dark:text-gray-500">most recent →</span>
					</div>
				{/if}

				<!-- Month-grouped game rows -->
				{#each groups as grp (grp.key)}
					<div class="flex items-center gap-2.5 border-b border-gray-200 bg-gray-50 px-3.5 py-2 dark:border-gray-700 dark:bg-gray-900">
						<span class="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">{grp.monthName}</span>
						<span class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
						<span class="text-[10px] text-gray-400 dark:text-gray-500">{grp.games.length} {grp.games.length === 1 ? 'game' : 'games'}</span>
					</div>

					{#each grp.games as g (g.ncaa_contest_id)}
						{@const opp = opponent(g)}
						{@const r = result(g)}
						{@const final = isFinal(g)}
						{@const counted = oppIsMember(g)}
						{@const p = dateParts(g.contest_date)}
						{@const confShort = oppConfShort(g)}
						<a
							href={gameHref(g.ncaa_contest_id)}
							class="grid grid-cols-[3px_64px_28px_1fr_auto] items-center border-b border-gray-200 transition-colors last:border-0 hover:bg-gray-50 md:grid-cols-[3px_76px_34px_1fr_auto_96px] dark:border-gray-700 dark:hover:bg-gray-700/30"
						>
							<!-- result accent line -->
							<span class="self-stretch {r ? resLine[r] : ''}" style={final ? '' : 'opacity:0'}></span>
							<!-- date -->
							<div class="py-2.5 pl-3">
								<div class="font-mono text-xs font-semibold text-gray-900 dark:text-white">{p.monthAbbr} {p.day}</div>
								<div class="mt-px text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{p.weekday}</div>
							</div>
							<!-- vs / @ -->
							<div class="justify-self-center font-mono text-xs font-semibold text-gray-500 dark:text-gray-400">{isHome(g) ? 'vs' : '@'}</div>
							<!-- opponent -->
							<div class="flex min-w-0 items-center gap-2.5 py-2">
								{#if opp}
									<span class="flex h-6.5 w-6.5 shrink-0 items-center justify-center">
										<TeamLogo lightUrl={opp.logo_url_light} darkUrl={opp.logo_url_dark} name={opp.name} size={26} />
									</span>
								{/if}
								<div class="min-w-0">
									<div class="flex items-center gap-1.5">
										<span class="truncate text-sm text-gray-900 dark:text-white">{opp?.name ?? '—'}</span>
										{#if final && !counted}
											<span
												title="Non-division opponent — not counted in the record"
												class="shrink-0 rounded-sm bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
											>non-{divLabel}</span>
										{/if}
									</div>
									<div class="mt-px text-[10px] text-gray-400 dark:text-gray-500">
										{confShort ?? ''}{isHome(g) ? '' : confShort ? ' · Away' : 'Away'}
									</div>
								</div>
							</div>
							<!-- score / result -->
							<div class="flex items-center justify-end gap-2.5 py-2 pr-2 md:pr-0">
								{#if r}
									{@const my = myScore(g)}
									{@const them = oppScore(g)}
									{@const pk = pkResult(g)}
									<span class="font-mono text-sm">
										<span class={r === 'W' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>{my}</span>
										<span class="mx-px text-gray-400">–</span>
										<span class={r === 'L' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>{them}</span>
									</span>
									{#if pk}
										<span
											title={pk === 'won' ? 'Advanced on penalties (counts as a tie)' : 'Lost on penalties (counts as a tie)'}
											class="shrink-0 rounded-sm px-1 py-px text-[9px] font-semibold uppercase tracking-wide {pk === 'won' ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}"
										>PK {pk === 'won' ? 'W' : 'L'}</span>
									{/if}
									<span class="inline-flex h-5.5 w-5.5 items-center justify-center rounded-sm font-mono text-[11px] font-bold {resChip[r]}">{r}</span>
								{:else}
									<span class="text-xs text-gray-400 dark:text-gray-500">
										{formatTime(g.start_time) || 'TBD'}
									</span>
								{/if}
							</div>
							<!-- boxscore / preview (md+) -->
							<div class="hidden justify-self-end pr-3 md:block">
								{#if final}
									<span class="rounded-sm border border-gray-200 px-2.5 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">Boxscore</span>
								{:else}
									<span class="text-[10px] text-gray-400 dark:text-gray-500">Preview</span>
								{/if}
							</div>
						</a>
					{/each}
				{/each}

				<!-- Legend -->
				<div class="flex gap-4 px-3.5 py-2.5 text-[10px] text-gray-400 dark:text-gray-500">
					<span><b class="font-semibold text-gray-500 dark:text-gray-400">vs</b> home</span>
					<span><b class="font-semibold text-gray-500 dark:text-gray-400">@</b> away</span>
				</div>
			</div>
		{/if}

	<!-- ── ROSTER TAB ────────────────────────────────────────────────────── -->
	{:else if activeTab === 'roster'}
		{#if !teamSeason}
			<p class="text-sm text-gray-500 dark:text-gray-400">No team data found for the {seasonLabel} season.</p>
		{:else if data.players.length === 0}
			<p class="text-sm text-gray-500 dark:text-gray-400">No player stats available for this season. Check back later.</p>
		{:else}
			<TeamRoster players={data.players} {playerHref} />
		{/if}

	<!-- ── NEWS TAB ──────────────────────────────────────────────────────── -->
	{:else}
		{#if newsCards.length === 0}
			<p class="text-sm text-gray-500 dark:text-gray-400">No news for this team yet.</p>
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each newsCards as article (article.id)}
					<ArticleCard {article} />
				{/each}
			</div>

			<div class="mt-6 flex flex-col items-center gap-2">
				{#if newsError}
					<p class="text-xs text-red-500">Couldn’t load more ({newsError}). <button class="underline" onclick={loadMoreNews}>Retry</button></p>
				{/if}
				{#if newsHasMore}
					<Button color="alternative" size="sm" disabled={newsLoading} onclick={loadMoreNews}>
						{newsLoading ? 'Loading…' : 'Load more'}
					</Button>
				{:else}
					<p class="text-xs text-gray-400 dark:text-gray-500">You’re all caught up.</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>
