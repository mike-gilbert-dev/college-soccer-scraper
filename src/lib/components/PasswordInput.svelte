<script lang="ts">
	import { Input } from 'flowbite-svelte';
	import { EyeOutline, EyeSlashOutline } from 'flowbite-svelte-icons';

	let {
		id,
		name,
		required = false,
		autocomplete,
		size = 'sm' as const,
		class: className = 'text-sm',
		minlength,
	}: {
		id?: string;
		name: string;
		required?: boolean;
		autocomplete?: string;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
		minlength?: number;
	} = $props();

	let show = $state(false);
</script>

<Input
	{id}
	type={show ? 'text' : 'password'}
	{name}
	{required}
	{autocomplete}
	{size}
	class={className}
	{minlength}
>
	{#snippet right()}
		<button
			type="button"
			onclick={() => (show = !show)}
			aria-label={show ? 'Hide password' : 'Show password'}
			tabindex="-1"
			class="px-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none"
		>
			{#if show}
				<EyeSlashOutline class="w-4 h-4" />
			{:else}
				<EyeOutline class="w-4 h-4" />
			{/if}
		</button>
	{/snippet}
</Input>
