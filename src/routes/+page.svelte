<script lang="ts">
	import { playerPhotoUrl, teamBadgeUrl, POSITIONS } from '$lib/types';

	let { data } = $props();

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function formatPct(pct: string | null): string {
		if (!pct) return '0.0';
		return parseFloat(pct).toFixed(1);
	}

	function timeAgo(timestamp: string): string {
		const diff = Date.now() - new Date(timestamp).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}
</script>

<svelte:head>
	<title>FPL Tracker — Price & Transfer Dashboard</title>
</svelte:head>

<div class="space-y-8">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Dashboard</h1>
			{#if data.snapshot}
				<p class="text-[var(--color-text-muted)] text-sm mt-1">
					Last updated: {timeAgo(data.snapshot.timestamp)} · {data.snapshot.players_count} players tracked
				</p>
			{/if}
		</div>
	</div>

	<!-- Price Changes Section -->
	{#if data.priceChanges.length > 0}
		<section>
			<h2 class="text-lg font-semibold mb-4">Recent Price Changes</h2>
			<div class="grid gap-3">
				{#each data.priceChanges as pc}
					<a href="/player/{pc.element_id}"
						class="flex items-center gap-4 p-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
						<img src={playerPhotoUrl(pc.players.code, '40x40')} alt=""
							class="w-10 h-10 rounded-full bg-[var(--color-bg-hover)]" />
						<div class="flex-1">
							<span class="font-medium">{pc.players.web_name}</span>
							<span class="text-[var(--color-text-muted)] text-sm ml-2">{pc.players.teams.short_name}</span>
						</div>
						<div class="text-right">
							<span class={pc.change > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
								{formatPrice(pc.old_cost)} → {formatPrice(pc.new_cost)}
							</span>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Risers & Fallers -->
	<div class="grid lg:grid-cols-2 gap-8">
		<!-- Likely to Rise -->
		<section>
			<h2 class="text-lg font-semibold mb-4 text-[var(--color-success)]">↑ Likely to Rise</h2>
			<div class="space-y-2">
				{#each data.risers as player}
					<a href="/player/{player.element_id}"
						class="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-success)]/50 transition-colors">
						<img src={playerPhotoUrl(player.players.code, '40x40')} alt=""
							class="w-8 h-8 rounded-full bg-[var(--color-bg-hover)]" />
						<img src={teamBadgeUrl(player.players.teams.code)} alt=""
							class="w-5 h-5" />
						<div class="flex-1 min-w-0">
							<span class="font-medium truncate">{player.players.web_name}</span>
							<span class="text-[var(--color-text-muted)] text-xs ml-1">{formatPrice(player.now_cost)}</span>
						</div>
						<div class="text-right text-sm">
							<div class="text-[var(--color-success)] font-mono">+{formatPct(player.price_change_percent)}%</div>
							<div class="text-[var(--color-text-muted)] text-xs">{player.transfers_in_event?.toLocaleString()} in</div>
						</div>
					</a>
				{/each}
			</div>
		</section>

		<!-- Likely to Fall -->
		<section>
			<h2 class="text-lg font-semibold mb-4 text-[var(--color-danger)]">↓ Likely to Fall</h2>
			<div class="space-y-2">
				{#each data.fallers as player}
					<a href="/player/{player.element_id}"
						class="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-danger)]/50 transition-colors">
						<img src={playerPhotoUrl(player.players.code, '40x40')} alt=""
							class="w-8 h-8 rounded-full bg-[var(--color-bg-hover)]" />
						<img src={teamBadgeUrl(player.players.teams.code)} alt=""
							class="w-5 h-5" />
						<div class="flex-1 min-w-0">
							<span class="font-medium truncate">{player.players.web_name}</span>
							<span class="text-[var(--color-text-muted)] text-xs ml-1">{formatPrice(player.now_cost)}</span>
						</div>
						<div class="text-right text-sm">
							<div class="text-[var(--color-danger)] font-mono">{formatPct(player.price_change_percent)}%</div>
							<div class="text-[var(--color-text-muted)] text-xs">{player.transfers_out_event?.toLocaleString()} out</div>
						</div>
					</a>
				{/each}
			</div>
		</section>
	</div>
</div>
