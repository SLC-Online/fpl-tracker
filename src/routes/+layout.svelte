<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	let mobileMenuOpen = $state(false);

	const navItems = [
		{ href: '/', label: 'Overview' },
		{ href: '/players', label: 'Players' },
		{ href: '/my-team', label: 'My Team' },
		{ href: '/price-changes', label: 'Prices' },
	];
</script>

<div class="min-h-screen">
	<!-- Navigation -->
	<nav class="sticky top-0 z-50 backdrop-blur-xl bg-[var(--color-surface-1)]/80 border-b border-[var(--color-surface-4)]">
		<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
			<div class="flex h-14 sm:h-16 items-center justify-between">
				<!-- Logo -->
				<a href="/" class="flex items-center gap-2">
					<div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
						<span class="text-white font-bold text-xs sm:text-sm">FPL</span>
					</div>
					<span class="font-display font-bold text-base sm:text-lg tracking-tight">Tracker</span>
				</a>

				<!-- Desktop nav links -->
				<div class="hidden sm:flex items-center gap-1">
					{#each navItems as item}
						<a href={item.href}
							class="px-3 py-2 rounded-lg text-sm font-medium transition-all
								{page.url.pathname === item.href
									? 'text-[var(--color-text-0)] bg-[var(--color-surface-3)]'
									: 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-surface-2)]'}">
							{item.label}
						</a>
					{/each}
				</div>

				<!-- Mobile hamburger -->
				<button
					onclick={() => mobileMenuOpen = !mobileMenuOpen}
					class="sm:hidden p-2 rounded-lg text-[var(--color-text-2)] hover:text-[var(--color-text-0)] hover:bg-[var(--color-surface-2)]"
					aria-label="Toggle menu"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{#if mobileMenuOpen}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
						{:else}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
						{/if}
					</svg>
				</button>
			</div>

			<!-- Mobile dropdown menu -->
			{#if mobileMenuOpen}
				<div class="sm:hidden pb-3 border-t border-[var(--color-surface-4)] mt-1 pt-2">
					{#each navItems as item}
						<a href={item.href}
							onclick={() => mobileMenuOpen = false}
							class="block px-3 py-2.5 rounded-lg text-sm font-medium transition-all
								{page.url.pathname === item.href
									? 'text-[var(--color-text-0)] bg-[var(--color-surface-3)]'
									: 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-surface-2)]'}">
							{item.label}
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</nav>

	<!-- Main content -->
	<main class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
		{@render children()}
	</main>
</div>
