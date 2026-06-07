<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { Navbar, NavBrand, NavUl, NavLi, NavHamburger, Button } from 'flowbite-svelte';
	import { MoonSolid, SunSolid } from 'flowbite-svelte-icons';

	let isDark = $state(browser ? document.documentElement.classList.contains('dark') : false);

	function toggleDark() {
		isDark = !isDark;
		if (isDark) {
			document.documentElement.classList.add('dark');
			localStorage.setItem('theme', 'dark');
		} else {
			document.documentElement.classList.remove('dark');
			localStorage.setItem('theme', 'light');
		}
	}
</script>

<Navbar class="border-b border-gray-200 dark:border-gray-700 dark:bg-gray-800 px-4 py-2">
	<NavBrand href="/">
		<span class="text-primary-500 mr-1">⚽</span>
		<span class="self-center whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">
			College Soccer
		</span>
	</NavBrand>

	<NavHamburger />

	<NavUl class="items-center">
		<NavLi
			href="/"
			class="text-xs font-medium py-1 px-2"
			activeClass="text-primary-600 dark:text-primary-400 font-semibold"
			nonActiveClass="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
		>
			Scores
		</NavLi>

		<NavLi
			href="/teams"
			class="text-xs font-medium py-1 px-2"
			activeClass="text-primary-600 dark:text-primary-400 font-semibold"
			nonActiveClass="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
		>
			Teams
		</NavLi>

		{#if page.data.user}
			<NavLi
				href="/admin"
				class="text-xs font-medium py-1 px-2"
				activeClass="text-primary-600 dark:text-primary-400 font-semibold"
				nonActiveClass="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
			>
				Admin
			</NavLi>
		{/if}

		<!-- Dark mode toggle -->
		<li>
			<button
				onclick={toggleDark}
				aria-label="Toggle dark mode"
				class="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
			>
				{#if isDark}
					<SunSolid class="w-4 h-4" />
				{:else}
					<MoonSolid class="w-4 h-4" />
				{/if}
			</button>
		</li>

		{#if page.data.user}
			<li class="flex items-center gap-2 pl-2">
				<span class="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
					{page.data.user.email}
				</span>
				<form method="POST" action="/logout">
					<Button
						type="submit"
						size="xs"
						color="alternative"
						class="border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs py-1"
					>
						Sign out
					</Button>
				</form>
			</li>
		{:else}
			<NavLi
				href="/login"
				class="text-xs py-1 px-2"
				nonActiveClass="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
				activeClass="text-primary-600 dark:text-primary-400"
			>
				Sign in
			</NavLi>
			<li>
				<Button href="/register" size="xs" color="primary" class="text-xs px-3 py-1.5">
					Register
				</Button>
			</li>
		{/if}
	</NavUl>
</Navbar>
