<script lang="ts">
	import { Button, Input, Label, Select, Alert, Badge, Table,
		TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell } from 'flowbite-svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// ── Sidebar navigation ──────────────────────────────────────
	type ViewId = 'archive' | 'archive-boxscores' | 'ingest-archives' | 'api-test' | 'logos' | 'data-overview' | 'scrape-log' | 'reconciliation' | 'manage-seasons' | 'ratings-recompute';

	let activeView = $state<ViewId>('archive');
	let collapsed: Record<string, boolean> = $state({});

	function toggleSection(id: string) {
		collapsed = { ...collapsed, [id]: !collapsed[id] };
	}

	const navSections: { id: string; label: string; tools: { id: ViewId; label: string }[] }[] = [
		{
			id: 'scraping',
			label: 'Scraping',
			tools: [
				{ id: 'archive', label: 'Archive Raw Games' },
				{ id: 'archive-boxscores', label: 'Archive Raw Box Scores' },
				{ id: 'ingest-archives', label: 'Ingest Archives' },
			]
		},
		{
			id: 'api',
			label: 'API Tools',
			tools: [
				{ id: 'api-test', label: 'API Test' },
			]
		},
		{
			id: 'teams',
			label: 'Teams',
			tools: [
				{ id: 'logos', label: 'Logos' },
			]
		},
		{
			id: 'data',
			label: 'Data',
			tools: [
				{ id: 'data-overview', label: 'Overview' },
				{ id: 'scrape-log', label: 'Scrape Log' },
					{ id: 'reconciliation', label: 'Reconciliation' },
			]
		},
		{
			id: 'seasons',
			label: 'Seasons',
			tools: [
				{ id: 'manage-seasons', label: 'Manage Seasons' },
			]
		},
		{
			id: 'ratings',
			label: 'Ratings',
			tools: [
				{ id: 'ratings-recompute', label: 'Recompute Ratings' },
			]
		}
	];

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

	// ── Archive Raw state ────────────────────────────────────────
	let archiveSport    = $state('MSO');
	let archiveDivision = $state(1);
	let archiveSeason   = $state((data.seasons as SeasonRow[])[0]?.label ?? '');
	let archiveStart    = $state('');
	let archiveEnd      = $state('');
	let archiveDelay    = $state(500);

	type DateStatus = 'archived' | 'missing' | 'scraping' | 'done' | 'error';
	type ArchiveDateRow = { date: string; status: DateStatus; gamesCount?: number; error?: string };
	let archiveDates: ArchiveDateRow[]  = $state([]);
	let archiveChecked    = $state(false);
	let archiveChecking   = $state(false);
	let archiveCheckError = $state('');
	let archiveRunning    = $state(false);

	let _prevArchiveSeason = archiveSeason;
	$effect(() => {
		const s = (data.seasons as SeasonRow[]).find(s => s.label === archiveSeason);
		if (s && archiveSeason !== _prevArchiveSeason) {
			archiveStart = s.start_date;
			archiveEnd   = s.end_date;
			_prevArchiveSeason = archiveSeason;
		} else if (s && !archiveStart && !archiveEnd) {
			archiveStart = s.start_date;
			archiveEnd   = s.end_date;
		}
	});

	async function checkArchiveStatus() {
		archiveChecking = true; archiveCheckError = ''; archiveDates = []; archiveChecked = false;
		try {
			const params = new URLSearchParams({
				sportCode:   archiveSport,
				division:    String(archiveDivision),
				seasonLabel: archiveSeason
			});
			const res = await fetch(`/api/archive/status?${params}`);
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			const { archivedDates, startDate, endDate } = await res.json();
			const start = archiveStart || startDate;
			const end   = archiveEnd   || endDate;
			const archivedSet = new Set<string>(archivedDates);
			const rows: ArchiveDateRow[] = [];
			const cur = new Date(start + 'T00:00:00Z');
			const fin = new Date(end   + 'T00:00:00Z');
			while (cur <= fin) {
				const iso = cur.toISOString().slice(0, 10);
				rows.push({ date: iso, status: archivedSet.has(iso) ? 'archived' : 'missing' });
				cur.setUTCDate(cur.getUTCDate() + 1);
			}
			archiveDates   = rows;
			archiveChecked = true;
		} catch (e) {
			archiveCheckError = e instanceof Error ? e.message : String(e);
		} finally {
			archiveChecking = false;
		}
	}

	async function runArchive() {
		archiveRunning = true;
		const toScrape = archiveDates;
		for (const row of toScrape) {
			archiveDates = archiveDates.map(d => d.date === row.date ? { ...d, status: 'scraping' as DateStatus } : d);
			try {
				const res = await fetch('/api/archive/date', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						sportCode:   archiveSport,
						division:    archiveDivision,
						seasonLabel: archiveSeason,
						contestDate: row.date
					})
				});
				if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
				const { gamesCount } = await res.json();
				archiveDates = archiveDates.map(d =>
					d.date === row.date ? { ...d, status: 'done' as DateStatus, gamesCount } : d
				);
			} catch (e) {
				archiveDates = archiveDates.map(d =>
					d.date === row.date
						? { ...d, status: 'error' as DateStatus, error: e instanceof Error ? e.message : String(e) }
						: d
				);
			}
			if (archiveDelay > 0) await new Promise(r => setTimeout(r, archiveDelay));
		}
		archiveRunning = false;
	}

	// ── Archive Box Scores state ─────────────────────────────────
	let bsSport      = $state('MSO');
	let bsDivision   = $state(1);
	let bsSeason     = $state((data.seasons as SeasonRow[])[0]?.label ?? '');
	let bsStart      = $state('');
	let bsEnd        = $state('');
	let bsDelay      = $state(1000);

	type BsDateStatus = 'pending' | 'scraping' | 'done' | 'error';
	type BsDateRow = { date: string; status: BsDateStatus; contestsFound?: number; saved?: number; errors?: { contestId: string; message: string }[] };
	let bsDates:        BsDateRow[] = $state([]);
	let bsChecked       = $state(false);
	let bsChecking      = $state(false);
	let bsCheckError    = $state('');
	let bsArchivedCount = $state(0);
	let bsArchiveRunning = $state(false);

	let _prevBsSeason = bsSeason;
	$effect(() => {
		const s = (data.seasons as SeasonRow[]).find(s => s.label === bsSeason);
		if (s && bsSeason !== _prevBsSeason) {
			bsStart = s.start_date;
			bsEnd   = s.end_date;
			_prevBsSeason = bsSeason;
		} else if (s && !bsStart && !bsEnd) {
			bsStart = s.start_date;
			bsEnd   = s.end_date;
			_prevBsSeason = bsSeason;
		}
	});

	async function checkBsStatus() {
		bsChecking = true; bsCheckError = ''; bsDates = []; bsChecked = false;
		try {
			const params = new URLSearchParams({
				sportCode:   bsSport,
				division:    String(bsDivision),
				seasonLabel: bsSeason
			});
			const res = await fetch(`/api/archive/boxscore/status?${params}`);
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			const { archivedCount, startDate, endDate } = await res.json();
			bsArchivedCount = archivedCount;
			const start = bsStart || startDate;
			const end   = bsEnd   || endDate;
			const rows: BsDateRow[] = [];
			const cur = new Date(start + 'T00:00:00Z');
			const fin = new Date(end   + 'T00:00:00Z');
			while (cur <= fin) {
				rows.push({ date: cur.toISOString().slice(0, 10), status: 'pending' });
				cur.setUTCDate(cur.getUTCDate() + 1);
			}
			bsDates  = rows;
			bsChecked = true;
		} catch (e) {
			bsCheckError = e instanceof Error ? e.message : String(e);
		} finally {
			bsChecking = false;
		}
	}

	async function runBsArchive() {
		bsArchiveRunning = true;
		for (const row of bsDates) {
			bsDates = bsDates.map(d => d.date === row.date ? { ...d, status: 'scraping' as BsDateStatus } : d);
			try {
				const res = await fetch('/api/archive/boxscore/date', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						sportCode:   bsSport,
						division:    bsDivision,
						seasonLabel: bsSeason,
						contestDate: row.date,
						delayMs:     bsDelay
					})
				});
				if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
				const { contestsFound, saved, errors } = await res.json();
				bsDates = bsDates.map(d =>
					d.date === row.date
						? { ...d, status: errors.length > 0 ? 'error' : 'done' as BsDateStatus, contestsFound, saved, errors }
						: d
				);
			} catch (e) {
				bsDates = bsDates.map(d =>
					d.date === row.date
						? { ...d, status: 'error' as BsDateStatus, errors: [{ contestId: '', message: e instanceof Error ? e.message : String(e) }] }
						: d
				);
			}
		}
		bsArchiveRunning = false;
	}

	// ── Ingest Archives state ────────────────────────────────────────────────────
	let igSport    = $state('MSO');
	let igDivision = $state(1);
	let igSeason   = $state((data.seasons as SeasonRow[])[0]?.label ?? '');
	let igStart    = $state('');
	let igEnd      = $state('');

	type IgDateStatus = 'pending' | 'processing' | 'done' | 'error';
	type IgDateRow = {
		date: string;
		status: IgDateStatus;
		contestsFound?: number;
		gamesUpserted?: number;
		playerStatsUpserted?: number;
		boxScoresCleared?: number;
		errors?: { contestId: string; message: string }[];
	};
	let igDates:              IgDateRow[] = $state([]);
	let igChecked             = $state(false);
	let igChecking            = $state(false);
	let igCheckError          = $state('');
	let igArchivedGameFiles   = $state(0);
	let igArchivedBoxScores   = $state(0);
	let igDbGamesCount        = $state(0);
	let igRunning             = $state(false);

	let _prevIgSeason = igSeason;
	$effect(() => {
		const s = (data.seasons as SeasonRow[]).find(s => s.label === igSeason);
		if (s && igSeason !== _prevIgSeason) {
			igStart = s.start_date;
			igEnd   = s.end_date;
			_prevIgSeason = igSeason;
		} else if (s && !igStart && !igEnd) {
			igStart = s.start_date;
			igEnd   = s.end_date;
			_prevIgSeason = igSeason;
		}
	});

	async function checkIgStatus() {
		igChecking = true; igCheckError = ''; igDates = []; igChecked = false;
		try {
			const params = new URLSearchParams({
				sportCode:   igSport,
				division:    String(igDivision),
				seasonLabel: igSeason
			});
			const res = await fetch(`/api/ingest/status?${params}`);
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			const { archivedGameFiles, archivedBoxScores, dbGamesCount, startDate, endDate } = await res.json();
			igArchivedGameFiles = archivedGameFiles;
			igArchivedBoxScores = archivedBoxScores;
			igDbGamesCount      = dbGamesCount;
			const start = igStart || startDate;
			const end   = igEnd   || endDate;
			const rows: IgDateRow[] = [];
			const cur = new Date(start + 'T00:00:00Z');
			const fin = new Date(end   + 'T00:00:00Z');
			while (cur <= fin) {
				rows.push({ date: cur.toISOString().slice(0, 10), status: 'pending' });
				cur.setUTCDate(cur.getUTCDate() + 1);
			}
			igDates   = rows;
			igChecked = true;
		} catch (e) {
			igCheckError = e instanceof Error ? e.message : String(e);
		} finally {
			igChecking = false;
		}
	}

	async function runIgIngest() {
		igRunning = true;
		for (const row of igDates) {
			igDates = igDates.map(d => d.date === row.date ? { ...d, status: 'processing' as IgDateStatus } : d);
			try {
				const res = await fetch('/api/ingest/date', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						sportCode:   igSport,
						division:    igDivision,
						seasonLabel: igSeason,
						contestDate: row.date
					})
				});
				if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
				const { contestsFound, gamesUpserted, playerStatsUpserted, boxScoresCleared, errors } = await res.json();
				igDates = igDates.map(d =>
					d.date === row.date
						? { ...d, status: errors.length > 0 ? 'error' : 'done' as IgDateStatus, contestsFound, gamesUpserted, playerStatsUpserted, boxScoresCleared, errors }
						: d
				);
			} catch (e) {
				igDates = igDates.map(d =>
					d.date === row.date
						? { ...d, status: 'error' as IgDateStatus, errors: [{ contestId: '', message: e instanceof Error ? e.message : String(e) }] }
						: d
				);
			}
		}
		igRunning = false;
	}

	// ── Stat card helper ────────────────────────────────────────
	const stats    = $derived(data.stats);
	const recentLog = $derived(data.recentLog);
	const reconciliationLog = $derived(data.reconciliationLog);

	function statusColor(s: string) {
		if (s === 'success') return 'green';
		if (s === 'error')   return 'red';
		return 'gray';
	}

	// ── Seasons management ───────────────────────────────────────
	type SeasonRow = { id: number; label: string; start_date: string; end_date: string };
	const allSeasons = $derived(data.seasons as SeasonRow[]);

	let seasonForm = $state({ label: '', start_date: '', end_date: '' });
	let editingId: number | null = $state(null);
	let seasonSaving = $state(false);
	let seasonError  = $state('');

	function startEdit(s: SeasonRow) {
		editingId = s.id;
		seasonForm = { label: s.label, start_date: s.start_date, end_date: s.end_date };
		seasonError = '';
	}

	function cancelEdit() {
		editingId = null;
		seasonForm = { label: '', start_date: '', end_date: '' };
		seasonError = '';
	}

	async function saveSeason() {
		seasonSaving = true;
		seasonError = '';
		try {
			const isEdit = editingId !== null;
			const body = isEdit
				? { id: editingId, ...seasonForm }
				: seasonForm;
			const res = await fetch('/api/seasons', {
				method: isEdit ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(await res.text());
			cancelEdit();
			await invalidateAll();
		} catch (e) {
			seasonError = e instanceof Error ? e.message : String(e);
		} finally {
			seasonSaving = false;
		}
	}

	async function deleteSeason(id: number) {
		if (!confirm('Delete this season? This cannot be undone.')) return;
		seasonSaving = true;
		seasonError = '';
		try {
			const res = await fetch('/api/seasons', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!res.ok) throw new Error(await res.text());
			await invalidateAll();
		} catch (e) {
			seasonError = e instanceof Error ? e.message : String(e);
		} finally {
			seasonSaving = false;
		}
	}

	// ── Recompute ratings ───────────────────────────────────────
	let rrSport    = $state('MSO');
	let rrDivision = $state(1);
	let rrSeason   = $state((data.seasons as SeasonRow[])[0]?.label ?? '');
	let rrSystems  = $state<Record<string, boolean>>({ elo: true, rpi: true, power: true });
	let rrRunning  = $state(false);
	let rrError    = $state('');
	let rrResult: { results: { system: string; gamesProcessed: number; teamsRated: number; rowsWritten: number }[] } | null = $state(null);

	async function runRecompute() {
		rrRunning = true; rrError = ''; rrResult = null;
		try {
			const systems = Object.entries(rrSystems).filter(([, on]) => on).map(([s]) => s);
			const res = await fetch('/api/ratings/recompute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sportCode:   rrSport,
					division:    rrDivision,
					seasonLabel: rrSeason,
					systems
				})
			});
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			rrResult = await res.json();
		} catch (e) {
			rrError = e instanceof Error ? e.message : String(e);
		} finally {
			rrRunning = false;
		}
	}

	// ── Refresh division membership ─────────────────────────────
	let rmRunning = $state(false);
	let rmError   = $state('');
	let rmResult: { members: number; nonMembers: number } | null = $state(null);

	async function refreshMembers() {
		rmRunning = true; rmError = ''; rmResult = null;
		try {
			const res = await fetch('/api/ratings/refresh-members', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sportCode:   rrSport,
					division:    rrDivision,
					seasonLabel: rrSeason
				})
			});
			if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
			rmResult = await res.json();
		} catch (e) {
			rmError = e instanceof Error ? e.message : String(e);
		} finally {
			rmRunning = false;
		}
	}
