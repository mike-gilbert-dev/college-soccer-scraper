<script lang="ts">
	import TeamLogo from '$lib/components/TeamLogo.svelte';
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const article = $derived(data.article);
	const canonicalUrl = $derived(`${page.url.origin}/news/${article.slug}`);

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>{article.title} — CollegeSoccer.IO</title>
	<meta name="description" content={article.subtitle ?? article.title} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:type" content="article" />
	<meta property="og:title" content={article.title} />
	<meta property="og:description" content={article.subtitle ?? article.title} />
	<meta property="og:url" content={canonicalUrl} />
	{#if article.hero_image_url}
		<meta property="og:image" content={article.hero_image_url} />
		<meta name="twitter:card" content="summary_large_image" />
	{:else}
		<meta name="twitter:card" content="summary" />
	{/if}
	{#if article.published_at}
		<meta property="article:published_time" content={article.published_at} />
	{/if}
	{#if data.isDraftPreview}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

{#if data.isDraftPreview}
	<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300">
		⚠️ DRAFT — this article is not publicly visible.
		<a href="/admin/news/{article.id}" class="ml-2 underline">Edit</a>
	</div>
{/if}

<article class="mx-auto max-w-3xl">
	<a href="/" class="text-xs text-gray-500 hover:underline dark:text-gray-400">← All news</a>

	<header class="mt-3">
		{#if article.category}
			<span class="text-[11px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">{article.category}</span>
		{/if}
		<h1 class="mt-1 text-2xl font-extrabold leading-tight text-gray-900 dark:text-white md:text-3xl">{article.title}</h1>
		{#if article.subtitle}
			<p class="mt-2 text-base text-gray-600 dark:text-gray-300">{article.subtitle}</p>
		{/if}
		{#if article.published_at}
			<time datetime={article.published_at} class="mt-2 block text-xs text-gray-400 dark:text-gray-500">{fmtDate(article.published_at)}</time>
		{/if}
	</header>

	{#if article.hero_image_url}
		<img src={article.hero_image_url} alt={article.title} class="mt-4 aspect-video w-full rounded-xl object-cover" />
	{/if}

	<!-- bodyHtml is sanitized server-side in renderMarkdown() -->
	<div class="article-body mt-6">{@html data.bodyHtml}</div>

	<!-- Related entities -->
	{#if article.teams.length || article.players.length}
		<footer class="mt-10 border-t border-gray-200 pt-5 dark:border-gray-700">
			<h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Related</h2>
			{#if article.teams.length}
				<div class="mb-3 flex flex-wrap gap-2">
					{#each article.teams as team (team.id)}
						<a href="/teams/{team.ncaa_team_id}{article.sport_code ? `?sport=${article.sport_code}` : ''}" class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-primary-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
							<TeamLogo lightUrl={team.logo_url_light} darkUrl={team.logo_url_dark} name={team.name} size={18} />
							{team.name}
						</a>
					{/each}
				</div>
			{/if}
			{#if article.players.length}
				<div class="flex flex-wrap gap-2">
					{#each article.players as player (player.id)}
						<a href="/players/{player.ncaa_player_id}" class="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-primary-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
							{player.name}
						</a>
					{/each}
				</div>
			{/if}
		</footer>
	{/if}
</article>
