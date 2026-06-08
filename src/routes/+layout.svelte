<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Navbar from '$lib/components/Navbar.svelte';
	import { createSupabaseBrowserClient } from '$lib/supabase';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';

	let { data, children } = $props();

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
	{@render children()}
</main>