</script>

<div class="max-w-5xl mx-auto px-3 py-4">
	<h1 class="text-base font-bold text-gray-900 dark:text-white mb-4">Admin</h1>

	<div class="flex gap-4 items-start">

		<!-- ── Sidebar nav ──────────────────────────────────────── -->
		<nav class="w-48 shrink-0 self-start bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
			{#each navSections as section}
				<div class="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0">
					<button
						onclick={() => toggleSection(section.id)}
						class="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
					>
						<span>{section.label}</span>
						<span class="text-gray-400 dark:text-gray-500">{collapsed[section.id] ? '›' : '▾'}</span>
					</button>
					{#if !collapsed[section.id]}
						{#each section.tools as tool}
							<button
								onclick={() => (activeView = tool.id)}
								class="w-full text-left pl-4 pr-3 py-1.5 text-xs border-l-2 transition-colors
									{activeView === tool.id
										? 'border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 font-medium'
										: 'border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200'}"
							>
								{tool.label}
							</button>
						{/each}
					{/if}
				</div>
			{/each}
			<!-- Roster pipeline lives on its own routes; link out rather than switch activeView. -->
			<div class="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0">
				<div class="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Rosters</div>
				<a href="/admin/roster" class="block pl-4 pr-3 py-1.5 text-xs border-l-2 border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200 transition-colors">Review Queue</a>
				<a href="/admin/roster/sources" class="block pl-4 pr-3 py-1.5 text-xs border-l-2 border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200 transition-colors">Sources &amp; Coverage</a>
			</div>
			<!-- News/articles live on their own routes. -->
			<div class="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0">
				<div class="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">News</div>
				<a href="/admin/news" class="block pl-4 pr-3 py-1.5 text-xs border-l-2 border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200 transition-colors">All Articles</a>
				<a href="/admin/news/new" class="block pl-4 pr-3 py-1.5 text-xs border-l-2 border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200 transition-colors">New Article</a>
			</div>
		</nav>

		<!-- ── Content pane ─────────────────────────────────────── -->
		<div class="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">

			{#if activeView === 'archive'}
				<!-- ── Archive Raw ───────────────────────────────── -->
				<div class="space-y-4 max-w-2xl">
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Archive Raw Games</h2>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Fetches the raw <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">GetContests_web</code> NCAA API response for each date in the selected range and saves it to Supabase Storage (<code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">ncaa-raw-games</code> bucket) at <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">sportCode/division/year/MM-DD.json</code>.
					</p>

					<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gender</Label>
							<Select size="sm" bind:value={archiveSport}
								items={[{ value: 'MSO', name: "Men's" }, { value: 'WSO', name: "Women's" }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Division</Label>
							<Select size="sm" bind:value={archiveDivision}
								items={[{ value: 1, name: 'Division I' }, { value: 2, name: 'Division II' }, { value: 3, name: 'Division III' }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Season</Label>
							<Select size="sm" bind:value={archiveSeason}
								items={allSeasons.map(s => ({ value: s.label, name: s.label }))}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start date</Label>
							<Input size="sm" type="date" bind:value={archiveStart} />
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">End date</Label>
							<Input size="sm" type="date" bind:value={archiveEnd} />
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
								Delay (ms) &mdash; <span class="normal-case font-normal">{archiveDelay > 0 ? (1000 / archiveDelay).toFixed(1) : '∞'} req/s</span>
							</Label>
							<Input size="sm" type="number" min={0} max={5000} bind:value={archiveDelay} />
						</div>
					</div>

					<div class="flex gap-2 items-center flex-wrap">
						<Button color="alternative" size="sm" class="w-fit" disabled={archiveChecking} onclick={checkArchiveStatus}>
							{archiveChecking ? 'Checking…' : 'Check status'}
						</Button>
						{#if archiveChecked}
							<Button color="primary" size="sm" class="w-fit" disabled={archiveRunning} onclick={runArchive}>
								{archiveRunning ? 'Archiving…' : `Archive all (${archiveDates.length})`}
							</Button>
						{/if}
					</div>

					{#if archiveCheckError}
						<Alert color="red" class="text-xs">{archiveCheckError}</Alert>
					{/if}

					{#if archiveChecked}
						{@const archivedCount = archiveDates.filter(d => d.status === 'archived' || d.status === 'done').length}
						{@const missingCount  = archiveDates.filter(d => d.status === 'missing').length}
						{@const errorCount    = archiveDates.filter(d => d.status === 'error').length}
						{@const scrapingCount = archiveDates.filter(d => d.status === 'scraping').length}

						<p class="text-xs text-gray-500 dark:text-gray-400">
							<span class="text-green-600 dark:text-green-400 font-semibold">{archivedCount} archived</span>
							{#if scrapingCount > 0}
								&nbsp;·&nbsp;<span class="text-blue-500 font-semibold">{scrapingCount} scraping</span>
							{/if}
							&nbsp;·&nbsp;<span class="font-semibold">{missingCount} missing</span>
							{#if errorCount > 0}
								&nbsp;·&nbsp;<span class="text-red-500 font-semibold">{errorCount} errors</span>
							{/if}
							&nbsp;·&nbsp;{archiveDates.length} total dates
						</p>

						<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
							<div class="overflow-y-auto max-h-96">
								<table class="w-full text-xs">
									<thead class="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 z-10">
										<tr>
											<th class="text-left px-3 py-2 font-semibold">Date</th>
											<th class="text-left px-3 py-2 font-semibold">Status</th>
											<th class="text-right px-3 py-2 font-semibold">Games</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
										{#each archiveDates as row (row.date)}
											<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/30">
												<td class="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">{row.date}</td>
												<td class="px-3 py-1.5">
													{#if row.status === 'archived'}
														<span class="text-green-600 dark:text-green-400">✓ archived</span>
													{:else if row.status === 'done'}
														<span class="text-green-600 dark:text-green-400">✓ saved</span>
													{:else if row.status === 'scraping'}
														<span class="text-blue-500 dark:text-blue-400 animate-pulse">… scraping</span>
													{:else if row.status === 'error'}
														<span class="text-red-500" title={row.error}>✗ error</span>
													{:else}
														<span class="text-gray-400 dark:text-gray-500">○ missing</span>
													{/if}
												</td>
												<td class="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">
													{row.gamesCount != null ? row.gamesCount : ''}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				</div>

			{:else if activeView === 'archive-boxscores'}
				<!-- ── Archive Raw Box Scores ────────────────────── -->
				<div class="space-y-4 max-w-2xl">
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Archive Raw Box Scores</h2>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Reads each archived game JSON file from Storage, extracts every <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">contestId</code>, and saves the raw <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">NCAA_GetGamecenterBoxscoreSoccerById_web</code> response for each to <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">sportCode/division/year/boxscores/&#123;contestId&#125;.json</code>.
					</p>

					<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gender</Label>
							<Select size="sm" bind:value={bsSport}
								items={[{ value: 'MSO', name: "Men's" }, { value: 'WSO', name: "Women's" }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Division</Label>
							<Select size="sm" bind:value={bsDivision}
								items={[{ value: 1, name: 'Division I' }, { value: 2, name: 'Division II' }, { value: 3, name: 'Division III' }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Season</Label>
							<Select size="sm" bind:value={bsSeason}
								items={allSeasons.map(s => ({ value: s.label, name: s.label }))}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start date</Label>
							<Input size="sm" type="date" bind:value={bsStart} />
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">End date</Label>
							<Input size="sm" type="date" bind:value={bsEnd} />
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
								Delay (ms) &mdash; <span class="normal-case font-normal">{bsDelay > 0 ? (1000 / bsDelay).toFixed(1) : '∞'} req/s</span>
							</Label>
							<Input size="sm" type="number" min={0} max={10000} bind:value={bsDelay} />
						</div>
					</div>

					<div class="flex gap-2 items-center flex-wrap">
						<Button color="alternative" size="sm" class="w-fit" disabled={bsChecking} onclick={checkBsStatus}>
							{bsChecking ? 'Checking…' : 'Check status'}
						</Button>
						{#if bsChecked}
							<Button color="primary" size="sm" class="w-fit" disabled={bsRunning} onclick={runBsArchive}>
								{bsRunning ? 'Archiving…' : `Archive all (${bsDates.length} dates)`}
							</Button>
						{/if}
					</div>

					{#if bsCheckError}
						<Alert color="red" class="text-xs">{bsCheckError}</Alert>
					{/if}

					{#if bsChecked}
						<p class="text-xs text-gray-500 dark:text-gray-400">
							<span class="text-green-600 dark:text-green-400 font-semibold">{bsArchivedCount} box scores already archived</span>
							&nbsp;·&nbsp;{bsDates.length} dates to process
						</p>

						<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
							<div class="overflow-y-auto max-h-96">
								<table class="w-full text-xs">
									<thead class="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 z-10">
										<tr>
											<th class="text-left px-3 py-2 font-semibold">Date</th>
											<th class="text-left px-3 py-2 font-semibold">Status</th>
											<th class="text-right px-3 py-2 font-semibold">Contests</th>
											<th class="text-right px-3 py-2 font-semibold">Saved</th>
											<th class="text-right px-3 py-2 font-semibold">Errors</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
										{#each bsDates as row (row.date)}
											<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/30">
												<td class="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">{row.date}</td>
												<td class="px-3 py-1.5">
													{#if row.status === 'scraping'}
														<span class="text-blue-500 dark:text-blue-400 animate-pulse">… scraping</span>
													{:else if row.status === 'done' && row.contestsFound === 0}
														<span class="text-gray-400 dark:text-gray-500">— no games</span>
													{:else if row.status === 'done'}
														<span class="text-green-600 dark:text-green-400">✓ saved</span>
													{:else if row.status === 'error'}
														<span class="text-red-500" title={(row.errors ?? []).map(e => `${e.contestId}: ${e.message}`).join('\n')}>✗ error</span>
													{:else}
														<span class="text-gray-400 dark:text-gray-500">—</span>
													{/if}
												</td>
												<td class="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">
													{row.contestsFound != null ? row.contestsFound : ''}
												</td>
												<td class="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">
													{row.saved != null ? row.saved : ''}
												</td>
												<td class="px-3 py-1.5 text-right tabular-nums">
													{#if row.errors && row.errors.length > 0}
														<span class="text-red-500">{row.errors.length}</span>
													{:else if row.saved != null}
														<span class="text-gray-300 dark:text-gray-600">0</span>
													{/if}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				</div>

			{:else if activeView === 'ingest-archives'}
				<!-- ── Ingest Archives ──────────────────────────────── -->
				<div class="space-y-4 max-w-2xl">
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Ingest Archives</h2>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Reads archived game and box score JSON files from Storage and writes games, teams, and player stats to the database. The stored files are treated as the source of truth.
					</p>

					<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gender</Label>
							<Select size="sm" bind:value={igSport}
								items={[{ value: 'MSO', name: "Men's" }, { value: 'WSO', name: "Women's" }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Division</Label>
							<Select size="sm" bind:value={igDivision}
								items={[{ value: 1, name: 'Division I' }, { value: 2, name: 'Division II' }, { value: 3, name: 'Division III' }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Season</Label>
							<Select size="sm" bind:value={igSeason}
								items={allSeasons.map(s => ({ value: s.label, name: s.label }))}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start date</Label>
							<Input size="sm" type="date" bind:value={igStart} />
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">End date</Label>
							<Input size="sm" type="date" bind:value={igEnd} />
						</div>
					</div>

					<div class="flex gap-2 items-center flex-wrap">
						<Button color="alternative" size="sm" class="w-fit" disabled={igChecking} onclick={checkIgStatus}>
							{igChecking ? 'Checking…' : 'Check status'}
						</Button>
						{#if igChecked}
							<Button color="primary" size="sm" class="w-fit" disabled={igRunning} onclick={runIgIngest}>
								{igRunning ? 'Ingesting…' : `Ingest all (${igDates.length} dates)`}
							</Button>
						{/if}
					</div>

					{#if igCheckError}
						<Alert color="red" class="text-xs">{igCheckError}</Alert>
					{/if}

					{#if igChecked}
						<p class="text-xs text-gray-500 dark:text-gray-400">
							<span class="font-semibold">{igArchivedGameFiles} game files</span>
							&nbsp;·&nbsp;<span class="font-semibold">{igArchivedBoxScores} box scores</span>
							&nbsp;·&nbsp;<span class="font-semibold">{igDbGamesCount} games in DB</span>
						</p>

						<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
							<div class="overflow-y-auto max-h-96">
								<table class="w-full text-xs">
									<thead class="sticky top-0 bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 z-10">
										<tr>
											<th class="text-left px-3 py-2 font-semibold">Date</th>
											<th class="text-left px-3 py-2 font-semibold">Status</th>
											<th class="text-right px-3 py-2 font-semibold">Contests</th>
											<th class="text-right px-3 py-2 font-semibold">Games</th>
											<th class="text-right px-3 py-2 font-semibold">Stats</th>
											<th class="text-right px-3 py-2 font-semibold">Errors</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
										{#each igDates as row (row.date)}
											<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/30">
												<td class="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">{row.date}</td>
												<td class="px-3 py-1.5">
													{#if row.status === 'processing'}
														<span class="text-blue-500 dark:text-blue-400 animate-pulse">… ingesting</span>
													{:else if row.status === 'done' && row.contestsFound === 0}
														<span class="text-gray-400 dark:text-gray-500">— no game file</span>
													{:else if row.status === 'done'}
														<span class="text-green-600 dark:text-green-400">✓ done</span>
													{:else if row.status === 'error'}
														<span class="text-red-500" title={(row.errors ?? []).map(e => `${e.contestId}: ${e.message}`).join('\n')}>✗ error</span>
													{:else}
														<span class="text-gray-400 dark:text-gray-500">—</span>
													{/if}
												</td>
												<td class="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">
													{row.contestsFound != null ? row.contestsFound : ''}
												</td>
												<td class="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">
													{row.gamesUpserted != null ? row.gamesUpserted : ''}
												</td>
												<td class="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">
													{#if row.playerStatsUpserted != null}
														{row.playerStatsUpserted}
														{#if row.boxScoresCleared && row.boxScoresCleared > 0}
															<span class="text-gray-400 dark:text-gray-500"> · {row.boxScoresCleared} cleared</span>
														{/if}
													{/if}
												</td>
												<td class="px-3 py-1.5 text-right tabular-nums">
													{#if row.errors && row.errors.length > 0}
														<span class="text-red-500">{row.errors.length}</span>
													{:else if row.gamesUpserted != null}
														<span class="text-gray-300 dark:text-gray-600">0</span>
													{/if}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				</div>

			{:else if activeView === 'api-test'}
				<!-- ── API Test ───────────────────────────────────── -->
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

					<hr class="border-gray-200 dark:border-gray-700 my-2" />

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

			{:else if activeView === 'logos'}
				<!-- ── Logos ──────────────────────────────────────── -->
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

					<Input
						type="search"
						size="sm"
						placeholder="Filter teams…"
						bind:value={logoSearch}
						class="max-w-xs"
					/>

					<p class="text-xs text-gray-400 dark:text-gray-500">
						{allTeams.filter(t => t.logo_url_dark).length} / {allTeams.length} teams have logos
					</p>

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
											<td class="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
												{team.name}
											</td>
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
											<td class="px-3 py-1.5">
												<input
													type="text"
													bind:value={slugs[team.ncaa_team_id]}
													placeholder="e.g. north-carolina-st"
													class="w-48 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
												/>
											</td>
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

			{:else if activeView === 'data-overview'}
				<!-- ── Data Overview ──────────────────────────────── -->
				<div class="space-y-4">
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Database Overview</h2>

					<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
						{#each [
							{ label: 'Games',    value: stats.games,      color: 'text-gray-900 dark:text-white' },
							{ label: 'Teams',    value: stats.teams,      color: 'text-gray-900 dark:text-white' },
							{ label: 'Final',    value: stats.finalGames, color: 'text-green-600 dark:text-green-400' },
							{ label: 'Live now', value: stats.liveGames,  color: 'text-primary-600 dark:text-primary-400' }
						] as card}
							<div class="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded p-3">
								<p class="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">{card.label}</p>
								<p class="text-2xl font-bold mt-1 {card.color}">{card.value}</p>
							</div>
						{/each}
					</div>

					<p class="text-xs text-gray-400 dark:text-gray-500">
						Scheduled (not yet final): {stats.games - stats.finalGames - stats.liveGames}
					</p>
				</div>

			{:else if activeView === 'scrape-log'}
				<!-- ── Scrape Log ─────────────────────────────────── -->
				<div>
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
				</div>

			{:else if activeView === 'reconciliation'}
				<!-- Reconciliation -->
				<div>
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Nightly Reconciliation</h2>
					<p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
						The <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">nightly-reconcile</code> job (08:05 UTC) re-fetches box scores for
						recent finals and any season finals missing player stats, then upserts player stats from the stored files.
						<span class="font-medium">Missing after</span> is the count of final games still without stats — it should trend to 0.
						<span class="font-medium">Capped</span> means the per-run limit was hit and the remainder catches up on following nights.
					</p>

					{#if reconciliationLog.length === 0}
						<p class="text-xs text-gray-500 dark:text-gray-400">No reconciliation runs yet.</p>
					{:else}
						<Table hoverable={true} striped={true} class="text-xs">
							<TableHead>
								<TableHeadCell class="py-2 text-[11px]">Run</TableHeadCell>
								<TableHeadCell class="py-2 text-[11px]">Sport</TableHeadCell>
								<TableHeadCell class="py-2 text-[11px]">Box scores</TableHeadCell>
								<TableHeadCell class="py-2 text-[11px]">Stats</TableHeadCell>
								<TableHeadCell class="py-2 text-[11px]">Missing →</TableHeadCell>
								<TableHeadCell class="py-2 text-[11px]">Capped</TableHeadCell>
								<TableHeadCell class="py-2 text-[11px]">Time</TableHeadCell>
								<TableHeadCell class="py-2 text-[11px]">Errors</TableHeadCell>
							</TableHead>
							<TableBody>
								{#each reconciliationLog as row}
									<TableBodyRow>
										<TableBodyCell class="py-1.5 text-gray-500">{new Date(row.run_at).toLocaleString()}</TableBodyCell>
										<TableBodyCell class="py-1.5 font-mono">{row.sport_code} D{row.division}</TableBodyCell>
										<TableBodyCell class="py-1.5 tabular-nums">{row.boxscores_fetched} / {row.targets_considered}</TableBodyCell>
										<TableBodyCell class="py-1.5 tabular-nums">{row.stats_upserted}</TableBodyCell>
										<TableBodyCell class="py-1.5 tabular-nums">
											{row.finals_missing_before}<span class="text-gray-400"> → </span><span class={row.finals_missing_after === 0 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>{row.finals_missing_after}</span>
										</TableBodyCell>
										<TableBodyCell class="py-1.5">
											{#if row.capped}<Badge color="yellow" class="text-[10px] px-1.5 py-0.5">capped</Badge>{:else}<span class="text-gray-300 dark:text-gray-600">—</span>{/if}
										</TableBodyCell>
										<TableBodyCell class="py-1.5 text-gray-500 tabular-nums">{row.duration_ms != null ? (row.duration_ms / 1000).toFixed(1) + 's' : '—'}</TableBodyCell>
										<TableBodyCell class="py-1.5">
											{#if row.errors && row.errors.length > 0}
												<span class="text-red-500" title={row.errors.map((e) => `${e.contestId}: ${e.message}`).join('\n')}>{row.errors.length}</span>
											{:else}
												<span class="text-gray-300 dark:text-gray-600">0</span>
											{/if}
										</TableBodyCell>
									</TableBodyRow>
								{/each}
							</TableBody>
						</Table>
					{/if}
				</div>

			{:else if activeView === 'manage-seasons'}
				<!-- ── Manage Seasons ─────────────────────────────── -->
				<div class="space-y-4">
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Manage Seasons</h2>

					{#if seasonError}
						<Alert color="red" class="text-xs">{seasonError}</Alert>
					{/if}

					<!-- Seasons table -->
					{#if allSeasons.length === 0}
						<p class="text-xs text-gray-500 dark:text-gray-400">No seasons found.</p>
					{:else}
						<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
							<table class="w-full text-xs">
								<thead class="bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
									<tr>
										<th class="text-left px-3 py-2 font-semibold">Label</th>
										<th class="text-left px-3 py-2 font-semibold">Start</th>
										<th class="text-left px-3 py-2 font-semibold">End</th>
										<th class="px-3 py-2"></th>
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100 dark:divide-gray-700">
									{#each allSeasons as s}
										{#if editingId === s.id}
											<tr class="bg-primary-50 dark:bg-primary-900/10">
												<td class="px-3 py-2">
													<Input size="sm" bind:value={seasonForm.label} placeholder="e.g. 2026-2027" class="w-28" />
												</td>
												<td class="px-3 py-2">
													<Input size="sm" type="date" bind:value={seasonForm.start_date} class="w-36" />
												</td>
												<td class="px-3 py-2">
													<Input size="sm" type="date" bind:value={seasonForm.end_date} class="w-36" />
												</td>
												<td class="px-3 py-2">
													<div class="flex gap-2">
														<Button size="xs" color="primary" disabled={seasonSaving} onclick={saveSeason}>
															{seasonSaving ? 'Saving…' : 'Save'}
														</Button>
														<Button size="xs" color="alternative" onclick={cancelEdit}>Cancel</Button>
													</div>
												</td>
											</tr>
										{:else}
											<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30">
												<td class="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{s.label}</td>
												<td class="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono">{s.start_date}</td>
												<td class="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono">{s.end_date}</td>
												<td class="px-3 py-2">
													<div class="flex gap-2">
														<Button size="xs" color="alternative" onclick={() => startEdit(s)}>Edit</Button>
														<Button size="xs" color="primary" disabled={seasonSaving} onclick={() => deleteSeason(s.id)}>Delete</Button>
													</div>
												</td>
											</tr>
										{/if}
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

					<!-- Add new season form -->
					{#if editingId === null}
						<div class="border border-gray-200 dark:border-gray-700 rounded p-4 space-y-3">
							<h3 class="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Add Season</h3>
							<div class="flex flex-wrap gap-3 items-end">
								<div>
									<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Label</Label>
									<Input size="sm" bind:value={seasonForm.label} placeholder="e.g. 2026-2027" class="w-32" />
								</div>
								<div>
									<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start Date</Label>
									<Input size="sm" type="date" bind:value={seasonForm.start_date} class="w-36" />
								</div>
								<div>
									<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">End Date</Label>
									<Input size="sm" type="date" bind:value={seasonForm.end_date} class="w-36" />
								</div>
								<Button size="sm" color="primary" disabled={seasonSaving} onclick={saveSeason}>
									{seasonSaving ? 'Saving…' : 'Add Season'}
								</Button>
							</div>
						</div>
					{/if}
				</div>

			{:else if activeView === 'ratings-recompute'}
				<!-- ── Recompute Ratings ──────────────────────────── -->
				<div class="space-y-4 max-w-2xl">
					<h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Recompute Ratings</h2>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Rebuilds team ratings from final games for the selected scope. Non-destructive to game data: ratings are deleted and recomputed from scratch, so running it repeatedly is safe and idempotent. ELO carries over from the prior season with regression toward 1500.
					</p>

					<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gender</Label>
							<Select size="sm" bind:value={rrSport}
								items={[{ value: 'MSO', name: "Men's" }, { value: 'WSO', name: "Women's" }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Division</Label>
							<Select size="sm" bind:value={rrDivision}
								items={[{ value: 1, name: 'Division I' }, { value: 2, name: 'Division II' }, { value: 3, name: 'Division III' }]}
							/>
						</div>
						<div>
							<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Season</Label>
							<Select size="sm" bind:value={rrSeason}
								items={allSeasons.map(s => ({ value: s.label, name: s.label }))}
							/>
						</div>
					</div>

					<div>
						<Label class="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Systems</Label>
						<div class="flex gap-4">
							<label class="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
								<input type="checkbox" bind:checked={rrSystems.elo} class="rounded border-gray-300 dark:border-gray-600" />
								ELO
							</label>
							<label class="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
								<input type="checkbox" bind:checked={rrSystems.rpi} class="rounded border-gray-300 dark:border-gray-600" />
								RPI
							</label>
							<label class="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
								<input type="checkbox" bind:checked={rrSystems.power} class="rounded border-gray-300 dark:border-gray-600" />
								Power
							</label>
						</div>
					</div>

					<div class="flex gap-2 items-center flex-wrap">
						<Button color="primary" size="sm" class="w-fit" disabled={rrRunning} onclick={runRecompute}>
							{rrRunning ? 'Recomputing…' : 'Recompute'}
						</Button>
						<Button color="alternative" size="sm" class="w-fit" disabled={rmRunning} onclick={refreshMembers}>
							{rmRunning ? 'Refreshing…' : 'Refresh membership'}
						</Button>
					</div>

					<p class="text-xs text-gray-500 dark:text-gray-400">
						<span class="font-semibold text-gray-700 dark:text-gray-300">Refresh membership</span> re-derives which teams genuinely belong to this division (filtering out non-D1 opponents from standings and ratings). It is <span class="font-semibold text-gray-700 dark:text-gray-300">manual only</span> — no recompute, nightly or otherwise, touches it. Membership comes from <em>final</em> games (a conference qualifies once one of its teams has 5+), so run it a few weeks into the season: on a schedule-only or just-started season it marks every team a non-member and empties standings and ratings until you re-run it.
					</p>

					{#if rmResult}
						<Alert color="green" class="text-xs">
							{rmResult.members} members · {rmResult.nonMembers} non-members hidden.
						</Alert>
					{/if}

					{#if rmError}
						<Alert color="red" class="text-xs">{rmError}</Alert>
					{/if}

					{#if rrError}
						<Alert color="red" class="text-xs">{rrError}</Alert>
					{/if}

					{#if rrResult}
						<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
							<table class="w-full text-xs">
								<thead class="bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
									<tr>
										<th class="text-left px-3 py-2 font-semibold">System</th>
										<th class="text-right px-3 py-2 font-semibold">Games</th>
										<th class="text-right px-3 py-2 font-semibold">Teams</th>
										<th class="text-right px-3 py-2 font-semibold">Rows written</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
									{#each rrResult.results as r}
										<tr>
											<td class="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200 uppercase">{r.system}</td>
											<td class="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{r.gamesProcessed}</td>
											<td class="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{r.teamsRated}</td>
											<td class="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{r.rowsWritten}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>

			{/if}

		</div>
	</div>
</div>
