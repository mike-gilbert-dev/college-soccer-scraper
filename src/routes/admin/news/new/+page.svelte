<script lang="ts">
	import ArticleEditor from '$lib/components/ArticleEditor.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="max-w-5xl mx-auto px-3 py-4">
	<div class="mb-4 flex items-center gap-2">
		<a href="/admin/news" class="text-xs text-gray-500 hover:underline">← All articles</a>
		<h1 class="text-base font-bold text-gray-900 dark:text-white">New Article</h1>
	</div>
	<ArticleEditor allTeams={data.allTeams} {form} />
</div>
