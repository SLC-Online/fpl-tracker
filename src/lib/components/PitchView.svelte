<script lang="ts">
	import { POSITIONS } from '$lib/types';
	import { calculatePlayerTWxP, type SquadPlayer } from '$lib/transfer-engine';

	interface Props {
		starting: SquadPlayer[];
		bench: SquadPlayer[];
		onPlayerClick?: (player: SquadPlayer) => void;
		selectedId?: number | null;
	}

	let { starting, bench, onPlayerClick, selectedId = null }: Props = $props();

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function shirtUrl(teamCode: number, isGk: boolean): string {
		const suffix = isGk ? '_1' : '';
		return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}${suffix}-66.webp`;
	}

	// GK at top, then DEF, MID, FWD at bottom (FPL standard)
	let gks = $derived(starting.filter(p => p.element_type === 1));
	let defs = $derived(starting.filter(p => p.element_type === 2));
	let mids = $derived(starting.filter(p => p.element_type === 3));
	let fwds = $derived(starting.filter(p => p.element_type === 4));
</script>

<!-- Pitch container -->
<div class="relative">
	<!-- Pitch background -->
	<div class="rounded-xl overflow-hidden" style="background: linear-gradient(180deg, #1a472a 0%, #1d5030 15%, #1a472a 30%, #1d5030 45%, #1a472a 60%, #1d5030 75%, #1a472a 90%, #1d5030 100%);">
		<!-- Pitch markings -->
		<div class="relative px-3 py-6 sm:px-6 sm:py-8">
			<!-- Halfway line -->
			<div class="absolute top-1/2 left-6 right-6 h-px bg-white/10"></div>
			<!-- Centre circle -->
			<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 sm:w-28 sm:h-28 rounded-full border border-white/10"></div>
			<!-- Top penalty area -->
			<div class="absolute top-0 left-1/2 -translate-x-1/2 w-40 sm:w-52 h-12 sm:h-16 border-b border-l border-r border-white/8 rounded-b-sm"></div>
			<!-- Bottom penalty area -->
			<div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-40 sm:w-52 h-12 sm:h-16 border-t border-l border-r border-white/8 rounded-t-sm"></div>

			<!-- Formation: GK → DEF → MID → FWD (top to bottom) -->
			<div class="relative flex flex-col gap-5 sm:gap-7 py-2">
				<!-- GK -->
				<div class="flex justify-center">
					{#each gks as player}
						<button onclick={() => onPlayerClick?.(player)}
							class="flex flex-col items-center gap-0.5 group {selectedId === player.element_id ? 'ring-2 ring-[var(--color-accent)] rounded-lg p-1 -m-1' : ''}">
							<img src={shirtUrl(player.team_code, true)} alt="" class="w-9 h-11 sm:w-11 sm:h-13 drop-shadow-md group-hover:scale-110 transition-transform" />
							<span class="text-[9px] sm:text-[10px] font-semibold text-white/90 bg-black/40 px-1.5 py-px rounded truncate max-w-[64px] sm:max-w-[76px]">{player.web_name}</span>
							<span class="font-mono text-[8px] text-white/50">{formatPrice(player.current_price)}</span>
						</button>
					{/each}
				</div>

				<!-- DEF -->
				<div class="flex justify-center gap-2 sm:gap-4">
					{#each defs as player}
						<button onclick={() => onPlayerClick?.(player)}
							class="flex flex-col items-center gap-0.5 group {selectedId === player.element_id ? 'ring-2 ring-[var(--color-accent)] rounded-lg p-1 -m-1' : ''}">
							<img src={shirtUrl(player.team_code, false)} alt="" class="w-9 h-11 sm:w-11 sm:h-13 drop-shadow-md group-hover:scale-110 transition-transform" />
							<span class="text-[9px] sm:text-[10px] font-semibold text-white/90 bg-black/40 px-1.5 py-px rounded truncate max-w-[64px] sm:max-w-[76px]">{player.web_name}</span>
							<span class="font-mono text-[8px] text-white/50">{formatPrice(player.current_price)}</span>
						</button>
					{/each}
				</div>

				<!-- MID -->
				<div class="flex justify-center gap-2 sm:gap-4">
					{#each mids as player}
						<button onclick={() => onPlayerClick?.(player)}
							class="flex flex-col items-center gap-0.5 group {selectedId === player.element_id ? 'ring-2 ring-[var(--color-accent)] rounded-lg p-1 -m-1' : ''}">
							<img src={shirtUrl(player.team_code, false)} alt="" class="w-9 h-11 sm:w-11 sm:h-13 drop-shadow-md group-hover:scale-110 transition-transform" />
							<span class="text-[9px] sm:text-[10px] font-semibold text-white/90 bg-black/40 px-1.5 py-px rounded truncate max-w-[64px] sm:max-w-[76px]">{player.web_name}</span>
							<span class="font-mono text-[8px] text-white/50">{formatPrice(player.current_price)}</span>
						</button>
					{/each}
				</div>

				<!-- FWD -->
				<div class="flex justify-center gap-3 sm:gap-6">
					{#each fwds as player}
						<button onclick={() => onPlayerClick?.(player)}
							class="flex flex-col items-center gap-0.5 group {selectedId === player.element_id ? 'ring-2 ring-[var(--color-accent)] rounded-lg p-1 -m-1' : ''}">
							<img src={shirtUrl(player.team_code, false)} alt="" class="w-9 h-11 sm:w-11 sm:h-13 drop-shadow-md group-hover:scale-110 transition-transform" />
							<span class="text-[9px] sm:text-[10px] font-semibold text-white/90 bg-black/40 px-1.5 py-px rounded truncate max-w-[64px] sm:max-w-[76px]">{player.web_name}</span>
							<span class="font-mono text-[8px] text-white/50">{formatPrice(player.current_price)}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Bench -->
	<div class="mt-3 px-2 py-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-surface-4)]">
		<div class="text-[9px] text-[var(--color-text-3)] uppercase tracking-widest font-semibold mb-2 px-2">Subs</div>
		<div class="flex justify-around">
			{#each bench as player}
				<button onclick={() => onPlayerClick?.(player)}
					class="flex flex-col items-center gap-0.5 opacity-50 hover:opacity-100 transition-opacity group {selectedId === player.element_id ? 'opacity-100 ring-2 ring-[var(--color-accent)] rounded-lg p-1 -m-1' : ''}">
					<img src={shirtUrl(player.team_code, player.element_type === 1)} alt="" class="w-8 h-10 sm:w-9 sm:h-11 group-hover:scale-110 transition-transform" />
					<span class="text-[8px] sm:text-[9px] font-medium text-[var(--color-text-1)] truncate max-w-[56px]">{player.web_name}</span>
					<span class="font-mono text-[7px] text-[var(--color-text-3)]">{formatPrice(player.current_price)}</span>
				</button>
			{/each}
		</div>
	</div>
</div>
