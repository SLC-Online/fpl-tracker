<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import { calculatePlayerTWxP, type SquadPlayer } from '$lib/transfer-engine';

	interface Props {
		outPlayer: SquadPlayer;
		budget: number;
		allPlayers: any[];
		allPlayersLoaded: boolean;
		onSelect: (player: any) => void;
		onCancel: () => void;
	}

	let { outPlayer, budget, allPlayers, allPlayersLoaded, onSelect, onCancel }: Props = $props();

	let searchQuery = $state('');

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function stripAccents(s: string): string {
		return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
	}

	function shirtUrl(teamCode: number): string {
		return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}-66.webp`;
	}

	let results = $derived.by(() => {
		if (searchQuery.length < 2) return [];
		const q = stripAccents(searchQuery);
		return allPlayers
			.filter(p => {
				if (p.now_cost > budget) return false;
				const name = stripAccents((p.web_name || '') + ' ' + (p.first_name || '') + ' ' + (p.second_name || ''));
				return name.includes(q);
			})
			.sort((a, b) => calculatePlayerTWxP(b.projections || []) - calculatePlayerTWxP(a.projections || []))
			.slice(0, 40);
	});
</script>

<!-- Backdrop -->
<div class="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4">
	<!-- Overlay -->
	<button onclick={onCancel} class="absolute inset-0 bg-black/60 backdrop-blur-sm"></button>

	<!-- Modal -->
	<div class="relative w-full max-w-lg bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-surface-4)] shadow-2xl shadow-black/50 overflow-hidden max-h-[70vh] flex flex-col">
		<!-- Header -->
		<div class="p-5 border-b border-[var(--color-surface-4)]">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<img src={shirtUrl(outPlayer.team_code)} alt="" class="w-8 h-10" />
					<div>
						<h2 class="font-display font-semibold text-base">Replace {outPlayer.web_name}</h2>
						<p class="text-[var(--color-text-2)] text-xs mt-0.5">
							Budget: <span class="font-mono font-semibold">{formatPrice(budget)}</span> ·
							Position: {POSITIONS[outPlayer.element_type]}
						</p>
					</div>
				</div>
				<button onclick={onCancel} class="p-2 rounded-lg hover:bg-[var(--color-surface-3)] text-[var(--color-text-2)] hover:text-[var(--color-text-0)]">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
				</button>
			</div>

			<!-- Search input -->
			<input
				type="text"
				placeholder="Search by name…"
				bind:value={searchQuery}
				class="w-full mt-4 px-4 py-3 rounded-xl bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30 text-sm"
			/>
		</div>

		<!-- Results -->
		<div class="flex-1 overflow-y-auto p-2">
			{#if results.length > 0}
				{#each results as player}
					<button
						onclick={() => onSelect(player)}
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-3)] transition-colors text-left"
					>
						<img src={shirtUrl(player.team_code)} alt="" class="w-7 h-9 flex-shrink-0" />
						<div class="flex-1 min-w-0">
							<div class="font-medium text-sm">{player.web_name}</div>
							<div class="text-[var(--color-text-3)] text-xs">{player.team_short} · {POSITIONS[player.element_type]}</div>
						</div>
						<div class="text-right flex-shrink-0">
							<div class="font-mono text-sm">{formatPrice(player.now_cost)}</div>
							<div class="font-mono text-xs text-[var(--color-accent-light)]">{calculatePlayerTWxP(player.projections || []).toFixed(1)} xPts</div>
						</div>
					</button>
				{/each}
			{:else if searchQuery.length >= 2 && allPlayersLoaded}
				<p class="text-[var(--color-text-2)] text-sm py-8 text-center">No players found within budget.</p>
			{:else if !allPlayersLoaded}
				<p class="text-[var(--color-text-2)] text-sm py-8 text-center">Loading players…</p>
			{:else}
				<p class="text-[var(--color-text-3)] text-sm py-8 text-center">Start typing to search…</p>
			{/if}
		</div>
	</div>
</div>
