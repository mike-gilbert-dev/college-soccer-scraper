<script lang="ts">
	// Redesigned boxscore body: head-to-head team totals, a derived scoring &
	// cards summary, and both teams stacked — each with starters/subs split,
	// goalkeepers in their own table, sortable columns, and visible discipline.
	// Ported from the CollegeSoccer.IO design system (GameScreen).
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import type { PlayerStat } from '../../routes/games/[ncaa_contest_id]/+page.server';

	type GameTeam = {
		ncaa_team_id: string; name: string;
		logo_url_dark: string | null; logo_url_light: string | null; team_color: string | null;
	};

	let {
		awayTeam,
		homeTeam,
		awayStats,
		homeStats,
		playerHref,
		teamHref
	}: {
		awayTeam: GameTeam | null;
		homeTeam: GameTeam | null;
		awayStats: PlayerStat[];
		homeStats: PlayerStat[];
		playerHref: (ncaaPlayerId: string) => string;
		teamHref: (ncaaTeamId: string) => string;
	} = $props();

	const YELLOW = '#f4c430';
	const RED = '#d62b2b';

	type Field = { no: number | null; name: string; ncaaId: string; pos: string; gs: boolean; min: number; g: number; a: number; sh: number; sog: number; fc: number; yc: number; rc: number };
	type Keeper = { no: number | null; name: string; ncaaId: string; gs: boolean; min: number; sv: number; ga: number; sho: boolean; fc: number; yc: number; rc: number };
	type Build = { field: Field[]; keepers: Keeper[]; totals: Record<string, number> };

	function posCode(pos: string | null): string {
		switch (pos) {
			case 'FWD': case 'F': return 'FWD';
			case 'MID': case 'M': return 'MID';
			case 'DEF': case 'D': return 'DEF';
			default: return '—';
		}
	}
	const nv = (o: object, k: string) => Number((o as Record<string, number>)[k] ?? 0);

	function build(stats: PlayerStat[]): Build {
		const field: Field[] = [];
		const keepers: Keeper[] = [];
		for (const s of stats) {
			const base = {
				no: s.jersey_number, name: s.player_name, ncaaId: s.ncaa_player_id,
				gs: s.starter, min: s.minutes_played ?? 0,
				fc: s.fouls_committed, yc: s.yellow_cards, rc: s.red_cards
			};
			if (s.position === 'GK') {
				keepers.push({ ...base, sv: s.gk_saves ?? 0, ga: s.gk_goals_against ?? 0, sho: s.gk_shutout === true });
			} else {
				field.push({ ...base, pos: posCode(s.position), g: s.goals, a: s.assists, sh: s.shots, sog: s.shots_on_goal });
			}
		}
		const sum = (k: string) => stats.reduce((n, s) => n + nv(s, k), 0);
		const totals = {
			g: sum('goals'), a: sum('assists'), sh: sum('shots'), sog: sum('shots_on_goal'),
			fc: sum('fouls_committed'), yc: sum('yellow_cards'), rc: sum('red_cards'),
			sv: stats.reduce((n, s) => n + (s.gk_saves ?? 0), 0)
		};
		return { field, keepers, totals };
	}

	const awayB = $derived(build(awayStats));
	const homeB = $derived(build(homeStats));

	const awayColor = $derived(awayTeam?.team_color ?? '#64748b');
	const homeColor = $derived(homeTeam?.team_color ?? '#64748b');

	const compareRows = $derived(
		[
			{ key: 'g', label: 'Goals' },
			{ key: 'sh', label: 'Shots' },
			{ key: 'sog', label: 'On target' },
			{ key: 'sv', label: 'Saves' },
			{ key: 'fc', label: 'Fouls' },
			{ key: 'yc', label: 'Yellow' },
			{ key: 'rc', label: 'Red' }
		].map((r) => ({ ...r, away: awayB.totals[r.key] ?? 0, home: homeB.totals[r.key] ?? 0 }))
	);

	function summarize(b: Build) {
		const all = [...b.field, ...b.keepers];
		const pick = (k: string) => all.filter((p) => nv(p, k) > 0).map((p) => ({ name: p.name, n: nv(p, k) }));
		return { goals: pick('g'), assists: pick('a'), yellows: pick('yc'), reds: pick('rc') };
	}
	const awaySummary = $derived(summarize(awayB));
	const homeSummary = $derived(summarize(homeB));

	// ── sorting (shared across both teams) ──────────────────────────────────
	let sortKey = $state('');
	let sortDir = $state<'asc' | 'desc'>('desc');
	function onSort(key: string) {
		if (key === sortKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortKey = key; sortDir = key === 'name' || key === 'pos' ? 'asc' : 'desc'; }
	}
	function sortField(field: Field[]): Field[] {
		if (!sortKey) return field;
		const dir = sortDir === 'asc' ? 1 : -1;
		const POS: Record<string, number> = { DEF: 0, MID: 1, FWD: 2, '—': 3 };
		return [...field].sort((a, b) => {
			if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
			if (sortKey === 'pos') return ((POS[a.pos] - POS[b.pos]) || (b.min - a.min)) * dir;
			if (sortKey === 'gs') return ((Number(a.gs) - Number(b.gs)) || (b.min - a.min)) * dir;
			const d = (nv(a, sortKey) - nv(b, sortKey)) * dir;
			return d !== 0 ? d : (b.min - a.min) || ((a.no ?? 0) - (b.no ?? 0));
		});
	}
	const ind = (active: boolean) => (active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

	const FIELD_COLS = [
		{ key: 'g', label: 'G', stat: true },
		{ key: 'a', label: 'A', stat: true },
		{ key: 'sh', label: 'Sh' },
		{ key: 'sog', label: 'SOG' },
		{ key: 'fc', label: 'FC', muted: true },
		{ key: 'yc', label: 'YC', card: YELLOW },
		{ key: 'rc', label: 'RC', card: RED }
	];
	const FIELD_GRID = '26px minmax(0,1fr) 38px 28px 44px 30px 30px 34px 40px 34px 34px 34px';
	const KEEPER_GRID = '26px minmax(0,1fr) 38px 28px 44px 40px 36px 42px 34px 34px 34px';
	const thBase = 'py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap';
</script>

{#snippet ball(size: number)}
	<svg width={size} height={size} viewBox="0 0 24 24" class="block shrink-0">
		<circle cx="12" cy="12" r="10.5" fill="#fff" stroke="currentColor" stroke-width="1.4" />
		<path d="M12 6.4l3.4 2.5-1.3 4h-4.2l-1.3-4z" fill="currentColor" />
		<path d="M12 6.4V3.2M15.4 8.9l3-1M14.1 12.9l1.9 2.6M9.9 12.9l-1.9 2.6M8.6 8.9l-3-1" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" />
	</svg>
{/snippet}

{#snippet cardGlyph(color: string, size: number)}
	<span class="inline-block rounded-sm" style="width:{Math.round(size * 0.72)}px;height:{size}px;background:{color};box-shadow:0 0 0 1px rgba(0,0,0,.18) inset"></span>
{/snippet}

{#snippet cardCell(count: number, color: string)}
	{#if count > 0}
		<span class="inline-flex items-center gap-0.5">
			{@render cardGlyph(color, 13)}
			{#if count > 1}<span class="font-mono text-[10px] text-gray-600 dark:text-gray-400">{count}</span>{/if}
		</span>
	{:else}
		<span class="font-mono text-xs text-gray-300 dark:text-gray-600">·</span>
	{/if}
{/snippet}

{#snippet nameList(items: { name: string; n: number }[])}
	{#if items.length === 0}
		<span class="text-gray-400 dark:text-gray-500">—</span>
	{:else}
		{#each items as it, i (it.name + i)}
			<span class="text-gray-900 dark:text-white">{it.name}{#if it.n > 1}<span class="font-mono text-gray-400 dark:text-gray-500"> ×{it.n}</span>{/if}</span>{#if i < items.length - 1}<span class="text-gray-400 dark:text-gray-500">, </span>{/if}
		{/each}
	{/if}
{/snippet}

{#snippet summaryCol(team: GameTeam | null, s: ReturnType<typeof summarize>)}
	<div>
		<div class="mb-1.5 flex items-center gap-2">
			{#if team}<TeamLogo lightUrl={team.logo_url_light} darkUrl={team.logo_url_dark} name={team.name} size={18} />{/if}
			<span class="text-xs font-bold text-gray-900 dark:text-white">{team?.name ?? '—'}</span>
		</div>
		<!-- Goals -->
		<div class="flex items-baseline gap-2.5 py-1">
			<span class="flex w-14 shrink-0 items-center gap-1.5 pt-px text-gray-900 dark:text-white"><span class="flex w-3.5 justify-center">{@render ball(13)}</span><span class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Goals</span></span>
			<span class="min-w-0 flex-1 text-sm font-semibold leading-normal">{@render nameList(s.goals)}</span>
		</div>
		<!-- Assists -->
		<div class="flex items-baseline gap-2.5 py-1">
			<span class="flex w-14 shrink-0 items-center gap-1.5 pt-px"><span class="flex w-3.5 justify-center font-mono text-xs font-bold text-gray-400 dark:text-gray-500">A</span><span class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Assists</span></span>
			<span class="min-w-0 flex-1 text-sm leading-normal">{@render nameList(s.assists)}</span>
		</div>
		<!-- Yellow -->
		<div class="flex items-baseline gap-2.5 py-1">
			<span class="flex w-14 shrink-0 items-center gap-1.5 pt-px"><span class="flex w-3.5 justify-center">{@render cardGlyph(YELLOW, 12)}</span><span class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Yellow</span></span>
			<span class="min-w-0 flex-1 text-sm leading-normal">{@render nameList(s.yellows)}</span>
		</div>
		<!-- Red (only if any) -->
		{#if s.reds.length > 0}
			<div class="flex items-baseline gap-2.5 py-1">
				<span class="flex w-14 shrink-0 items-center gap-1.5 pt-px"><span class="flex w-3.5 justify-center">{@render cardGlyph(RED, 12)}</span><span class="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Red</span></span>
				<span class="min-w-0 flex-1 text-sm leading-normal">{@render nameList(s.reds)}</span>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet fieldHeader()}
	<div class="grid items-center gap-2 border-b border-gray-200 bg-gray-50 px-3.5 dark:border-gray-700 dark:bg-gray-900" style="grid-template-columns:{FIELD_GRID}">
		<div class="{thBase} text-center text-gray-500 dark:text-gray-400">#</div>
		<button onclick={() => onSort('name')} class="{thBase} text-left {sortKey === 'name' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">Name{ind(sortKey === 'name')}</button>
		<button onclick={() => onSort('pos')} class="{thBase} justify-self-center {sortKey === 'pos' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">Pos{ind(sortKey === 'pos')}</button>
		<button onclick={() => onSort('gs')} class="{thBase} justify-self-center {sortKey === 'gs' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">GS{ind(sortKey === 'gs')}</button>
		<button onclick={() => onSort('min')} class="{thBase} w-full justify-self-end text-right {sortKey === 'min' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">Min{ind(sortKey === 'min')}</button>
		{#each FIELD_COLS as c (c.key)}
			<button onclick={() => onSort(c.key)} class="{thBase} w-full justify-self-end text-right {sortKey === c.key ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">{c.label}{ind(sortKey === c.key)}</button>
		{/each}
	</div>
{/snippet}

{#snippet fieldRow(p: Field, color: string)}
	<a href={playerHref(p.ncaaId)} class="grid h-10 items-center gap-2 border-b border-gray-200 px-3.5 transition-colors last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/30" style="grid-template-columns:{FIELD_GRID}">
		<div class="justify-self-center font-mono text-sm font-bold tabular-nums text-gray-900 dark:text-white">{p.no ?? '—'}</div>
		<div class="min-w-0 truncate text-sm text-gray-900 dark:text-white">{p.name}</div>
		<div class="justify-self-center font-mono text-[10px] font-semibold tracking-wide text-gray-400 dark:text-gray-500">{p.pos}</div>
		<div class="justify-self-center">
			{#if p.gs}<span class="block h-1.75 w-1.75 rounded-full" style="background:{color}" title="Started"></span>{:else}<span class="block h-1.5 w-1.5 rounded-full border border-gray-400 opacity-60 dark:border-gray-500" title="Substitute"></span>{/if}
		</div>
		<div class="justify-self-end font-mono text-xs tabular-nums text-gray-900 dark:text-white">{p.min}</div>
		{#each FIELD_COLS as c (c.key)}
			<div class="justify-self-end">
				{#if c.card}
					{@render cardCell(nv(p, c.key), c.card)}
				{:else}
					{@const v = nv(p, c.key)}
					<span class="font-mono text-xs tabular-nums {c.stat && v > 0 ? 'font-bold text-gray-900 dark:text-white' : c.muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-400'}">{#if c.muted && v === 0}<span class="opacity-35">0</span>{:else}{v}{/if}</span>
				{/if}
			</div>
		{/each}
	</a>
{/snippet}

{#snippet divider(label: string)}
	<div class="flex items-center gap-2.5 bg-gray-50 px-3.5 py-1.5 dark:bg-gray-900">
		<span class="text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</span>
		<span class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
	</div>
{/snippet}

{#snippet keeperRow(k: Keeper, color: string)}
	<a href={playerHref(k.ncaaId)} class="grid h-10 items-center gap-2 border-b border-gray-200 px-3.5 transition-colors last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/30" style="grid-template-columns:{KEEPER_GRID}">
		<div class="justify-self-center font-mono text-sm font-bold tabular-nums text-gray-900 dark:text-white">{k.no ?? '—'}</div>
		<div class="min-w-0 truncate text-sm text-gray-900 dark:text-white">{k.name}</div>
		<div class="justify-self-center font-mono text-[10px] font-semibold tracking-wide text-gray-400 dark:text-gray-500">GK</div>
		<div class="justify-self-center">
			{#if k.gs}<span class="block h-1.75 w-1.75 rounded-full" style="background:{color}" title="Started"></span>{:else}<span class="block h-1.5 w-1.5 rounded-full border border-gray-400 opacity-60 dark:border-gray-500" title="Substitute"></span>{/if}
		</div>
		<div class="justify-self-end font-mono text-xs tabular-nums text-gray-900 dark:text-white">{k.min}</div>
		<div class="justify-self-end font-mono text-xs font-bold tabular-nums text-gray-900 dark:text-white">{k.sv}</div>
		<div class="justify-self-end font-mono text-xs tabular-nums text-gray-600 dark:text-gray-400">{k.ga}</div>
		<div class="justify-self-end">
			{#if k.sho}<span class="font-mono text-xs font-bold text-primary-600 dark:text-primary-400" title="Shutout">✓</span>{:else}<span class="font-mono text-xs text-gray-300 dark:text-gray-600">·</span>{/if}
		</div>
		<div class="justify-self-end font-mono text-xs tabular-nums text-gray-400 dark:text-gray-500">{#if k.fc === 0}<span class="opacity-35">0</span>{:else}{k.fc}{/if}</div>
		<div class="justify-self-end">{@render cardCell(k.yc, YELLOW)}</div>
		<div class="justify-self-end">{@render cardCell(k.rc, RED)}</div>
	</a>
{/snippet}

{#snippet teamSection(team: GameTeam | null, b: Build, color: string, side: string)}
	{@const starters = b.field.filter((p) => p.gs)}
	{@const subs = b.field.filter((p) => !p.gs)}
	{@const sorted = sortField(b.field)}
	<section class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<!-- banner -->
		<div class="flex items-center gap-2.5 px-3.5 py-2.5" style="background:{color}">
			{#if team}<TeamLogo lightUrl={team.logo_url_light} darkUrl={team.logo_url_dark} name={team.name} size={22} />{/if}
			<a href={team ? teamHref(team.ncaa_team_id) : '#'} class="text-sm font-bold text-white hover:underline">{team?.name ?? '—'}</a>
			<span class="text-[10px] uppercase tracking-wide text-white/80">{side}</span>
			<span class="ml-auto flex gap-3 font-mono text-xs text-white">
				<span><b>{b.totals.g}</b> <span class="opacity-75">G</span></span>
				<span><b>{b.totals.sh}</b> <span class="opacity-75">Sh</span></span>
				<span><b>{b.totals.sv}</b> <span class="opacity-75">Sv</span></span>
			</span>
		</div>

		<div class="overflow-x-auto">
			<div class="min-w-155">
				{#if b.field.length > 0}
					{@render fieldHeader()}
					{#if sortKey}
						{#each sorted as p (p.ncaaId)}{@render fieldRow(p, color)}{/each}
					{:else}
						{#each starters as p (p.ncaaId)}{@render fieldRow(p, color)}{/each}
						{#if subs.length > 0}{@render divider('Substitutes')}{/if}
						{#each subs as p (p.ncaaId)}{@render fieldRow(p, color)}{/each}
					{/if}
				{/if}

				{#if b.keepers.length > 0}
					{@render divider('Goalkeeper')}
					<div class="grid items-center gap-2 border-b border-gray-200 bg-gray-50 px-3.5 dark:border-gray-700 dark:bg-gray-900" style="grid-template-columns:{KEEPER_GRID}">
						<div class="{thBase}"></div>
						<div class="{thBase} text-left text-gray-500 dark:text-gray-400">Name</div>
						<div class="{thBase}"></div>
						<div class="{thBase}"></div>
						<div class="{thBase} w-full justify-self-end text-right text-gray-500 dark:text-gray-400">Min</div>
						<div class="{thBase} w-full justify-self-end text-right text-gray-500 dark:text-gray-400">Sv</div>
						<div class="{thBase} w-full justify-self-end text-right text-gray-500 dark:text-gray-400">GA</div>
						<div class="{thBase} w-full justify-self-end text-right text-gray-500 dark:text-gray-400">ShO</div>
						<div class="{thBase} w-full justify-self-end text-right text-gray-500 dark:text-gray-400">FC</div>
						<div class="{thBase} w-full justify-self-end text-right text-gray-500 dark:text-gray-400">YC</div>
						<div class="{thBase} w-full justify-self-end text-right text-gray-500 dark:text-gray-400">RC</div>
					</div>
					{#each b.keepers as k (k.ncaaId)}{@render keeperRow(k, color)}{/each}
				{/if}
			</div>
		</div>
	</section>
{/snippet}

<div class="flex flex-col gap-3">
	<!-- Team totals (head-to-head) -->
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<div class="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white">Team Totals</div>
		<div class="px-4 pb-3 pt-1.5">
			{#each compareRows as r (r.key)}
				{@const max = Math.max(r.away, r.home, 1)}
				{@const aw = (r.away / max) * 100}
				{@const hw = (r.home / max) * 100}
				{@const lead = r.away === r.home ? 'tie' : r.away > r.home ? 'away' : 'home'}
				<div class="grid items-center gap-2 py-1" style="grid-template-columns:30px 1fr 92px 1fr 30px">
					<div class="text-right font-mono text-sm tabular-nums {lead === 'away' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}">{r.away}</div>
					<div class="flex h-1.75 justify-end overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-900">
						<div class="h-full rounded-sm" style="width:{aw}%;background:{awayColor};opacity:{lead === 'home' ? 0.4 : 0.92}"></div>
					</div>
					<div class="text-center text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{r.label}</div>
					<div class="flex h-1.75 justify-start overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-900">
						<div class="h-full rounded-sm" style="width:{hw}%;background:{homeColor};opacity:{lead === 'away' ? 0.4 : 0.92}"></div>
					</div>
					<div class="text-left font-mono text-sm tabular-nums {lead === 'home' ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}">{r.home}</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Scoring & cards -->
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<div class="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white">Scoring &amp; Cards</div>
		<div class="grid grid-cols-1 gap-px bg-gray-200 sm:grid-cols-2 dark:bg-gray-700">
			<div class="bg-white px-4 py-3 dark:bg-gray-800">{@render summaryCol(awayTeam, awaySummary)}</div>
			<div class="bg-white px-4 py-3 dark:bg-gray-800">{@render summaryCol(homeTeam, homeSummary)}</div>
		</div>
	</div>

	<!-- sort hint -->
	<div class="-mb-1 flex justify-end">
		<span class="text-[10px] text-gray-400 dark:text-gray-500">{sortKey ? 'Click a header to re-sort both teams' : 'Click a column to sort both teams'}</span>
	</div>

	{@render teamSection(awayTeam, awayB, awayColor, 'Away')}
	{@render teamSection(homeTeam, homeB, homeColor, 'Home')}

	<!-- legend -->
	<div class="flex flex-wrap gap-4 px-1 text-[10px] text-gray-400 dark:text-gray-500">
		<span class="inline-flex items-center gap-1.5 text-gray-900 dark:text-white">{@render ball(12)}<span class="text-gray-400 dark:text-gray-500">goal</span></span>
		<span class="inline-flex items-center gap-1.5">{@render cardGlyph(YELLOW, 11)} yellow</span>
		<span class="inline-flex items-center gap-1.5">{@render cardGlyph(RED, 11)} red</span>
		<span><b class="text-gray-500 dark:text-gray-400">●</b> started · <b class="text-gray-500 dark:text-gray-400">○</b> sub</span>
		<span>GS started · FC fouls · ShO shutout</span>
	</div>
</div>
