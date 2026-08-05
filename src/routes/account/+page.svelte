<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Input, Label, Alert } from 'flowbite-svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import UsernameField from '$lib/components/UsernameField.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let username = $state(data.username);

	// Re-seed when the server value changes (i.e. after a successful change), but
	// leave whatever the user typed alone after a rejected submit.
	$effect(() => {
		username = data.username;
	});

	const locked = $derived(data.cooldownUntil !== null);
	const unlockDate = $derived(
		data.cooldownUntil
			? new Date(data.cooldownUntil).toLocaleDateString('en-US', {
					month: 'long',
					day: 'numeric',
					year: 'numeric'
				})
			: ''
	);

	// Feedback is per-section so a password error doesn't appear under the email form.
	const feedbackFor = (section: string) => (form?.section === section ? form : null);
</script>

<svelte:head>
	<title>Account | CollegeSoccer.IO</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="max-w-md mx-auto py-6 px-4 flex flex-col gap-4">
	<h1 class="text-base font-bold text-gray-900 dark:text-white">Account</h1>

	<!-- Username -->
	<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-5 flex flex-col gap-4">
		<div>
			<h2 class="text-sm font-bold text-gray-900 dark:text-white">Username</h2>
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				This is how you appear on leaderboards and your picks profile.
			</p>
		</div>

		{#if data.usernameIsGenerated}
			<Alert color="yellow" class="text-xs py-2">
				<span class="font-semibold">@{data.username}</span> was generated from your email address
				and isn't shown publicly yet. Keep it or pick something else — either way it won't start
				the 30-day change limit.
			</Alert>
		{/if}

		{#if feedbackFor('username')?.error}
			<Alert color="red" class="text-xs py-2">{feedbackFor('username')?.error}</Alert>
		{:else if feedbackFor('username')?.message}
			<Alert color="green" class="text-xs py-2">{feedbackFor('username')?.message}</Alert>
		{/if}

		<form method="POST" action="?/username" use:enhance class="flex flex-col gap-3">
			<UsernameField
				bind:value={username}
				disabled={locked}
				currentUsername={data.usernameIsGenerated ? null : data.username}
			/>

			{#if locked}
				<p class="text-xs text-gray-500 dark:text-gray-400">
					You changed your username recently. You can change it again on
					<span class="font-semibold text-gray-700 dark:text-gray-300">{unlockDate}</span>.
				</p>
			{:else}
				<p class="text-xs text-gray-400 dark:text-gray-500">
					You can change your username once every 30 days. Your old name is held for 30 days so
					nobody else can immediately take it.
				</p>
			{/if}

			<Button
				type="submit"
				color="primary"
				size="sm"
				class="w-full"
				disabled={locked || username.trim() === '' ||
					(!data.usernameIsGenerated && username.trim() === data.username)}
			>
				{data.usernameIsGenerated ? 'Save username' : 'Change username'}
			</Button>
		</form>
	</section>

	<!-- Email -->
	<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-5 flex flex-col gap-4">
		<div>
			<h2 class="text-sm font-bold text-gray-900 dark:text-white">Email</h2>
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				Used to sign in. Never shown to other users.
			</p>
		</div>

		{#if feedbackFor('email')?.error}
			<Alert color="red" class="text-xs py-2">{feedbackFor('email')?.error}</Alert>
		{:else if feedbackFor('email')?.message}
			<Alert color="green" class="text-xs py-2">{feedbackFor('email')?.message}</Alert>
		{/if}

		<form method="POST" action="?/email" use:enhance class="flex flex-col gap-3">
			<div>
				<Label for="email" class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
					Email address
				</Label>
				<Input
					id="email"
					name="email"
					type="email"
					required
					autocomplete="email"
					size="sm"
					class="text-sm"
					value={data.email}
				/>
				<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
					Changing this sends a confirmation link. The change only takes effect once you click it.
				</p>
			</div>

			<Button type="submit" color="alternative" size="sm" class="w-full">Update email</Button>
		</form>
	</section>

	<!-- Password -->
	<section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-5 flex flex-col gap-4">
		<h2 class="text-sm font-bold text-gray-900 dark:text-white">Password</h2>

		{#if feedbackFor('password')?.error}
			<Alert color="red" class="text-xs py-2">{feedbackFor('password')?.error}</Alert>
		{:else if feedbackFor('password')?.message}
			<Alert color="green" class="text-xs py-2">{feedbackFor('password')?.message}</Alert>
		{/if}

		<form method="POST" action="?/password" use:enhance class="flex flex-col gap-3">
			<div>
				<Label for="password" class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
					New password
					<span class="normal-case font-normal tracking-normal text-gray-400 dark:text-gray-500 ml-1">(min. 8 characters)</span>
				</Label>
				<PasswordInput id="password" name="password" required autocomplete="new-password" minlength={8} />
			</div>

			<Button type="submit" color="alternative" size="sm" class="w-full">Update password</Button>
		</form>
	</section>
</div>
