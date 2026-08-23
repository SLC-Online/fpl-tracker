<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	const navItems = [
		{ href: '/', label: 'Overview' },
		{ href: '/price-changes', label: 'Prices' },
		{ href: '/players', label: 'Players' },
	];
</script>

<div class="min-h-screen">
	<!-- Navigation -->
	<nav class="sticky top-0 z-50 backdrop-blur-xl bg-[var(--color-surface-1)]/80 border-b border-[var(--color-surface-4)]">
		<div class="mx-auto max-w-7xl px-6 lg:px-8">
			<div class="flex h-16 items-center justify-between">
				<!-- Logo -->
				<a href="/" class="flex items-center gap-2.5">
					<div class="w-8 h-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
						<span class="text-white font-bold text-sm">FPL</span>
					</div>
					<span class="font-display font-bold text-lg tracking-tight">Tracker</span>
				</a>

				<!-- Nav links -->
				<div class="flex items-center gap-1">
					{#each navItems as item}
						<a href={item.href}
							class="px-4 py-2 rounded-lg text-sm font-medium transition-all
								{page.url.pathname === item.href
									? 'text-[var(--color-text-0)] bg-[var(--color-surface-3)]'
									: 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-surface-2)]'}">
							{item.label}
						</a>
					{/each}
				</div>

				<!-- Right side - could be search or user menu later -->
				<div class="w-8"></div>
			</div>
		</div>
	</nav>

	<!-- Main content -->
	<main class="mx-auto max-w-7xl px-6 lg:px-8 py-10">
		{@render children()}
	</main>
</div>
