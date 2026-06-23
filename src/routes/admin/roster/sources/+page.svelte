<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell } from 'flowbite-svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let statusFilter = $state('all');
	let visible = $derived(
		statusFilter === 'all' ? data.sources : data.sources.filter((s) => s.status === statusFilter)
	);
</script>

<svelte:head><title>Roster Sources — Admin</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-6">
	<h1 class="text-2xl font-semibold">Roster Sources</h1>
	<p class="mt-1 text-sm text-gray-500">
		{#each Object.entries(data.counts) as [k, v] (k)}<span class="mr-3">{k}: <strong>{v}</strong></span>{/each}
		· <a href="/admin" class="text-red-600">← admin</a>
		· <a href="/admin/roster" class="text-red-600">review queue</a>
	</p>
	<p class="mt-1 text-sm text-gray-500">
		Coverage (all sources): <strong>{data.overall.roster_linked}</strong> roster-linked ·
		<strong>{data.overall.with_headshot}</strong> headshots ·
		<strong>{data.overall.with_class}</strong> class years ·
		<strong>{data.overall.pending_review}</strong> pending review
	</p>

	{#if form?.success}<div class="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{form.success}</div>{/if}
	{#if form?.error}<div class="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{form.error}</div>{/if}

	<div class="mt-4 flex items-center gap-2 text-sm">
		<span class="text-gray-500">Filter:</span>
		{#each ['all', 'verified', 'failed', 'unverified'] as f (f)}
			<button
				class="rounded px-2 py-1 {statusFilter === f ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700'}"
				onclick={() => (statusFilter = f)}>{f}</button>
		{/each}
	</div>

	<div class="mt-3 overflow-x-auto">
		<Table>
			<TableHead>
				<TableHeadCell>Team</TableHeadCell>
				<TableHeadCell>Status</TableHeadCell>
				<TableHeadCell>Domain</TableHeadCell>
				<TableHeadCell>Roster ID</TableHeadCell>
				<TableHeadCell>Note</TableHeadCell>
				<TableHeadCell>Coverage</TableHeadCell>
				<TableHeadCell>Actions</TableHeadCell>
			</TableHead>
			<TableBody>
				{#each visible as s (s.id)}
					<TableBodyRow>
						<TableBodyCell class="font-medium">{s.team_name}<div class="text-xs text-gray-400">{s.ncaa_team_id}</div></TableBodyCell>
						<TableBodyCell>
							<span class="rounded px-1.5 py-0.5 text-xs {s.status === 'verified' ? 'bg-green-100 text-green-800' : s.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}">{s.status}</span>
						</TableBodyCell>
						<TableBodyCell colspan={3}>
							<form method="POST" action="?/save" use:enhance class="flex flex-wrap items-center gap-1">
								<input type="hidden" name="source_id" value={s.id} />
								<input name="domain" value={s.domain ?? ''} placeholder="domain" class="w-48 rounded border-gray-300 text-xs" />
								<input name="sidearm_roster_id" value={s.sidearm_roster_id ?? ''} placeholder="roster id" class="w-24 rounded border-gray-300 text-xs" />
								<select name="status" class="rounded border-gray-300 text-xs">
									{#each ['unverified', 'verified', 'failed'] as st (st)}
										<option value={st} selected={st === s.status}>{st}</option>
									{/each}
								</select>
								<button class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">Save</button>
								<span class="max-w-xs truncate text-xs text-gray-400" title={s.notes ?? ''}>{s.notes ?? ''}</span>
							</form>
						</TableBodyCell>
						<TableBodyCell class="whitespace-nowrap text-xs text-gray-600">
							{s.roster_linked} linked · {s.with_headshot} hs · {s.pending_review} pend
						</TableBodyCell>
						<TableBodyCell>
							<form method="POST" action="?/reverify" use:enhance>
								<input type="hidden" name="source_id" value={s.id} />
								<button class="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300">Re-verify</button>
							</form>
						</TableBodyCell>
					</TableBodyRow>
				{/each}
			</TableBody>
		</Table>
	</div>
</div>
