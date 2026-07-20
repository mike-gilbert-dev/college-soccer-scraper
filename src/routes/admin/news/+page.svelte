<script lang="ts">
	import { Button, Badge, Alert } from 'flowbite-svelte';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function fmtDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<div class="max-w-4xl mx-auto px-3 py-4">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-base font-bold text-gray-900 dark:text-white">News Articles</h1>
		<Button href="/admin/news/new" color="primary" size="sm">New article</Button>
	</div>

	{#if form?.error}
		<Alert color="red" class="mb-3 text-xs">{form.error}</Alert>
	{/if}
	{#if form?.success}
		<Alert color="green" class="mb-3 text-xs">{form.success}</Alert>
	{/if}

	<div class="rounded border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
		<table class="w-full text-xs">
			<thead class="bg-gray-50 dark:bg-gray-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
				<tr>
					<th class="px-3 py-2 text-left font-semibold">Title</th>
					<th class="px-3 py-2 text-left font-semibold">Status</th>
					<th class="px-3 py-2 text-left font-semibold">Category</th>
					<th class="px-3 py-2 text-left font-semibold">Published</th>
					<th class="px-3 py-2 text-right font-semibold">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each data.articles as a (a.id)}
					<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/40">
						<td class="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{a.title}</td>
						<td class="px-3 py-2">
							{#if a.status === 'published'}
								<Badge color="green">Published</Badge>
							{:else}
								<Badge color="gray">Draft</Badge>
							{/if}
						</td>
						<td class="px-3 py-2 text-gray-500 dark:text-gray-400">{a.category ?? '—'}</td>
						<td class="px-3 py-2 text-gray-500 dark:text-gray-400 tabular-nums">{fmtDate(a.published_at)}</td>
						<td class="px-3 py-2 text-right whitespace-nowrap">
							<a href="/admin/news/{a.id}" class="text-primary-600 dark:text-primary-400 hover:underline">Edit</a>
							<span class="text-gray-300 dark:text-gray-600">·</span>
							<a href="/news/{a.slug}" target="_blank" class="text-gray-500 hover:underline">View</a>
							<span class="text-gray-300 dark:text-gray-600">·</span>
							<form method="POST" action="?/delete" use:enhance class="inline" onsubmit={(e) => { if (!confirm('Delete this article?')) e.preventDefault(); }}>
								<input type="hidden" name="id" value={a.id} />
								<button type="submit" class="text-red-500 hover:underline">Delete</button>
							</form>
						</td>
					</tr>
				{/each}
				{#if data.articles.length === 0}
					<tr><td colspan="5" class="px-3 py-6 text-center text-gray-400">No articles yet. Create your first one.</td></tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
