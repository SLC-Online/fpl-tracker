<script lang="ts">
	import { playerPhotoUrl, teamBadgeUrl, POSITIONS } from '$lib/types';
	import PlayerPhoto from '$lib/components/PlayerPhoto.svelte';

	let { data } = $props();

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	// Helper to safely access nested join data
	function getPlayer(pc: any) {
		const p = Array.isArray(pc.players) ? pc.players[0] : pc.players;
		const t = p?.teams ? (Array.isArray(p.teams) ? p.teams[0] : p.teams) : {};
		return { ...p, teams: t };
	}
</script>

<svelte:head>
	<title>Price Changes — FPL Tracker</title>
</svelte:head>

<div class="space-y-4 sm:space-y-6">
	<h1 class="text-xl sm:text-2xl font-bold">Price Changes</h1>

	{#if data.priceChanges.length === 0}
		<div class="bg-[var(--color-surface-2)] rounded-xl p-6 sm:p-8 border border-[var(--color-surface-4)] text-center">
			<p class="text-[var(--color-text-2)]">No price changes detected yet.</p>
			<p class="text-[var(--color-text-2)] text-sm mt-2">Prices typically change overnight around 02:30 BST.</p>
		</div>
	{:else}
		<!-- Mobile: card layout -->
		<div class="sm:hidden space-y-2">
			{#each data.priceChanges as pc}
				{@const player = getPlayer(pc)}
				<a href="/player/{pc.element_id}" class="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)]">
					<img src={teamBadgeUrl(player.teams.code)} alt="" class="w-6 h-6 flex-shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="text-sm font-medium truncate">{player.web_name}</div>
						<div class="text-[11px] text-[var(--color-text-3)]">{player.teams.short_name} · {pc.selected_by_percent}%</div>
					</div>
					<div class="text-right flex-shrink-0">
						<div class="font-mono text-sm">{formatPrice(pc.new_cost)}</div>
						<div class="font-mono text-xs {pc.change > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}">
							{pc.change > 0 ? '+' : ''}{formatPrice(pc.change)}
						</div>
					</div>
				</a>
			{/each}
		</div>

		<!-- Desktop: table layout -->
		<div class="hidden sm:block bg-[var(--color-surface-2)] rounded-xl border border-[var(--color-surface-4)] overflow-x-auto">
			<table class="w-full">
				<thead>
					<tr class="border-b border-[var(--color-surface-4)] text-[var(--color-text-2)] text-sm">
						<th class="text-left p-4">Player</th>
						<th class="text-left p-4">Team</th>
						<th class="text-right p-4">Old</th>
						<th class="text-right p-4">New</th>
						<th class="text-right p-4">Change</th>
						<th class="text-right p-4">Ownership</th>
						<th class="text-right p-4">Date</th>
					</tr>
				</thead>
				<tbody>
					{#each data.priceChanges as pc}
					{@const player = getPlayer(pc)}
						<tr class="border-b border-[var(--color-surface-4)] hover:bg-[var(--color-surface-3)] transition-colors">
							<td class="p-4">
								<a href="/player/{pc.element_id}" class="flex items-center gap-3 hover:text-[var(--color-accent)]">
									<PlayerPhoto code={player.code} teamCode={player.teams.code} size="40x40"
										class="w-8 h-8 rounded-full bg-[var(--color-surface-3)]" />
									<span class="font-medium">{player.web_name}</span>
								</a>
							</td>
							<td class="p-4">
								<div class="flex items-center gap-2">
									<img src={teamBadgeUrl(player.teams.code)} alt="" class="w-5 h-5" />
									<span class="text-[var(--color-text-secondary)]">{player.teams.short_name}</span>
								</div>
							</td>
							<td class="p-4 text-right font-mono text-[var(--color-text-secondary)]">{formatPrice(pc.old_cost)}</td>
							<td class="p-4 text-right font-mono">{formatPrice(pc.new_cost)}</td>
							<td class="p-4 text-right font-mono {pc.change > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}">
								{pc.change > 0 ? '+' : ''}{formatPrice(pc.change)}
							</td>
							<td class="p-4 text-right text-[var(--color-text-secondary)]">{pc.selected_by_percent}%</td>
							<td class="p-4 text-right text-[var(--color-text-2)] text-sm">
								{new Date(pc.detected_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
