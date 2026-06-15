<script lang="ts">
	// Redesigned roster: a leader strip, position filter pills, sortable field
	// table with per-player minutes bars and team-leader highlighting, and
	// goalkeepers split into their own panel with keeper columns. Ported from the
	// CollegeSoccer.IO design system (RosterScreen).
	import type { PlayerSeasonStat } from '../../routes/teams/[ncaa_team_id]/+page.server';

	let {
		players,
		playerHref
	}: {
		players: PlayerSeasonStat[];
		playerHref: (ncaaPlayerId: string) => string;
	} = $props();

	type Field = {
		no: number | null; name: string; ncaaId: string; pos: 'FWD' | 'MID' | 'DEF' | '—';
		gp: number; min: number; g: number; a: number; pts: number; sh: number; sog: number;
	};
	type Keeper = {
		no: number | null; name: string; ncaaId: string;
		gp: number; min: number; sv: number; ga: number; sho: number; gaa: number | null; svpct: number | null;
	};

	function posCode(pos: string | null): 'FWD' | 'MID' | 'DEF' | 'GK' | '—' {
		return pos === 'GK' ? 'GK' : pos === 'F' ? 'FWD' : pos === 'M' ? 'MID' : pos === 'D' ? 'DEF' : '—';
	}

	const fieldPlayers = $derived<Field[]>(
		players
			.filter((p) => p.position !== 'GK')
			.map((p) => ({
				no: p.jersey_number,
				name: p.player_name,
				ncaaId: p.ncaa_player_id,
				pos: posCode(p.position) as Field['pos'],
				gp: p.games_played,
				min: p.minutes_played,
				g: p.goals,
				a: p.assists,
				pts: p.points,
				sh: p.shots,
				sog: p.shots_on_goal
			}))
	);

	const keepers = $derived<Keeper[]>(
		players
			.filter((p) => p.position === 'GK')
			.map((p) => {
				const sv = p.gk_saves ?? 0;
				const ga = p.gk_goals_against ?? 0;
				return {
					no: p.jersey_number,
					name: p.player_name,
					ncaaId: p.ncaa_player_id,
					gp: p.games_played,
					min: p.minutes_played,
					sv, ga,
					sho: p.gk_shutouts,
					gaa: p.minutes_played ? Math.round((ga * 90 * 100) / p.minutes_played) / 100 : null,
					svpct: sv + ga ? Math.round((sv / (sv + ga)) * 1000) / 10 : null
				};
			})
	);

	const maxMin = $derived(Math.max(1, ...players.map((p) => p.minutes_played)));

	const leaderVals = $derived<Record<string, number>>({
		g: Math.max(0, ...fieldPlayers.map((p) => p.g)),
		a: Math.max(0, ...fieldPlayers.map((p) => p.a)),
		pts: Math.max(0, ...fieldPlayers.map((p) => p.pts))
	});
	const gkMaxSv = $derived(Math.max(0, ...keepers.map((k) => k.sv)));

	const leaders = $derived(
		[
			{ key: 'g', label: 'Goals', value: leaderVals.g, player: fieldPlayers.find((p) => p.g === leaderVals.g) },
			{ key: 'a', label: 'Assists', value: leaderVals.a, player: fieldPlayers.find((p) => p.a === leaderVals.a) },
			{ key: 'pts', label: 'Points', value: leaderVals.pts, player: fieldPlayers.find((p) => p.pts === leaderVals.pts) },
			{ key: 'sv', label: 'Saves', value: gkMaxSv, player: keepers.find((k) => k.sv === gkMaxSv) }
		].filter((l) => l.player && l.value > 0)
	);

	const counts = $derived<Record<string, number>>({
		all: players.length,
		FWD: fieldPlayers.filter((p) => p.pos === 'FWD').length,
		MID: fieldPlayers.filter((p) => p.pos === 'MID').length,
		DEF: fieldPlayers.filter((p) => p.pos === 'DEF').length,
		GK: keepers.length
	});

	const pills = [
		{ k: 'all', l: 'All' },
		{ k: 'FWD', l: 'FWD' },
		{ k: 'MID', l: 'MID' },
		{ k: 'DEF', l: 'DEF' },
		{ k: 'GK', l: 'GK' }
	];

	// ── sort state ──────────────────────────────────────────────────────────
	let filter = $state('all');
	let sortKey = $state('g');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let gkSortKey = $state('min');
	let gkSortDir = $state<'asc' | 'desc'>('desc');

	function onSort(key: string) {
		if (key === sortKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortKey = key; sortDir = key === 'name' ? 'asc' : 'desc'; }
	}
	function onGkSort(key: string) {
		if (key === gkSortKey) gkSortDir = gkSortDir === 'asc' ? 'desc' : 'asc';
		else { gkSortKey = key; gkSortDir = key === 'name' ? 'asc' : 'desc'; }
	}

	const num = (o: object, key: string) => Number((o as Record<string, number>)[key] ?? 0);

	const fieldRows = $derived.by(() => {
		if (filter === 'GK') return [] as Field[];
		const base = filter === 'all' ? fieldPlayers : fieldPlayers.filter((p) => p.pos === filter);
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...base].sort((a, b) => {
			if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
			if (sortKey === 'pos') {
				const order = ['FWD', 'MID', 'DEF', '—'];
				const d = (order.indexOf(a.pos) - order.indexOf(b.pos)) * dir;
				return d !== 0 ? d : b.pts - a.pts;
			}
			const d = (num(a, sortKey) - num(b, sortKey)) * dir;
			return d !== 0 ? d : b.pts - a.pts;
		});
	});

	const sortedKeepers = $derived.by(() => {
		const dir = gkSortDir === 'asc' ? 1 : -1;
		return [...keepers].sort((a, b) => {
			if (gkSortKey === 'name') return a.name.localeCompare(b.name) * dir;
			const d = (num(a, gkSortKey) - num(b, gkSortKey)) * dir;
			return d !== 0 ? d : b.min - a.min;
		});
	});

	const showGK = $derived(filter === 'all' || filter === 'GK');

	// columns
	const FIELD_COLS = [
		{ key: 'gp', label: 'GP' },
		{ key: 'min', label: 'Min' },
		{ key: 'g', label: 'G', lead: true },
		{ key: 'a', label: 'A', lead: true },
		{ key: 'pts', label: 'Pts', lead: true },
		{ key: 'sh', label: 'Sh', muted: true },
		{ key: 'sog', label: 'SOG', muted: true }
	];
	const GK_COLS = [
		{ key: 'gp', label: 'GP' },
		{ key: 'min', label: 'Min' },
		{ key: 'sv', label: 'Sv', lead: true },
		{ key: 'ga', label: 'GA' },
		{ key: 'sho', label: 'ShO' },
		{ key: 'gaa', label: 'GAA', muted: true },
		{ key: 'svpct', label: 'Sv%', muted: true }
	];
	const FIELD_GRID = '30px minmax(0,1fr) 44px 40px 84px 38px 38px 44px 40px 46px';
	const GK_GRID = '30px minmax(0,1fr) 44px 40px 84px 42px 42px 48px 52px 54px';

	const ind = (active: boolean, dir: string) => (active ? (dir === 'asc' ? ' ↑' : ' ↓') : '');

	function fmtGk(key: string, raw: number | null): string {
		if (key === 'gaa') return raw == null ? '—' : raw.toFixed(2);
		if (key === 'svpct') return raw == null ? '—' : raw + '%';
		return raw == null ? '—' : String(raw);
	}
	const nf = (n: number) => n.toLocaleString('en-US');
