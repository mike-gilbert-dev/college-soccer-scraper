<script lang="ts">
	// Username input with debounced live availability feedback.
	//
	// Format and reserved-word checks run locally via $lib/username so an
	// obviously-bad name never costs a network round trip; only well-formed
	// candidates hit username_available().
	import { Input, Label } from 'flowbite-svelte';
	import { createSupabaseBrowserClient } from '$lib/supabase';
	import {
		validateUsername,
		usernameErrorMessage,
		USERNAME_MIN,
		USERNAME_MAX
	} from '$lib/username';

	let {
		value = $bindable(''),
		id = 'username',
		name = 'username',
		label = 'Username',
		disabled = false,
		/** The user's existing name — reads as "unchanged" rather than "taken". */
		currentUsername = null
	}: {
		value?: string;
		id?: string;
		name?: string;
		label?: string;
		disabled?: boolean;
		currentUsername?: string | null;
	} = $props();

	type Status = 'idle' | 'checking' | 'available' | 'taken' | 'error';

	const supabase = createSupabaseBrowserClient();

	let status = $state<Status>('idle');

	const trimmed = $derived(value.trim());
	const formatError = $derived(trimmed.length > 0 ? validateUsername(trimmed) : null);
	const isUnchanged = $derived(
		currentUsername !== null && trimmed.toLowerCase() === currentUsername.toLowerCase()
	);

	$effect(() => {
		const candidate = trimmed;

		if (!candidate || validateUsername(candidate) || isUnchanged || disabled) {
			status = 'idle';
			return;
		}

		status = 'checking';
		const timer = setTimeout(async () => {
			const { data, error } = await supabase.rpc('username_available', {
				p_username: candidate
			});
			status = error ? 'error' : data ? 'available' : 'taken';
		}, 400);

		return () => clearTimeout(timer);
	});
</script>

<div>
	<Label
		for={id}
		class="mb-1 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400"
	>
		{label}
		<span class="normal-case font-normal tracking-normal text-gray-400 dark:text-gray-500 ml-1">
			({USERNAME_MIN}&ndash;{USERNAME_MAX}, letters, numbers, underscore)
		</span>
	</Label>

	<Input
		{id}
		{name}
		type="text"
		bind:value
		{disabled}
		required
		autocomplete="username"
		spellcheck="false"
		autocapitalize="none"
		maxlength={USERNAME_MAX}
		size="sm"
		class="text-sm"
		aria-describedby="{id}-status"
	/>

	<p id="{id}-status" aria-live="polite" class="mt-1 text-xs min-h-4">
		{#if disabled}
			<span class="text-gray-400 dark:text-gray-500">&nbsp;</span>
		{:else if formatError}
			<span class="text-red-600 dark:text-red-400">{usernameErrorMessage(formatError)}</span>
		{:else if isUnchanged}
			<span class="text-gray-400 dark:text-gray-500">This is your current username.</span>
		{:else if status === 'checking'}
			<span class="text-gray-400 dark:text-gray-500">Checking availability&hellip;</span>
		{:else if status === 'available'}
			<span class="text-green-600 dark:text-green-400">✓ Available</span>
		{:else if status === 'taken'}
			<span class="text-red-600 dark:text-red-400">✗ Already taken</span>
		{:else if status === 'error'}
			<span class="text-amber-600 dark:text-amber-400">Couldn't check right now.</span>
		{:else}
			<span>&nbsp;</span>
		{/if}
	</p>
</div>
