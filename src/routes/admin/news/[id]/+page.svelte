<script lang="ts">
	import ArticleEditor from '$lib/components/ArticleEditor.svelte';
	import { Alert, Button } from 'flowbite-svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const saved = $derived(page.url.searchParams.get('saved') === '1');
</script>

<div class="max-w-5xl mx-auto px-3 py-4">
	<div class="mb-4 flex items-center gap-2">
		<a href="/admin/news" class="text-xs text-gray-500 hover:underline">← All articles</a>
		<h1 class="text-base font-bold text-gray-900 dark:text-white">Edit Article</h1>
		<form method="POST" action="?/delete" use:enhance class="ml-auto" onsubmit={(e) => { if (!confirm('Delete this article permanently?')) e.preventDefault(); }}>
			<Button type="submit" color="red" size="xs">Delete</Button>
		</form>
	</div>

	{#if saved}
		<Alert color="green" class="mb-3 text-xs">Saved.</Alert>
	{/if}

	{#key data.article.id}
		<ArticleEditor article={data.article} allTeams={data.allTeams} {form} />
	{/key}
</div>