</script>

<div class="space-y-3">
	<!-- Leader strip -->
	{#if leaders.length > 0}
		<div class="grid gap-2" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
			{#each leaders as L (L.key)}
				{@const href = L.player?.ncaaId ? playerHref(L.player.ncaaId) : null}
				<svelte:element
					this={href ? 'a' : 'div'}
					{href}
					class="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40"
				>
					<div class="w-8 text-center">
						<div class="font-mono text-2xl font-bold leading-none text-gray-900 dark:text-white">{L.value}</div>
					</div>
					<div class="min-w-0">
						<div class="text-[10px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">{L.label}</div>
						<div class="mt-px truncate text-sm text-gray-900 dark:text-white">
							{#if L.player?.no != null}<span class="mr-1 font-mono text-gray-400 dark:text-gray-500">#{L.player.no}</span>{/if}{L.player?.name}
						</div>
					</div>
				</svelte:element>
			{/each}
		</div>
	{/if}

	<!-- Controls -->
	<div class="flex flex-wrap items-center justify-between gap-2.5">
		<div class="flex min-w-0 flex-wrap gap-1.5">
			{#each pills as it (it.k)}
				{@const active = filter === it.k}
				<button
					onclick={() => (filter = it.k)}
					class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors
						{active
							? 'border-transparent bg-primary-500 text-white'
							: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'}"
				>
					{it.l}
					<span class="font-mono text-[10px] {active ? 'opacity-85' : 'opacity-60'}">{counts[it.k]}</span>
				</button>
			{/each}
		</div>
		<span class="hidden text-[10px] text-gray-400 sm:inline dark:text-gray-500">Click a column to sort</span>
	</div>

	<!-- Roster panel -->
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<div class="overflow-x-auto">
			<div class="min-w-155">
				<!-- Field players -->
				{#if fieldRows.length > 0}
					<!-- header -->
					<div
						class="grid items-center gap-2 border-b border-gray-200 bg-gray-50 px-3.5 dark:border-gray-700 dark:bg-gray-900"
						style="grid-template-columns:{FIELD_GRID}"
					>
						<div class="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">#</div>
						<button onclick={() => onSort('name')} class="py-2 text-left text-[10px] font-semibold uppercase tracking-wide {sortKey === 'name' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">Name{ind(sortKey === 'name', sortDir)}</button>
						<button onclick={() => onSort('pos')} class="justify-self-center py-2 text-center text-[10px] font-semibold uppercase tracking-wide {sortKey === 'pos' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">Pos{ind(sortKey === 'pos', sortDir)}</button>
						{#each FIELD_COLS as c (c.key)}
							<button onclick={() => onSort(c.key)} class="justify-self-end py-2 text-right text-[10px] font-semibold uppercase tracking-wide {sortKey === c.key ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">{c.label}{ind(sortKey === c.key, sortDir)}</button>
						{/each}
					</div>
					<!-- rows -->
					{#each fieldRows as p (p.ncaaId)}
						<a
							href={playerHref(p.ncaaId)}
							class="grid min-h-11 items-center gap-2 border-b border-gray-200 px-3.5 transition-colors last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/30"
							style="grid-template-columns:{FIELD_GRID}"
						>
							<div class="justify-self-center font-mono text-sm font-bold tabular-nums text-gray-900 dark:text-white">{p.no ?? '—'}</div>
							<div class="min-w-0 truncate text-sm text-gray-900 dark:text-white">{p.name}</div>
							<div class="justify-self-center font-mono text-[10px] font-semibold tracking-wide text-gray-400 dark:text-gray-500">{p.pos}</div>
							{#each FIELD_COLS as c (c.key)}
								{#if c.key === 'min'}
									{@const pct = Math.max(4, Math.round((p.min / maxMin) * 100))}
									{@const starter = p.min / maxMin >= 0.55}
									<div class="w-full justify-self-end">
										<div class="text-right font-mono text-xs tabular-nums text-gray-900 dark:text-white">{nf(p.min)}</div>
										<div class="mt-1 h-0.75 overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700">
											<div class="h-full {starter ? 'bg-gray-500 opacity-90 dark:bg-gray-400' : 'bg-gray-400 opacity-55 dark:bg-gray-500'}" style="width:{pct}%"></div>
										</div>
									</div>
								{:else}
									{@const v = num(p, c.key)}
									{@const lead = !!c.lead && leaderVals[c.key] != null && v === leaderVals[c.key] && v > 0}
									<div
										class="justify-self-end text-right font-mono text-xs tabular-nums
											{lead ? 'font-bold text-primary-600 dark:text-primary-400' : c.muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-400'}"
									>
										{#if c.muted && v === 0}<span class="opacity-40">0</span>{:else}{v}{/if}
									</div>
								{/if}
							{/each}
						</a>
					{/each}
				{/if}

				<!-- Goalkeepers -->
				{#if showGK && keepers.length > 0}
					<div class="flex items-center gap-2.5 border-y border-gray-200 bg-gray-50 px-3.5 py-2 dark:border-gray-700 dark:bg-gray-900">
						<span class="text-xs font-bold uppercase tracking-wide text-gray-900 dark:text-white">Goalkeepers</span>
						<span class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
						<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">{keepers.length}</span>
					</div>
					<!-- gk header -->
					<div
						class="grid items-center gap-2 border-b border-gray-200 bg-gray-50 px-3.5 dark:border-gray-700 dark:bg-gray-900"
						style="grid-template-columns:{GK_GRID}"
					>
						<div class="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">#</div>
						<button onclick={() => onGkSort('name')} class="py-2 text-left text-[10px] font-semibold uppercase tracking-wide {gkSortKey === 'name' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">Name{ind(gkSortKey === 'name', gkSortDir)}</button>
						<div class="justify-self-center py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Pos</div>
						{#each GK_COLS as c (c.key)}
							<button onclick={() => onGkSort(c.key)} class="justify-self-end py-2 text-right text-[10px] font-semibold uppercase tracking-wide {gkSortKey === c.key ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}">{c.label}{ind(gkSortKey === c.key, gkSortDir)}</button>
						{/each}
					</div>
					<!-- gk rows -->
					{#each sortedKeepers as k (k.ncaaId)}
						<a
							href={playerHref(k.ncaaId)}
							class="grid min-h-11 items-center gap-2 border-b border-gray-200 px-3.5 transition-colors last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/30"
							style="grid-template-columns:{GK_GRID}"
						>
							<div class="justify-self-center font-mono text-sm font-bold tabular-nums text-gray-900 dark:text-white">{k.no ?? '—'}</div>
							<div class="min-w-0 truncate text-sm text-gray-900 dark:text-white">{k.name}</div>
							<div class="justify-self-center font-mono text-[10px] font-semibold tracking-wide text-gray-400 dark:text-gray-500">GK</div>
							{#each GK_COLS as c (c.key)}
								{#if c.key === 'min'}
									{@const pct = Math.max(4, Math.round((k.min / maxMin) * 100))}
									{@const starter = k.min / maxMin >= 0.55}
									<div class="w-full justify-self-end">
										<div class="text-right font-mono text-xs tabular-nums text-gray-900 dark:text-white">{nf(k.min)}</div>
										<div class="mt-1 h-0.75 overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700">
											<div class="h-full {starter ? 'bg-gray-500 opacity-90 dark:bg-gray-400' : 'bg-gray-400 opacity-55 dark:bg-gray-500'}" style="width:{pct}%"></div>
										</div>
									</div>
								{:else}
									{@const lead = !!c.lead && k.sv === gkMaxSv && k.sv > 0}
									{@const display = fmtGk(c.key, num(k, c.key))}
									<div
										class="justify-self-end text-right font-mono text-xs tabular-nums
											{lead ? 'font-bold text-primary-600 dark:text-primary-400' : c.muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-400'}"
									>{display}</div>
								{/if}
							{/each}
						</a>
					{/each}
				{/if}

				{#if fieldRows.length === 0 && !(showGK && keepers.length > 0)}
					<p class="px-3.5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">No players match this filter.</p>
				{/if}
			</div>
		</div>

		<!-- Legend -->
		<div class="flex flex-wrap gap-4 border-t border-gray-200 px-3.5 py-2.5 text-[10px] text-gray-400 dark:border-gray-700 dark:text-gray-500">
			<span><b class="font-bold text-primary-600 dark:text-primary-400">red</b> team leader</span>
			<span>bar = share of season minutes</span>
		</div>
	</div>
</div>
