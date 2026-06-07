<script lang="ts">
	import { Tabs, TabItem, Button, Input, Label, Select, Alert, Badge, Table,
		TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell } from 'flowbite-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// ── Backfill state ──────────────────────────────────────────
	let startDate   = $state('2025-08-01');
	let endDate     = $state('2025-12-15');
	let seasonYear  = $state(2025);
	let division    = $state(1);
	let sportCode   = $state('MSO');
	let limit       = $state(30);
	let running            = $state(false);
	let includePlayerStats = $state(false);
	let captureTeamColors  = $state(true);
	let result: {
		processed: number;
		gamesUpserted: number;
		teamsUpserted: number;
		playersUpserted: number;
		playerStatsUpserted: number;
		errors: { date: string; message: string }[];
		nextDate: string | null;
	} | null = $state(null);
	let runError    = $state('');

	async function runBackfill(fromDate?: string) {
		running = true;
		result  = null;
		runError = '';
		try {
			const res = await fetch('/api/scrape/backfill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					startDate: fromDate ?? startDate,
					endDate,
					seasonYear,
					division,
					sportCode,
					limit,
					includePlayerStats,
					captureTeamColors
				})
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`${res.status}: ${text}`);
			}
			result = await res.json();
		} catch (e) {
			runError = e instanceof Error ? e.message : String(e);
		} finally {
			running = false;
		}
	}

	// ── Box score test state ────────────────────────────────────
	let bsContestId  = $state('6465168');
	let bsRunning    = $state(false);
	let bsRaw: unknown = $state(null);
	let bsError      = $state('');

	async function runBoxScoreTest() {
		bsRunning = true; bsRaw = null; bsError = '';
		try {
			const res = await fetch(`/api/scrape/test-boxscore?contestId=${bsContestId}`);
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			bsRaw = await res.json();
		} catch (e) {
			bsError = e instanceof Error ? e.message : String(e);
		} finally {
			bsRunning = false;
		}
	}

	// ── API test state ──────────────────────────────────────────
	let testDate       = $state('2025-10-11');
	let testSeasonYear = $state(2025);
	let testDivision   = $state(1);
	let testRunning    = $state(false);
	let testRaw: unknown = $state(null);
	let testError      = $state('');

	async function runTest() {
		testRunning = true;
		testRaw     = null;
		testError   = '';
		try {
			const params = new URLSearchParams({
				date: testDate,
				seasonYear: String(testSeasonYear),
				division: String(testDivision)
			});
			const res = await fetch(`/api/scrape/test?${params}`);
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			testRaw = await res.json();
		} catch (e) {
			testError = e instanceof Error ? e.message : String(e);
		} finally {
			testRunning = false;
		}
	}

	// ── Missing stats state ─────────────────────────────────────
	let missSport    = $state('MSO');
	let missDivision = $state(1);
	let missSeason   = $state(2025);
	let missDates: { contest_date: string; game_count: number }[] = $state([]);
	let missChecked  = $state(false);
	let missLoading  = $state(false);
	let missError    = $state('');
	let scrapingDate: Record<string, boolean>  = $state({});
	let scrapeResult: Record<string, string>   = $state({});

	async function fetchMissingDates() {
		missLoading = true; missError = ''; missDates = []; missChecked = false;
		try {
			const params = new URLSearchParams({
				sport:    missSport,
				division: String(missDivision),
				season:   String(missSeason)
			});
			const res = await fetch(`/api/scrape/missing-dates?${params}`);
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			missDates  = await res.json();
			missChecked = true;
		} catch (e) {
			missError = e instanceof Error ? e.message : String(e);
		} finally {
			missLoading = false;
		}
	}

	async function scrapeDate(date: string) {
		scrapingDate = { ...scrapingDate, [date]: true };
		delete scrapeResult[date];
		scrapeResult = { ...scrapeResult };
		try {
			const res = await fetch('/api/scrape/backfill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					startDate: date,
					endDate:   date,
					seasonYear: missSeason,
					division:   missDivision,
					sportCode:  missSport,
					limit:      100,
					includePlayerStats: true
				})
			});
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			const r = await res.json();
			scrapeResult = { ...scrapeResult, [date]: `✓ ${r.playerStatsUpserted} stats upserted` };
			missDates = missDates.filter(d => d.contest_date !== date);
		} catch (e) {
			scrapeResult = { ...scrapeResult, [date]: `✗ ${e instanceof Error ? e.message : String(e)}` };
		} finally {
			scrapingDate = { ...scrapingDate, [date]: false };
		}
	}

	// ── Logos state ─────────────────────────────────────────────
	type TeamRow = typeof data.allTeams[0];
	const allTeams = $derived(data.allTeams);

	function deriveSlug(name: string): string {
		return name
			.toLowerCase()
			.replace(/[''`]/g, '')
			.replace(/\s*&\s*/g, '-and-')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}

	let slugs = $state<Record<string, string>>(
		Object.fromEntries(
			(data.allTeams ?? []).map(t => [
				t.ncaa_team_id,
				t.ncaa_logo_slug ?? deriveSlug(t.name)
			])
		)
	);

	let logoSearch  = $state('');
	let scrapingAll = $state(false);

	const filteredLogoTeams = $derived(
		logoSearch.trim()
			? allTeams.filter(t => t.name.toLowerCase().includes(logoSearch.toLowerCase()))
			: allTeams
	);

	let logoScraping: Record<string, boolean> = $state({});
	let logoResult:   Record<string, { success: boolean; message?: string; darkFound?: boolean; lightFound?: boolean; darkUrl?: string; lightUrl?: string }> = $state({});
	let logoCacheLight: Record<string, string> = $state(
		Object.fromEntries((data.allTeams ?? []).filter(t => t.logo_url_light).map(t => [t.ncaa_team_id, t.logo_url_light!]))
	);
	let logoCacheDark: Record<string, string> = $state(
		Object.fromEntries((data.allTeams ?? []).filter(t => t.logo_url_dark).map(t => [t.ncaa_team_id, t.logo_url_dark!]))
	);

	async function scrapeLogo(team: TeamRow) {
		const slug = slugs[team.ncaa_team_id]?.trim();
		if (!slug) return;
		logoScraping = { ...logoScraping, [team.ncaa_team_id]: true };
		delete logoResult[team.ncaa_team_id];
		logoResult = { ...logoResult };
		try {
			const res = await fetch('/api/scrape/logos', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ncaaTeamId: team.ncaa_team_id, slug })
			});
			const r = await res.json();
			logoResult = { ...logoResult, [team.ncaa_team_id]: r };
			if (r.success) {
				const bust = `?t=${Date.now()}`;
				logoCacheDark  = { ...logoCacheDark,  [team.ncaa_team_id]: r.darkUrl  + bust };
				logoCacheLight = { ...logoCacheLight, [team.ncaa_team_id]: r.lightUrl + bust };
			}
		} catch (e) {
			logoResult = { ...logoResult, [team.ncaa_team_id]: { success: false, message: String(e) } };
		} finally {
			logoScraping = { ...logoScraping, [team.ncaa_team_id]: false };
		}
	}

	async function scrapeAllVisible() {
		scrapingAll = true;
		for (const team of filteredLogoTeams) {
			if (!slugs[team.ncaa_team_id]?.trim()) continue;
			await scrapeLogo(team);
			await new Promise(r => setTimeout(r, 600));
		}
		scrapingAll = false;
	}

	// ── Stat card helper ────────────────────────────────────────
	const stats    = $derived(data.stats);
	const recentLog = $derived(data.recentLog);

	function statusColor(s: string) {
		if (s === 'success') return 'green';
		if (s === 'error')   return 'red';
		return 'gray';
	}
</script>

<div class="max-w-5xl mx-auto px-3 py-4">
	<h1 class="text-base font-bold text-gray-900 dark:text-white mb-4">Admin</h1>

	<Tabs style="underline" contentClass="pt-4">

		<!-- ── Tab 1: Scraper ────────────────────────────────── -->
		<TabItem open title="Scraper">
			<div class="grid gap-4 max-w-xl">
				<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Historic Backfill</h2>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Fetches <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">GetContests_web</code>
					for each date in range, upserting teams and games. Optionally fetches
					<code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">NCAA_GetGamecenterBoxscoreSoccerById_web</code>
					for each final game to upsert player stats. Runs {limit} dates per call with a 2-second delay between dates.
				</p>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="startDate" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Start date
						</Label>
						<Input id="startDate" type="date" size="sm" bind:value={startDate} />
					</div>
					<div>
						<Label for="endDate" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							End date
						</Label>
						<Input id="endDate" type="date" size="sm" bind:value={endDate} />
					</div>
					<div>
						<Label for="seasonYear" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Season year
						</Label>
						<Select id="seasonYear" size="sm" bind:value={seasonYear}
							items={[{ value: 2025, name: '2025' }, { value: 2024, name: '2024' }]}
						/>
					</div>
					<div>
						<Label for="division" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Division
						</Label>
						<Select id="division" size="sm" bind:value={division}
							items={[
								{ value: 1, name: 'Division I' },
								{ value: 2, name: 'Division II' },
								{ value: 3, name: 'Division III' }
							]}
						/>
					</div>
					<div>
						<Label for="sportCode" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Gender
						</Label>
						<Select id="sportCode" size="sm" bind:value={sportCode}
							items={[
								{ value: 'MSO', name: "Men's" },
								{ value: 'WSO', name: "Women's" }
							]}
						/>
					</div>
					<div>
						<Label for="limit" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Dates per run
						</Label>
						<Input id="limit" type="number" size="sm" min={1} max={90} bind:value={limit} />
					</div>
					<div class="col-span-2 flex items-center gap-2 pt-1">
						<input id="captureTeamColors" type="checkbox" bind:checked={captureTeamColors}
							class="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
						<label for="captureTeamColors" class="text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none">
							Capture team colors
							<span class="text-gray-400">(1 box score call per final game)</span>
						</label>
					</div>
					<div class="col-span-2 flex items-center gap-2">
						<input id="includePlayerStats" type="checkbox" bind:checked={includePlayerStats}
							class="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
						<label for="includePlayerStats" class="text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none">
							Include player stats
							<span class="text-gray-400">(slower — use limit ≤ 10)</span>
						</label>
					</div>
				</div>

				<Button
					color="primary"
					size="sm"
					class="w-fit"
					disabled={running}
					onclick={() => runBackfill()}
				>
					{running ? 'Running…' : 'Run backfill'}
				</Button>

				{#if runError}
					<Alert color="red" class="text-xs">{runError}</Alert>
				{/if}

				{#if result}
					<div class="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 text-xs space-y-1">
						<p class="font-semibold text-gray-700 dark:text-gray-300 mb-2">Result</p>
						<p>Dates processed: <span class="font-semibold">{result.processed}</span></p>
						<p>Games upserted: <span class="font-semibold">{result.gamesUpserted}</span></p>
						<p>Teams upserted: <span class="font-semibold">{result.teamsUpserted}</span></p>
						{#if result.playersUpserted > 0}
							<p>Players upserted: <span class="font-semibold">{result.playersUpserted}</span></p>
							<p>Player stats upserted: <span class="font-semibold">{result.playerStatsUpserted}</span></p>
						{/if}
						{#if result.errors.length > 0}
							<p class="text-red-500">Errors: {result.errors.length}</p>
							{#each result.errors as e}
								<p class="text-red-400 pl-2">• {e.date}: {e.message}</p>
							{/each}
						{/if}
					</div>

					{#if result.nextDate}
						<div class="flex items-center gap-3">
							<p class="text-xs text-gray-500 dark:text-gray-400">
								More dates remaining from <strong>{result.nextDate}</strong>
							</p>
							<Button
								color="alternative"
								size="xs"
								disabled={running}
								onclick={() => runBackfill(result!.nextDate!)}
							>
								Continue
							</Button>
						</div>
					{:else}
						<Alert color="green" class="text-xs">Backfill complete for this range.</Alert>
					{/if}
				{/if}
			</div>
		</TabItem>

		<!-- ── Tab 2: Data Overview ───────────────────────────── -->
		<TabItem title="Data">
			<div class="space-y-4">
				<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Database Overview</h2>

				<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
					{#each [
						{ label: 'Games',        value: stats.games,      color: 'text-gray-900 dark:text-white' },
						{ label: 'Teams',        value: stats.teams,      color: 'text-gray-900 dark:text-white' },
						{ label: 'Final',        value: stats.finalGames, color: 'text-green-600 dark:text-green-400' },
						{ label: 'Live now',     value: stats.liveGames,  color: 'text-primary-600 dark:text-primary-400' }
					] as card}
						<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3">
							<p class="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">{card.label}</p>
							<p class="text-2xl font-bold mt-1 {card.color}">{card.value}</p>
						</div>
					{/each}
				</div>

				<p class="text-xs text-gray-400 dark:text-gray-500">
					Scheduled (not yet final): {stats.games - stats.finalGames - stats.liveGames}
				</p>
			</div>
		</TabItem>

		<!-- ── Tab 3: Scrape Log ─────────────────────────────── -->
		<TabItem title="Scrape Log">
			<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Recent Fetches</h2>

			{#if recentLog.length === 0}
				<p class="text-xs text-gray-500 dark:text-gray-400">No log entries yet. Run the backfill to populate.</p>
			{:else}
				<Table hoverable={true} striped={true} class="text-xs">
					<TableHead>
						<TableHeadCell class="py-2 text-[11px]">Date</TableHeadCell>
						<TableHeadCell class="py-2 text-[11px]">Endpoint</TableHeadCell>
						<TableHeadCell class="py-2 text-[11px]">Status</TableHeadCell>
						<TableHeadCell class="py-2 text-[11px]">Games</TableHeadCell>
						<TableHeadCell class="py-2 text-[11px]">Fetched at</TableHeadCell>
						<TableHeadCell class="py-2 text-[11px]">Error</TableHeadCell>
					</TableHead>
					<TableBody>
						{#each recentLog as row}
							<TableBodyRow>
								<TableBodyCell class="py-1.5 font-mono">{row.contest_date ?? '—'}</TableBodyCell>
								<TableBodyCell class="py-1.5 font-mono text-[10px]">{row.endpoint}</TableBodyCell>
								<TableBodyCell class="py-1.5">
									<Badge color={statusColor(row.status)} class="text-[10px] px-1.5 py-0.5">
										{row.status}
									</Badge>
								</TableBodyCell>
								<TableBodyCell class="py-1.5">{row.games_upserted ?? '—'}</TableBodyCell>
								<TableBodyCell class="py-1.5 text-gray-500">
									{new Date(row.fetched_at).toLocaleString()}
								</TableBodyCell>
								<TableBodyCell class="py-1.5 text-red-500 max-w-xs truncate">
									{row.error_message ?? ''}
								</TableBodyCell>
							</TableBodyRow>
						{/each}
					</TableBody>
				</Table>
			{/if}
		</TabItem>

		<!-- ── Tab 4: API Test ───────────────────────────────── -->
		<TabItem title="API Test">
			<div class="grid gap-4 max-w-xl">
				<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Raw NCAA API Response</h2>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Fetch a single date and inspect the raw JSON to verify field names match what the
					scraper expects. Use this when games aren't being parsed correctly.
				</p>

				<div class="grid grid-cols-3 gap-3">
					<div>
						<Label for="testDate" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Date
						</Label>
						<Input id="testDate" type="date" size="sm" bind:value={testDate} />
					</div>
					<div>
						<Label for="testSeasonYear" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Season
						</Label>
						<Select id="testSeasonYear" size="sm" bind:value={testSeasonYear}
							items={[{ value: 2025, name: '2025' }, { value: 2024, name: '2024' }]}
						/>
					</div>
					<div>
						<Label for="testDivision" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Division
						</Label>
						<Select id="testDivision" size="sm" bind:value={testDivision}
							items={[
								{ value: 1, name: 'D-I' },
								{ value: 2, name: 'D-II' },
								{ value: 3, name: 'D-III' }
							]}
						/>
					</div>
				</div>

				<Button color="alternative" size="sm" class="w-fit" disabled={testRunning} onclick={runTest}>
					{testRunning ? 'Fetching…' : 'Fetch raw response'}
				</Button>

				{#if testError}
					<Alert color="red" class="text-xs">{testError}</Alert>
				{/if}

				{#if testRaw !== null}
					<div>
						<p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
							Raw response — check the top-level keys and find where contests live:
						</p>
						<pre class="text-[10px] bg-gray-900 text-green-400 p-3 rounded overflow-auto max-h-96 whitespace-pre-wrap">{JSON.stringify(testRaw, null, 2)}</pre>
					</div>
				{/if}

				<hr class="border-gray-200 dark:border-gray-700 my-4" />

				<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Box Score Test</h2>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Fetch a single game's box score by <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">contestId</code>
					to inspect player stats. Data lives at <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">data.boxscore.teamBoxscore[i].playerStats</code>.
				</p>

				<div class="flex gap-3 items-end">
					<div>
						<Label for="bsContestId" class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Contest ID
						</Label>
						<Input id="bsContestId" type="text" size="sm" bind:value={bsContestId} class="font-mono w-36" />
					</div>
					<Button color="alternative" size="sm" disabled={bsRunning} onclick={runBoxScoreTest}>
						{bsRunning ? 'Fetching…' : 'Fetch box score'}
					</Button>
				</div>

				{#if bsError}
					<Alert color="red" class="text-xs">{bsError}</Alert>
				{/if}

				{#if bsRaw !== null}
					<pre class="text-[10px] bg-gray-900 text-green-400 p-3 rounded overflow-auto max-h-96 whitespace-pre-wrap">{JSON.stringify(bsRaw, null, 2)}</pre>
				{/if}
			</div>
		</TabItem>

		<!-- ── Tab 5: Missing Stats ─────────────────────────────── -->
		<TabItem title="Missing Stats">
			<div class="space-y-4 max-w-xl">
				<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Dates Missing Player Stats</h2>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Lists all dates that have at least one final game with no player stats scraped yet.
					Click "Scrape" to run the box score backfill for that single day.
				</p>

				<!-- Filters -->
				<div class="grid grid-cols-3 gap-3">
					<div>
						<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Gender
						</Label>
						<Select size="sm" bind:value={missSport}
							items={[{ value: 'MSO', name: "Men's" }, { value: 'WSO', name: "Women's" }]}
						/>
					</div>
					<div>
						<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Division
						</Label>
						<Select size="sm" bind:value={missDivision}
							items={[
								{ value: 1, name: 'Division I' },
								{ value: 2, name: 'Division II' },
								{ value: 3, name: 'Division III' }
							]}
						/>
					</div>
					<div>
						<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							Season
						</Label>
						<Select size="sm" bind:value={missSeason}
							items={[{ value: 2025, name: '2025' }, { value: 2024, name: '2024' }]}
						/>
					</div>
				</div>

				<Button color="alternative" size="sm" class="w-fit" disabled={missLoading} onclick={fetchMissingDates}>
					{missLoading ? 'Checking…' : 'Check missing dates'}
				</Button>

				{#if missError}
					<Alert color="red" class="text-xs">{missError}</Alert>
				{/if}

				{#if missChecked}
					{#if missDates.length === 0}
						<Alert color="green" class="text-xs">All final games have player stats — nothing missing!</Alert>
					{:else}
						<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
							<table class="w-full text-xs">
								<thead class="bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
									<tr>
										<th class="text-left px-3 py-2 font-semibold">Date</th>
										<th class="text-right px-3 py-2 font-semibold">Games missing</th>
										<th class="px-3 py-2"></th>
									</tr>
								</thead>
								<tbody>
									{#each missDates as row}
										<tr class="border-t border-gray-100 dark:border-gray-700">
											<td class="px-3 py-2 font-mono text-gray-800 dark:text-gray-200">{row.contest_date}</td>
											<td class="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{row.game_count}</td>
											<td class="px-3 py-2 text-right">
												{#if scrapeResult[row.contest_date]}
													<span class="text-[11px] {scrapeResult[row.contest_date].startsWith('✓') ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">
														{scrapeResult[row.contest_date]}
													</span>
												{:else}
													<Button
														size="xs"
														color="primary"
														disabled={scrapingDate[row.contest_date]}
														onclick={() => scrapeDate(row.contest_date)}
													>
														{scrapingDate[row.contest_date] ? 'Scraping…' : 'Scrape'}
													</Button>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<p class="text-xs text-gray-400 dark:text-gray-500">
							{missDates.length} date{missDates.length === 1 ? '' : 's'} with missing stats
						</p>
					{/if}
				{/if}
			</div>
		</TabItem>

		<!-- ── Tab 6: Logos ─────────────────────────────────────── -->
		<TabItem title="Logos">
			<div class="space-y-3">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Team Logos</h2>
						<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
							Scrapes SVG logos from NCAA. Requires a public <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">team-logos</code> bucket in Supabase Storage.
							The slug is the identifier used in NCAA logo URLs — edit it if the auto-derived value is wrong, then click Scrape.
						</p>
					</div>
					<Button
						color="alternative"
						size="xs"
						class="shrink-0"
						disabled={scrapingAll}
						onclick={scrapeAllVisible}
					>
						{scrapingAll ? 'Scraping…' : `Scrape all visible (${filteredLogoTeams.length})`}
					</Button>
				</div>

				<!-- Search -->
				<Input
					type="search"
					size="sm"
					placeholder="Filter teams…"
					bind:value={logoSearch}
					class="max-w-xs"
				/>

				<!-- Coverage summary -->
				<p class="text-xs text-gray-400 dark:text-gray-500">
					{allTeams.filter(t => t.logo_url_dark).length} / {allTeams.length} teams have logos
				</p>

				<!-- Team list -->
				<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
					<div class="overflow-y-auto max-h-150">
						<table class="w-full text-xs">
							<thead class="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 z-10">
								<tr>
									<th class="text-left px-3 py-2 font-semibold">Team</th>
									<th class="px-3 py-2 font-semibold text-center">Dark</th>
									<th class="px-3 py-2 font-semibold text-center">Light</th>
									<th class="text-left px-3 py-2 font-semibold">NCAA Slug</th>
									<th class="px-3 py-2"></th>
									<th class="px-3 py-2 text-left font-semibold">Status</th>
								</tr>
							</thead>
							<tbody>
								{#each filteredLogoTeams as team (team.ncaa_team_id)}
									{@const res = logoResult[team.ncaa_team_id]}
									<tr class="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40">
										<!-- Team name -->
										<td class="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
											{team.name}
										</td>

										<!-- Dark logo preview -->
										<td class="px-3 py-1.5 text-center">
											{#if logoCacheDark[team.ncaa_team_id]}
												<span class="inline-flex items-center justify-center w-8 h-8 rounded bg-gray-800">
													<img
														src={logoCacheDark[team.ncaa_team_id]}
														alt="{team.name} dark logo"
														class="w-6 h-6 object-contain"
													/>
												</span>
											{:else}
												<span class="inline-flex items-center justify-center w-8 h-8 rounded bg-gray-200 dark:bg-gray-700 text-gray-400 text-[10px]">—</span>
											{/if}
										</td>

										<!-- Light logo preview -->
										<td class="px-3 py-1.5 text-center">
											{#if logoCacheLight[team.ncaa_team_id]}
												<span class="inline-flex items-center justify-center w-8 h-8 rounded bg-white border border-gray-200">
													<img
														src={logoCacheLight[team.ncaa_team_id]}
														alt="{team.name} light logo"
														class="w-6 h-6 object-contain"
													/>
												</span>
											{:else}
												<span class="inline-flex items-center justify-center w-8 h-8 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 text-[10px]">—</span>
											{/if}
										</td>

										<!-- Slug input -->
										<td class="px-3 py-1.5">
											<input
												type="text"
												bind:value={slugs[team.ncaa_team_id]}
												placeholder="e.g. north-carolina-st"
												class="w-48 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
											/>
										</td>

										<!-- Scrape button -->
										<td class="px-3 py-1.5 whitespace-nowrap">
											<Button
												size="xs"
												color="primary"
												disabled={logoScraping[team.ncaa_team_id] || scrapingAll}
												onclick={() => scrapeLogo(team)}
											>
												{logoScraping[team.ncaa_team_id] ? '…' : 'Scrape'}
											</Button>
										</td>

										<!-- Status -->
										<td class="px-3 py-1.5 whitespace-nowrap">
											{#if res}
												{#if res.success}
													<span class="text-green-600 dark:text-green-400 text-[11px]">
														✓
														{#if !res.darkFound} dark missing, used light{:else if !res.lightFound} light missing, used dark{/if}
													</span>
												{:else}
													<span class="text-red-500 text-[11px]" title={res.message}>✗ {res.message?.slice(0, 40)}</span>
												{/if}
											{:else if logoCacheDark[team.ncaa_team_id]}
												<span class="text-gray-400 dark:text-gray-500 text-[11px]">saved</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</TabItem>

	</Tabs>
</div>
