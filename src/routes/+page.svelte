<script lang="ts">
	import { Button } from 'flowbite-svelte';
	import ArticleCard from '$lib/components/ArticleCard.svelte';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import type { ArticleCard as ArticleCardType } from '$lib/server/articles';

	let { data }: { data: PageData } = $props();

	// Local, appendable list of streamlined cards (seeded from SSR; "load more"
	// appends). Featured is rendered separately and never changes here.
	let cards = $state<ArticleCardType[]>((data.cards as ArticleCardType[]) ?? []);
	let offset = $state<number>(data.nextOffset ?? 0);
	let hasMore = $state<boolean>(data.hasMore ?? false);
	let loading = $state(false);
	let loadError = $state('');

	// Re-seed on navigation back to the homepage.
	$effect(() => {
		cards = (data.cards as ArticleCardType[]) ?? [];
		offset = data.nextOffset ?? 0;
		hasMore = data.hasMore ?? false;
	});

	const featured = $derived(data.featured as ArticleCardType | null);

	// Keep the streamlined grid free of ragged rows. The grid is 1/2/3 columns, so
	// while more cards remain to load we render only a multiple of 6 (LCM of 1,2,3)
	// — any leftover is already fetched and appears in a full row after "load more".
	// Once everything is loaded (no hasMore) we show all, so no article is hidden.
	const GRID_LCM = 6;
	const visibleCards = $derived(
		hasMore ? cards.slice(0, cards.length - (cards.length % GRID_LCM)) : cards
	);

	async function loadMore() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/news?offset=${offset}&limit=6`);
			if (!res.ok) throw new Error(`${res.status}`);
			const body = await res.json();
			cards = [...cards, ...(body.articles ?? [])];
			offset = body.nextOffset ?? offset;
			hasMore = !!body.hasMore;
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	}

	const canonicalUrl = $derived(`${page.url.origin}/`);
</script>

<svelte:head>
	<title>College Soccer News — Recaps, Rankings & Analysis | CollegeSoccer.IO</title>
	<meta name="description" content="The latest NCAA college soccer news: match recaps, rankings, recruiting, and analysis from CollegeSoccer.IO." />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:title" content="College Soccer News | CollegeSoccer.IO" />
	<meta property="og:description" content="The latest NCAA college soccer news, recaps, and analysis." />
	<meta property="og:type" content="website" />
</svelte:head>

{#if !featured}
	<!-- Empty state: no published articles yet -->
	<div class="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-16 text-center">
		<p class="text-sm font-semibold text-gray-800 dark:text-gray-200">No news yet</p>
		<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Check back soon for the latest college soccer coverage.</p>
	</div>
{:else}
	<!-- Featured article -->
	<a
		href="/news/{featured.slug}"
		class="group mb-6 block overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-colors hover:border-primary-400 dark:hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
	>
		<div class="grid md:grid-cols-2">
			<div class="aspect-video w-full overflow-hidden bg-gray-100 dark:bg-gray-900 md:aspect-auto md:h-full">
				{#if featured.hero_image_url}
					<img src={featured.hero_image_url} alt={featured.title} onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]" />
				{:else}
					<div class="flex h-full min-h-48 w-full items-center justify-center text-gray-300 dark:text-gray-600 text-xs">No image</div>
				{/if}
			</div>
			<div class="flex flex-col justify-center p-5 md:p-7">
				{#if featured.category}
					<span class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">{featured.category}</span>
				{/if}
				<h1 class="text-xl font-extrabold leading-tight text-gray-900 dark:text-white md:text-2xl group-hover:text-primary-600 dark:group-hover:text-primary-400">
					{featured.title}
				</h1>
				{#if featured.subtitle}
					<p class="mt-2 text-sm text-gray-600 dark:text-gray-300">{featured.subtitle}</p>
				{/if}
				{#if featured.published_at}
					<time datetime={featured.published_at} class="mt-3 text-xs text-gray-400 dark:text-gray-500">{fmtDate(featured.published_at)}</time>
				{/if}
			</div>
		</div>
	</a>

	<!-- Streamlined cards -->
	{#if visibleCards.length}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each visibleCards as article (article.id)}
				<ArticleCard {article} />
			{/each}
		</div>
	{/if}

	<!-- Load more -->
	<div class="mt-6 flex flex-col items-center gap-2">
		{#if loadError}
			<p class="text-xs text-red-500">Couldn’t load more ({loadError}). <button class="underline" onclick={loadMore}>Retry</button></p>
		{/if}
		{#if hasMore}
			<Button color="alternative" size="sm" disabled={loading} onclick={loadMore}>
				{loading ? 'Loading…' : 'Load more'}
			</Button>
		{:else if cards.length > 0}
			<p class="text-xs text-gray-400 dark:text-gray-500">You’re all caught up.</p>
		{/if}
	</div>
{/if}
