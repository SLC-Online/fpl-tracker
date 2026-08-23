<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import PlayerPhoto from '$lib/components/PlayerPhoto.svelte';

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
	<title>FPL Tracker</title>
</svelte:head>

<div class="space-y-10">
	<!-- Hero header -->
	<header>
		<h1 class="font-display font-bold text-3xl sm:text-4xl tracking-tight">Overview</h1>
		{#if data.snapshot}
			<p class="text-[var(--color-text-2)] text-sm mt-2">
				Updated {timeAgo(data.snapshot.timestamp)} · {data.snapshot.players_count} players
			</p>
		{/if}
	</header>

	<!-- Price Changes Banner (if any) -->
	{#if data.priceChanges.length > 0}
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-6">
			<h2 class="font-display font-semibold text-xl mb-4">Price Changes</h2>
			<div class="grid gap-2">
				{#each data.priceChanges.slice(0, 10) as pc}
					{@const player = Array.isArray(pc.players) ? pc.players[0] : pc.players}
					{@const team = player?.teams ? (Array.isArray(player.teams) ? player.teams[0] : player.teams) : {}}
					<a href="/player/{pc.element_id}"
						class="flex items-center gap-4 p-3 rounded-xl bg-[var(--color-surface-3)]/50 hover:bg-[var(--color-surface-3)] transition-all group">
						<PlayerPhoto code={player.code} teamCode={team.code} size="40x40"
							class="w-10 h-10 rounded-full" />
						<div class="flex-1">
							<span class="font-semibold group-hover:text-[var(--color-accent-light)]">{player.web_name}</span>
							<span class="text-[var(--color-text-2)] text-sm ml-2">{team.short_name}</span>
						</div>
						<div class="font-mono text-sm font-semibold
							{pc.change > 0 ? 'text-[var(--color-rise)]' : 'text-[var(--color-fall)]'}">
							{formatPrice(pc.old_cost)} → {formatPrice(pc.new_cost)}
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Movers Grid -->
	<div class="grid lg:grid-cols-2 gap-6">
		<!-- Rising -->
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
			<div class="px-6 pt-6 pb-4 flex items-center gap-3">
				<div class="w-2 h-2 rounded-full bg-[var(--color-rise)]"></div>
				<h2 class="font-display font-semibold text-lg">Rising</h2>
			</div>
			<div class="px-3 pb-3">
				{#each data.risers.slice(0, 12) as player}
					{@const p = Array.isArray(player.players) ? player.players[0] : player.players}
					{@const t = p?.teams ? (Array.isArray(p.teams) ? p.teams[0] : p.teams) : {}}
					<a href="/player/{player.element_id}"
						class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--color-rise-bg)] transition-all group">
						<img src={teamBadgeUrl(t.code)} alt="" class="w-6 h-6" />
						<div class="flex-1 min-w-0">
							<span class="font-medium text-sm group-hover:text-[var(--color-rise)]">{p.web_name}</span>
						</div>
						<span class="text-[var(--color-text-2)] text-xs font-mono">{formatPrice(player.now_cost)}</span>
						<span class="text-[var(--color-rise)] text-xs font-mono font-semibold w-14 text-right">
							+{formatPct(player.price_change_percent)}%
						</span>
					</a>
				{/each}
			</div>
		</section>

		<!-- Falling -->
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
			<div class="px-6 pt-6 pb-4 flex items-center gap-3">
				<div class="w-2 h-2 rounded-full bg-[var(--color-fall)]"></div>
				<h2 class="font-display font-semibold text-lg">Falling</h2>
			</div>
			<div class="px-3 pb-3">
				{#each data.fallers.slice(0, 12) as player}
					{@const p = Array.isArray(player.players) ? player.players[0] : player.players}
					{@const t = p?.teams ? (Array.isArray(p.teams) ? p.teams[0] : p.teams) : {}}
					<a href="/player/{player.element_id}"
						class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--color-fall-bg)] transition-all group">
						<img src={teamBadgeUrl(t.code)} alt="" class="w-6 h-6" />
						<div class="flex-1 min-w-0">
							<span class="font-medium text-sm group-hover:text-[var(--color-fall)]">{p.web_name}</span>
						</div>
						<span class="text-[var(--color-text-2)] text-xs font-mono">{formatPrice(player.now_cost)}</span>
						<span class="text-[var(--color-fall)] text-xs font-mono font-semibold w-14 text-right">
							{formatPct(player.price_change_percent)}%
						</span>
					</a>
				{/each}
			</div>
		</section>
	</div>
</div>
