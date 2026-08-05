<script lang="ts">
	// One-time prompt for accounts whose username was generated from their email
	// during the username backfill.
	//
	// This is the privacy mechanism, not decoration: a generated name is a partial
	// email disclosure, so it stays out of public_profiles (and therefore off
	// leaderboards and profile pages) until the user has actually seen it here.
	//
	// Not a blocking modal — it must never prevent browsing.
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { createSupabaseBrowserClient } from '$lib/supabase';

	let saving = $state(false);
	let error = $state<string | null>(null);

	// /account has its own banner and the full form — don't stack a second one.
	const visible = $derived(
		page.data.user && page.data.usernameIsGenerated && page.url.pathname !== '/account'
	);

	async function keepIt() {
		const username = page.data.username;
		if (!username) return;

		saving = true;
		error = null;

		const supabase = createSupabaseBrowserClient();
		const { data, error: rpcError } = await supabase.rpc('set_username', {
			p_username: username
		});

		saving = false;

		if (rpcError || data !== 'ok') {
			error = 'Could not confirm that username. Try again from your account page.';
			return;
		}

		await invalidateAll();
	}
</script>

{#if visible}
	<div
		class="border-b border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5"
		role="status"
	>
		<div class="max-w-5xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
			<p class="flex-1 min-w-56 text-amber-900 dark:text-amber-200">
				Your display name is
				<span class="font-semibold">@{page.data.username}</span>, generated from your email
				address. It won't appear publicly until you confirm or change it.
			</p>

			{#if error}
				<span class="text-red-600 dark:text-red-400">{error}</span>
			{/if}

			<div class="flex items-center gap-2 shrink-0">
				<button
					onclick={keepIt}
					disabled={saving}
					class="px-3 py-1 rounded bg-primary-500 text-white font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Keep it'}
				</button>
				<a
					href="/account"
					class="px-3 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
				>
					Change it
				</a>
			</div>
		</div>
	</div>
{/if}
