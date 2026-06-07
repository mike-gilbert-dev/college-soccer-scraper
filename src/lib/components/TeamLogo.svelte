<script lang="ts">
	let {
		lightUrl = null,
		darkUrl  = null,
		name,
		size = 24,
		class: className = ''
	}: {
		lightUrl?: string | null;
		darkUrl?:  string | null;
		name:      string;
		size?:     number;
		class?:    string;
	} = $props();
</script>

<!--
  Renders the light variant in light mode and the dark variant in dark mode.
  If only one variant exists (both URLs point to the same content), it shows always.
  Renders nothing when no logos are stored.
-->
{#if lightUrl || darkUrl}
	{#if lightUrl}
		<img
			src={lightUrl}
			alt="{name} logo"
			width={size}
			height={size}
			class="object-contain shrink-0 {darkUrl ? 'block dark:hidden' : 'block'} {className}"
		/>
	{/if}
	{#if darkUrl}
		<img
			src={darkUrl}
			alt="{name} logo"
			width={size}
			height={size}
			class="object-contain shrink-0 {lightUrl ? 'hidden dark:block' : 'block'} {className}"
		/>
	{/if}
{/if}
