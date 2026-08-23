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

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Price Changes</h1>

	{#if data.priceChanges.length === 0}
		<div class="bg-[var(--color-bg-card)] rounded-xl p-8 border border-[var(--color-border)] text-center">
			<p class="text-[var(--color-text-muted)]">No price changes detected yet.</p>
			<p class="text-[var(--color-text-muted)] text-sm mt-2">Prices typically change overnight around 02:30 BST.</p>
		</div>
	{:else}
		<div class="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] overflow-hidden">
			<table class="w-full">
				<thead>
					<tr class="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-sm">
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
						<tr class="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] transition-colors">
							<td class="p-4">
								<a href="/player/{pc.element_id}" class="flex items-center gap-3 hover:text-[var(--color-accent)]">
									<PlayerPhoto code={player.code} teamCode={player.teams.code} size="40x40"
										class="w-8 h-8 rounded-full bg-[var(--color-bg-hover)]" />
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
								{pc.change > 0 ? '+' : ''}{formatPrice(pc.change * 10 + (pc.change > 0 ? 0 : 0))}
							</td>
							<td class="p-4 text-right text-[var(--color-text-secondary)]">{pc.selected_by_percent}%</td>
							<td class="p-4 text-right text-[var(--color-text-muted)] text-sm">
								{new Date(pc.detected_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
