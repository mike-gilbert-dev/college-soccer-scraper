<script lang="ts">
	import type { ArticleCard } from '$lib/server/articles';

	let { article }: { article: ArticleCard } = $props();

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<a
	href="/news/{article.slug}"
	class="group flex flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-colors hover:border-primary-400 dark:hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
>
	<div class="aspect-video w-full overflow-hidden bg-gray-100 dark:bg-gray-900">
		{#if article.hero_image_url}
			<img
				src={article.hero_image_url}
				alt={article.title}
				loading="lazy"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
				class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
			/>
		{:else}
			<div class="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600 text-xs">No image</div>
		{/if}
	</div>
	<div class="flex flex-1 flex-col p-3">
		{#if article.category}
			<span class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">{article.category}</span>
		{/if}
		<h3 class="text-sm font-bold leading-snug text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400">
			{article.title}
		</h3>
		{#if article.subtitle}
			<p class="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{article.subtitle}</p>
		{/if}
		{#if article.published_at}
			<time datetime={article.published_at} class="mt-auto pt-2 text-[11px] text-gray-400 dark:text-gray-500">{fmtDate(article.published_at)}</time>
		{/if}
	</div>
</a>
