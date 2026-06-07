<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { Navbar, NavBrand, NavUl, NavLi, NavHamburger, Button, Dropdown, DropdownHeader, DropdownItem, DropdownDivider } from 'flowbite-svelte';
	import { MoonSolid, SunSolid, UserCircleSolid } from 'flowbite-svelte-icons';

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
			<li class="flex items-center pl-1">
				<button
					id="user-menu-btn"
					class="p-1 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
					aria-label="User menu"
				>
					<UserCircleSolid class="w-6 h-6" />
				</button>
				<Dropdown triggeredBy="#user-menu-btn" class="w-56 z-50">
					<DropdownHeader>
						<p class="text-xs font-medium text-gray-900 dark:text-white truncate">{page.data.user.email}</p>
					</DropdownHeader>
					<!-- <DropdownDivider /> -->
					{#if page.data.isAdmin}
						<DropdownItem href="/admin">Admin</DropdownItem>
						<!-- <DropdownDivider /> -->
					{/if}
					<DropdownItem>
						<form method="POST" action="/logout">
							<button type="submit" class="w-full text-left text-sm">Sign out</button>
						</form>
					</DropdownItem>
				</Dropdown>
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
