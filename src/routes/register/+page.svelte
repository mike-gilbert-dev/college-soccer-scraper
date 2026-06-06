<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="auth-container">
	<h1>Create account</h1>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}

	{#if form?.message}
		<p class="success">{form.message}</p>
	{/if}

	<form method="POST" use:enhance>
		<label>
			Email
			<input type="email" name="email" required autocomplete="email" />
		</label>
		<label>
			Password
			<input type="password" name="password" required autocomplete="new-password" minlength="8" />
		</label>
		<button type="submit">Create account</button>
	</form>

	<p>Already have an account? <a href="/login">Sign in</a></p>
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
	.error { color: #dc2626; font-size: 0.9rem; }
	.success { color: #16a34a; font-size: 0.9rem; }
</style>
