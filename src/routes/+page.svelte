<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="container">
	{#if data.user}
		<h1>Welcome, {data.user.email}</h1>
		<form method="POST" action="/logout">
			<button type="submit">Sign out</button>
		</form>
	{:else}
		<h1>College Soccer Scraper</h1>
		<p><a href="/login">Sign in</a> or <a href="/register">create an account</a></p>
	{/if}
</div>

<style>
	.container {
		max-width: 600px;
		margin: 4rem auto;
	}
	button {
		padding: 0.5rem 1rem;
		background: #ef4444;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	button:hover { background: #dc2626; }
</style>
