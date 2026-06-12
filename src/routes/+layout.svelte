<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Navbar from '$lib/components/Navbar.svelte';
	import { createSupabaseBrowserClient } from '$lib/supabase';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
  import { Alert } from 'flowbite-svelte';

	let { data, children } = $props();

	const fmt = (n: number) => n.toLocaleString('en-US');

	// Vercel Analytics
	injectAnalytics({ mode: dev ? 'development' : 'production' });

	const supabase = createSupabaseBrowserClient();

	onMount(() => {
		const { data: { subscription } } = supabase.auth.onAuthStateChange((event, _session) => {
			if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
				invalidate('supabase:auth');
			}
		});
		return () => subscription.unsubscribe();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>CollegeSoccer.IO — NCAA Soccer Scores, Stats & More</title>
	<meta property="og:site_name" content="CollegeSoccer.IO" />
</svelte:head>

<Navbar />

<main class="max-w-5xl mx-auto px-3 py-3">
	<div class="bg-white dark:bg-gray-950 text-gray-500 border dark:border-gray-800 border-gray-200 p-4 rounded-lg mb-4">
		<div class="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-800 mb-4">
			{#each [{ label: 'Teams', count: data.teamCount }, { label: 'Games', count: data.gameCount }, { label: 'Players', count: data.playerCount }] as stat}
				<div class="flex flex-col items-center py-1">
					<span class="text-2xl font-bold font-mono text-gray-800 dark:text-gray-100">{fmt(stat.count)}</span>
					<span class="text-xs uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-0.5">{stat.label}</span>
				</div>
			{/each}
		</div>
		<p class="text-xs tracking-wider text-center">
			CollegeSoccer.IO is currently in early development. Check back soon to see full scores and player stats!
		</p>
	</div>
	{@render children()}
</main>
