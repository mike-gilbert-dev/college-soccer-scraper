<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Input, Label, Alert } from 'flowbite-svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { ActionData } from './$types';
	import posthog from 'posthog-js';

	let { form }: { form: ActionData } = $props();

	function handleSubmit() {
		return async ({ result, update }: { result: import('@sveltejs/kit').ActionResult; update: () => Promise<void> }) => {
			if (result.type === 'success') {
				posthog.capture('user_registered');
			}
			await update();
		};
	}
</script>

<svelte:head>
	<title>Create Account | CollegeSoccer.IO</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex justify-center py-12 px-4">
	<div class="w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-6 flex flex-col gap-5">
		<h1 class="text-base font-bold text-gray-900 dark:text-white">Create account</h1>

		{#if form?.error}
			<Alert color="red" class="text-xs py-2">{form.error}</Alert>
		{/if}

		{#if form?.message}
			<Alert color="green" class="text-xs py-2">{form.message}</Alert>
		{/if}

		<form method="POST" use:enhance={handleSubmit} class="flex flex-col gap-4">
			<div>
				<Label for="email" class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
					Email
				</Label>
				<Input
					id="email"
					type="email"
					name="email"
					required
					autocomplete="email"
					size="sm"
					class="text-sm"
				/>
			</div>

			<div>
				<Label for="password" class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
					Password
					<span class="normal-case font-normal tracking-normal text-gray-400 dark:text-gray-500 ml-1">(min. 8 characters)</span>
				</Label>
				<PasswordInput
					id="password"
					name="password"
					required
					autocomplete="new-password"
					minlength={8}
				/>
			</div>

			<Button type="submit" color="primary" size="sm" class="w-full mt-1">Create account</Button>
		</form>

		<p class="text-xs text-center text-gray-500 dark:text-gray-400">
			Already have an account?
			<a href="/login" class="text-primary-600 dark:text-primary-400 font-semibold hover:underline">Sign in</a>
		</p>
	</div>
</div>
