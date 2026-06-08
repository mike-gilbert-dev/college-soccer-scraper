<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Input, Label, Alert } from 'flowbite-svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Reset Password | CollegeSoccer.IO</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex justify-center py-12 px-4">
	<div class="w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-6 flex flex-col gap-5">
		<div>
			<h1 class="text-base font-bold text-gray-900 dark:text-white">Reset password</h1>
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Enter your email and we'll send you a reset link.</p>
		</div>

		{#if form?.sent}
			<Alert color="green" class="text-xs py-2">
				Check your email for a password reset link.
			</Alert>
		{:else}
			{#if form?.error}
				<Alert color="red" class="text-xs py-2">{form.error}</Alert>
			{/if}

			<form method="POST" use:enhance class="flex flex-col gap-4">
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

				<Button type="submit" color="primary" size="sm" class="w-full mt-1">Send reset link</Button>
			</form>
		{/if}

		<p class="text-xs text-center text-gray-500 dark:text-gray-400">
			<a href="/login" class="text-primary-600 dark:text-primary-400 font-semibold hover:underline">Back to sign in</a>
		</p>
	</div>
</div>
