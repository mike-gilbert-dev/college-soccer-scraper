<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell } from 'flowbite-svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Entry = PageData['queue'][number];
	type Cand = PageData['candidates'][number];

	let groups = $derived.by(() => {
		const m = new Map<string, Entry[]>();
		for (const e of data.queue) {
			const arr = m.get(e.team_name);
			if (arr) arr.push(e);
			else m.set(e.team_name, [e]);
		}
		return [...m.entries()];
	});

	let candByTs = $derived.by(() => {
		const m = new Map<number, Cand[]>();
		for (const c of data.candidates) {
			const arr = m.get(c.team_season_id);
			if (arr) arr.push(c);
			else m.set(c.team_season_id, [c]);
		}
		return m;
	});

	function fullName(e: Entry): string {
		return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '(no name)';
	}
</script>

<svelte:head><title>Roster Review — Admin</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-6">
	<h1 class="text-2xl font-semibold">Roster Review</h1>
	<p class="mt-1 text-sm text-gray-500">
		{data.coverage.pending} pending · {data.coverage.enriched} player-seasons roster-linked · {data.coverage.withHeadshot} with downloaded headshot
		· <a href="/admin" class="text-red-600">← admin</a>
		· <a href="/admin/roster/sources" class="text-red-600">sources &amp; coverage →</a>
	</p>

	{#if form?.success}
		<div class="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{form.success}</div>
	{/if}
	{#if form?.error}
		<div class="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{form.error}</div>
	{/if}

	{#if data.queue.length === 0}
		<p class="mt-6 text-gray-500">No roster entries pending review. 🎉</p>
	{/if}

	{#each groups as [teamName, entries] (teamName)}
		<h2 class="mt-8 text-lg font-medium">{teamName} <span class="text-sm font-normal text-gray-400">({entries.length} pending)</span></h2>
		<div class="mt-2 overflow-x-auto">
			<Table>
				<TableHead>
					<TableHeadCell>Photo</TableHeadCell>
					<TableHeadCell>Player</TableHeadCell>
					<TableHeadCell>#</TableHeadCell>
					<TableHeadCell>Pos</TableHeadCell>
					<TableHeadCell>Class</TableHeadCell>
					<TableHeadCell>Hometown</TableHeadCell>
					<TableHeadCell>Status</TableHeadCell>
					<TableHeadCell>Resolve</TableHeadCell>
				</TableHead>
				<TableBody>
					{#each entries as e (e.id)}
						<TableBodyRow>
							<TableBodyCell>
								{#if e.headshot_url}
									<img src={e.headshot_url} alt={fullName(e)} class="h-10 w-10 rounded-full object-cover" />
								{:else}
									<span class="text-gray-300">—</span>
								{/if}
							</TableBodyCell>
							<TableBodyCell class="font-medium">{fullName(e)}</TableBodyCell>
							<TableBodyCell>{e.jersey_number ?? ''}</TableBodyCell>
							<TableBodyCell>{e.position ?? ''}</TableBodyCell>
							<TableBodyCell>{e.class_year ?? ''}</TableBodyCell>
							<TableBodyCell>{e.hometown ?? ''}</TableBodyCell>
							<TableBodyCell>
								<span class="capitalize">{e.match_status}</span>
								{#if e.suggestion_reason}<div class="text-xs text-gray-400">{e.suggestion_reason}</div>{/if}
							</TableBodyCell>
							<TableBodyCell>
								<div class="flex flex-col gap-1.5">
									<!-- Approve -> link to an existing player_season -->
									<form method="POST" action="?/approve_link" use:enhance class="flex items-center gap-1">
										<input type="hidden" name="queue_id" value={e.id} />
										<select name="player_season_id" class="rounded border-gray-300 text-xs">
											<option value="">— link to existing —</option>
											{#each candByTs.get(e.team_season_id) ?? [] as c (c.id)}
												<option value={c.id} selected={c.id === e.suggested_player_season_id}>
													{c.name}{c.jersey_number != null ? ` (#${c.jersey_number})` : ''}
												</option>
											{/each}
										</select>
										<button class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">Link</button>
									</form>
									<div class="flex gap-1.5">
										<!-- Approve -> create a new player -->
										<form method="POST" action="?/approve_create" use:enhance>
											<input type="hidden" name="queue_id" value={e.id} />
											<button class="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700">Create new</button>
										</form>
										<!-- Reject -->
										<form method="POST" action="?/reject" use:enhance>
											<input type="hidden" name="queue_id" value={e.id} />
											<button class="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300">Reject</button>
										</form>
									</div>
								</div>
							</TableBodyCell>
						</TableBodyRow>
					{/each}
				</TableBody>
			</Table>
		</div>
	{/each}

	<h2 class="mt-10 text-lg font-medium">Recent runs</h2>
	<div class="mt-2 overflow-x-auto">
		<Table>
			<TableHead>
				<TableHeadCell>When</TableHeadCell>
				<TableHeadCell>Team</TableHeadCell>
				<TableHeadCell>Status</TableHeadCell>
				<TableHeadCell>Seen</TableHeadCell>
				<TableHeadCell>Matched</TableHeadCell>
				<TableHeadCell>Enriched</TableHeadCell>
				<TableHeadCell>Queued</TableHeadCell>
				<TableHeadCell>Error</TableHeadCell>
			</TableHead>
			<TableBody>
				{#each data.log as r (r.id)}
					<TableBodyRow>
						<TableBodyCell class="whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString()}</TableBodyCell>
						<TableBodyCell>{r.team_name}</TableBodyCell>
						<TableBodyCell>{r.status}</TableBodyCell>
						<TableBodyCell>{r.entries_seen}</TableBodyCell>
						<TableBodyCell>{r.matched}</TableBodyCell>
						<TableBodyCell>{r.enriched}</TableBodyCell>
						<TableBodyCell>{r.queued}</TableBodyCell>
						<TableBodyCell class="max-w-xs truncate text-xs text-red-600">{r.error_message ?? ''}</TableBodyCell>
					</TableBodyRow>
				{/each}
			</TableBody>
		</Table>
	</div>
</div>
