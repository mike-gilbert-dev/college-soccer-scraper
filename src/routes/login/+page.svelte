<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="auth-container">
	<h1>Sign in</h1>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}

	<form method="POST" use:enhance>
		<label>
			Email
			<input type="email" name="email" required autocomplete="email" />
		</label>
		<label>
			Password
			<input type="password" name="password" required autocomplete="current-password" />
		</label>
		<button type="submit">Sign in</button>
	</form>

	<p>Don't have an account? <a href="/register">Register</a></p>
</div>

<style>
	.auth-container {
		max-width: 360px;
		margin: 4rem auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	input {
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		font-size: 1rem;
	}
	button {
		padding: 0.6rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		font-size: 1rem;
		cursor: pointer;
	}
	button:hover {
		background: #2563eb;
	}
	.error {
		color: #dc2626;
		font-size: 0.9rem;
	}
</style>
