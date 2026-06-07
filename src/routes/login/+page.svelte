<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Input, Label, Alert } from 'flowbite-svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<div class="flex justify-center py-12 px-4">
	<div class="w-full max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-6 flex flex-col gap-5">
		<h1 class="text-base font-bold text-gray-900 dark:text-white">Sign in</h1>

		{#if data.reason === 'unauthorized'}
			<Alert color="yellow" class="text-xs py-2">
				Your account does not have permission to access this application.
			</Alert>
		{:else if data.reason === 'password-updated'}
			<Alert color="green" class="text-xs py-2">
				Password updated. Sign in with your new password.
			</Alert>
		{:else if form?.error}
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

			<div>
				<Label for="password" class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
					Password
				</Label>
				<PasswordInput
					id="password"
					name="password"
					required
					autocomplete="current-password"
				/>
			</div>

			<Button type="submit" color="primary" size="sm" class="w-full mt-1">Sign in</Button>

			<p class="text-xs text-center">
				<a href="/forgot-password" class="text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline">Forgot password?</a>
			</p>
		</form>

		<p class="text-xs text-center text-gray-500 dark:text-gray-400">
			Don't have an account?
			<a href="/register" class="text-primary-600 dark:text-primary-400 font-semibold hover:underline">Register</a>
		</p>
	</div>
</div>
