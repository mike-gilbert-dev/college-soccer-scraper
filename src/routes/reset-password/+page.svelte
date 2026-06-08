<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Label, Alert } from 'flowbite-svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<svelte:head>
	<title>Set New Password | CollegeSoccer.IO</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex justify-center py-12 px-4">
	<div class="w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-6 flex flex-col gap-5">
		<h1 class="text-base font-bold text-gray-900 dark:text-white">Set new password</h1>

		{#if data.error}
			<Alert color="red" class="text-xs py-2">{data.error}</Alert>
			<p class="text-xs text-center text-gray-500 dark:text-gray-400">
				<a href="/forgot-password" class="text-primary-600 dark:text-primary-400 font-semibold hover:underline">Request a new reset link</a>
			</p>
		{:else}
			{#if form?.error}
				<Alert color="red" class="text-xs py-2">{form.error}</Alert>
			{/if}

			<form method="POST" use:enhance class="flex flex-col gap-4">
				<div>
					<Label for="password" class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
						New password
					</Label>
					<PasswordInput
						id="password"
						name="password"
						required
						autocomplete="new-password"
					/>
				</div>

				<div>
					<Label for="confirm" class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
						Confirm password
					</Label>
					<PasswordInput
						id="confirm"
						name="confirm"
						required
						autocomplete="new-password"
					/>
				</div>

				<Button type="submit" color="primary" size="sm" class="w-full mt-1">Update password</Button>
			</form>
		{/if}
	</div>
</div>
