<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="min-h-screen bg-[var(--color-bg-primary)]">
	<!-- Navigation -->
	<nav class="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
		<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
			<div class="flex h-16 items-center justify-between">
				<div class="flex items-center gap-8">
					<a href="/" class="text-xl font-bold text-[var(--color-accent)]">
						FPL Tracker
					</a>
					<div class="hidden sm:flex gap-6">
						<a href="/" class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
							Dashboard
						</a>
						<a href="/price-changes" class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
							Price Changes
						</a>
						<a href="/admin" class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
							Admin
						</a>
					</div>
				</div>
			</div>
		</div>
	</nav>

	<!-- Main content -->
	<main class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
		{@render children()}
	</main>
</div>
