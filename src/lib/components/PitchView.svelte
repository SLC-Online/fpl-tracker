<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import { calculatePlayerTWxP, type SquadPlayer } from '$lib/transfer-engine';

	interface Props {
		starting: SquadPlayer[];
		bench: SquadPlayer[];
		onTransferOut?: (player: SquadPlayer) => void;
		transferMode?: boolean;
	}

	let { starting, bench, onTransferOut, transferMode = false }: Props = $props();

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function shirtUrl(teamCode: number, isGk: boolean): string {
		const suffix = isGk ? '_1' : '';
		return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}${suffix}-66.webp`;
	}

	// Group starting XI by position for formation layout
	let gks = $derived(starting.filter(p => p.element_type === 1));
	let defs = $derived(starting.filter(p => p.element_type === 2));
	let mids = $derived(starting.filter(p => p.element_type === 3));
	let fwds = $derived(starting.filter(p => p.element_type === 4));
</script>

<div class="space-y-3">
	<!-- Pitch -->
	<div class="relative rounded-2xl overflow-hidden bg-gradient-to-b from-emerald-900/40 via-emerald-800/30 to-emerald-900/40 border border-emerald-700/20 p-4 sm:p-6">
		<!-- Pitch markings (subtle) -->
		<div class="absolute inset-0 pointer-events-none">
			<div class="absolute top-1/2 left-4 right-4 h-px bg-white/5"></div>
			<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-white/5"></div>
		</div>

		<!-- Formation rows -->
		<div class="relative space-y-4 sm:space-y-6">
			<!-- Forwards -->
			{#if fwds.length > 0}
				<div class="flex justify-center gap-3 sm:gap-6">
					{#each fwds as player}
						<button
							onclick={() => onTransferOut?.(player)}
							disabled={transferMode}
							class="group flex flex-col items-center gap-1 transition-transform hover:scale-105 disabled:hover:scale-100"
						>
							<img src={shirtUrl(player.team_code, false)} alt="" class="w-10 h-12 sm:w-12 sm:h-14 drop-shadow-lg" />
							<div class="text-center">
								<div class="text-[10px] sm:text-xs font-semibold text-white truncate max-w-[70px] sm:max-w-[80px]">{player.web_name}</div>
								<div class="font-mono text-[9px] text-emerald-300/80">{calculatePlayerTWxP(player.projections).toFixed(1)}</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Midfielders -->
			{#if mids.length > 0}
				<div class="flex justify-center gap-3 sm:gap-5">
					{#each mids as player}
						<button
							onclick={() => onTransferOut?.(player)}
							disabled={transferMode}
							class="group flex flex-col items-center gap-1 transition-transform hover:scale-105 disabled:hover:scale-100"
						>
							<img src={shirtUrl(player.team_code, false)} alt="" class="w-10 h-12 sm:w-12 sm:h-14 drop-shadow-lg" />
							<div class="text-center">
								<div class="text-[10px] sm:text-xs font-semibold text-white truncate max-w-[70px] sm:max-w-[80px]">{player.web_name}</div>
								<div class="font-mono text-[9px] text-emerald-300/80">{calculatePlayerTWxP(player.projections).toFixed(1)}</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Defenders -->
			{#if defs.length > 0}
				<div class="flex justify-center gap-3 sm:gap-5">
					{#each defs as player}
						<button
							onclick={() => onTransferOut?.(player)}
							disabled={transferMode}
							class="group flex flex-col items-center gap-1 transition-transform hover:scale-105 disabled:hover:scale-100"
						>
							<img src={shirtUrl(player.team_code, false)} alt="" class="w-10 h-12 sm:w-12 sm:h-14 drop-shadow-lg" />
							<div class="text-center">
								<div class="text-[10px] sm:text-xs font-semibold text-white truncate max-w-[70px] sm:max-w-[80px]">{player.web_name}</div>
								<div class="font-mono text-[9px] text-emerald-300/80">{calculatePlayerTWxP(player.projections).toFixed(1)}</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Goalkeeper -->
			{#if gks.length > 0}
				<div class="flex justify-center gap-4">
					{#each gks as player}
						<button
							onclick={() => onTransferOut?.(player)}
							disabled={transferMode}
							class="group flex flex-col items-center gap-1 transition-transform hover:scale-105 disabled:hover:scale-100"
						>
							<img src={shirtUrl(player.team_code, true)} alt="" class="w-10 h-12 sm:w-12 sm:h-14 drop-shadow-lg" />
							<div class="text-center">
								<div class="text-[10px] sm:text-xs font-semibold text-white truncate max-w-[80px]">{player.web_name}</div>
								<div class="font-mono text-[9px] text-emerald-300/80">{calculatePlayerTWxP(player.projections).toFixed(1)}</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Bench -->
	<div class="rounded-xl bg-[var(--color-surface-2)]/60 border border-[var(--color-surface-4)] p-3 sm:p-4">
		<div class="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider font-semibold mb-2 px-1">Bench</div>
		<div class="flex justify-center gap-4 sm:gap-6">
			{#each bench as player}
				<button
					onclick={() => onTransferOut?.(player)}
					disabled={transferMode}
					class="group flex flex-col items-center gap-1 opacity-60 hover:opacity-100 transition-all hover:scale-105 disabled:hover:scale-100"
				>
					<img src={shirtUrl(player.team_code, player.element_type === 1)} alt="" class="w-9 h-11 sm:w-10 sm:h-12 drop-shadow" />
					<div class="text-center">
						<div class="text-[9px] sm:text-[10px] font-medium text-[var(--color-text-1)] truncate max-w-[60px] sm:max-w-[70px]">{player.web_name}</div>
						<div class="font-mono text-[8px] text-[var(--color-text-3)]">{formatPrice(player.current_price)}</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
</div>
