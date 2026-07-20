<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { afterNavigate } from '$app/navigation';
	import { MoonSolid, SunSolid, BarsOutline, CloseOutline, UserCircleSolid } from 'flowbite-svelte-icons';

	let isDark = $state(browser ? document.documentElement.classList.contains('dark') : false);
	let mobileOpen = $state(false);
	let userMenuOpen = $state(false);

	afterNavigate(() => {
		mobileOpen = false;
		userMenuOpen = false;
	});

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

	function closeMenu() {
		mobileOpen = false;
	}

	function closeUserMenu() {
		userMenuOpen = false;
	}

	const navLinkClass = (href: string) =>
		`text-xs font-medium py-1 px-2 rounded transition-colors ${
			page.url.pathname === href
				? 'text-primary-600 dark:text-primary-400 font-semibold'
				: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
		}`;

	const mobileNavLinkClass = (href: string) =>
		`block px-3 py-2 text-sm font-medium rounded transition-colors ${
			page.url.pathname === href
				? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20'
				: 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
		}`;
</script>

<nav class="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 relative z-10">
	<div class="container mx-auto">
		<div class="flex items-center justify-between">
			<!-- Brand -->
			<a href="/" onclick={closeMenu} class="flex items-center gap-1">
				<!-- <span class="text-primary-500">⚽</span> -->
				 <img src="/images/csio_01.svg" alt="College Soccer IO Logo" class="w-8 h-8" />
				<span class="text-sm font-mono text-gray-900 dark:text-white tracking-widest">COLLEGESOCCER<span class="text-primary-500">.</span>IO</span>
			</a>

			<!-- Desktop nav links + controls -->
			<div class="hidden md:flex items-center gap-1">
				<a href="/" class={navLinkClass('/')}>News</a>
				<a href="/scores" class={navLinkClass('/scores')}>Scores</a>
				<a href="/teams" class={navLinkClass('/teams')}>Teams</a>
				<a href="/ratings" class={navLinkClass('/ratings')}>Ratings</a>
				<a href="/stats" class={navLinkClass('/stats')}>Stats</a>

				<!-- Dark mode -->
				<button
					onclick={toggleDark}
					aria-label="Toggle dark mode"
					class="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
				>
					{#if isDark}<SunSolid class="w-4 h-4" />{:else}<MoonSolid class="w-4 h-4" />{/if}
				</button>

				{#if page.data.user}
					<!-- User icon + dropdown -->
					<div class="relative">
						<button
							onclick={() => (userMenuOpen = !userMenuOpen)}
							aria-label="User menu"
							class="p-1 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
						>
							<UserCircleSolid class="w-6 h-6" />
						</button>

						{#if userMenuOpen}
							<!-- Backdrop: a <button> so iOS fires click events on it -->
							<button
								class="fixed inset-0 z-40 cursor-default bg-transparent"
								onclick={closeUserMenu}
								aria-hidden="true"
								tabindex="-1"
							></button>

							<!-- Dropdown panel -->
							<div class="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden">
								<div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
									<p class="text-xs font-medium text-gray-900 dark:text-white truncate">{page.data.user.email}</p>
								</div>
								{#if page.data.isAdmin}
									<a
										href="/admin"
										onclick={closeUserMenu}
										class="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
									>Admin</a>
								{/if}
								<form method="POST" action="/logout">
									<button
										type="submit"
										class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
									>Sign out</button>
								</form>
							</div>
						{/if}
					</div>
				{:else}
					<a href="/login" class={navLinkClass('/login')}>Sign in</a>
					<a href="/register" class="text-xs px-3 py-1.5 rounded bg-primary-500 text-white font-semibold hover:bg-primary-600 transition-colors">
						Register
					</a>
				{/if}
			</div>

			<!-- Mobile: dark mode toggle + hamburger -->
			<div class="flex items-center gap-2 md:hidden">
				<button
					onclick={toggleDark}
					aria-label="Toggle dark mode"
					class="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
				>
					{#if isDark}<SunSolid class="w-4 h-4" />{:else}<MoonSolid class="w-4 h-4" />{/if}
				</button>

				<button
					onclick={() => (mobileOpen = !mobileOpen)}
					aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
					class="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
				>
					{#if mobileOpen}<CloseOutline class="w-5 h-5" />{:else}<BarsOutline class="w-5 h-5" />{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Mobile dropdown — no transition so it can never get stuck as an invisible overlay -->
	{#if mobileOpen}
		<div class="md:hidden mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-0.5 pb-1">
			<a href="/" onclick={closeMenu} class={mobileNavLinkClass('/')}>News</a>
			<a href="/scores" onclick={closeMenu} class={mobileNavLinkClass('/scores')}>Scores</a>
			<a href="/teams" onclick={closeMenu} class={mobileNavLinkClass('/teams')}>Teams</a>
			<a href="/ratings" onclick={closeMenu} class={mobileNavLinkClass('/ratings')}>Ratings</a>
			<a href="/stats" onclick={closeMenu} class={mobileNavLinkClass('/stats')}>Stats</a>

			{#if page.data.user}
				<div class="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 mt-1 pt-2">
					{page.data.user.email}
				</div>
				{#if page.data.isAdmin}
					<a href="/admin" onclick={closeMenu} class={mobileNavLinkClass('/admin')}>Admin</a>
				{/if}
				<form method="POST" action="/logout" class="px-1">
					<button type="submit" class="w-full text-left px-3 py-2 text-sm font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
						Sign out
					</button>
				</form>
			{:else}
				<a href="/login" onclick={closeMenu} class={mobileNavLinkClass('/login')}>Sign in</a>
				<a href="/register" onclick={closeMenu} class="block mx-1 mt-1 px-3 py-2 text-sm font-semibold rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors">
					Register
				</a>
			{/if}
		</div>
	{/if}
</nav>
