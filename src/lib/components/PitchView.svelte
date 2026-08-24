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

<div class="pitch-wrapper">
	<!-- Main pitch with inline SVG background -->
	<div class="pitch-surface">
		<!-- SVG Pitch Markings -->
		<svg class="pitch-svg" viewBox="0 0 680 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<!-- Pitch grass stripe pattern -->
				<pattern id="grassStripes" x="0" y="0" width="680" height="200" patternUnits="userSpaceOnUse">
					<rect x="0" y="0" width="680" height="100" fill="rgba(255,255,255,0.03)" />
					<rect x="0" y="100" width="680" height="100" fill="rgba(0,0,0,0.03)" />
				</pattern>
				<!-- Vignette radial gradient -->
				<radialGradient id="pitchVignette" cx="50%" cy="50%" r="70%">
					<stop offset="0%" stop-color="transparent" />
					<stop offset="85%" stop-color="transparent" />
					<stop offset="100%" stop-color="rgba(8,13,25,0.55)" />
				</radialGradient>
			</defs>

			<!-- Base pitch color -->
			<rect x="0" y="0" width="680" height="1000" fill="#1b5e20" />
			<!-- Grass stripes -->
			<rect x="0" y="0" width="680" height="1000" fill="url(#grassStripes)" />

			<!-- Pitch outline -->
			<rect x="40" y="30" width="600" height="940" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2" />

			<!-- Halfway line -->
			<line x1="40" y1="500" x2="640" y2="500" stroke="rgba(255,255,255,0.09)" stroke-width="1.5" />

			<!-- Centre circle -->
			<circle cx="340" cy="500" r="80" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" />
			<!-- Centre spot -->
			<circle cx="340" cy="500" r="3" fill="rgba(255,255,255,0.12)" />

			<!-- TOP: Penalty area (GK end) -->
			<rect x="170" y="30" width="340" height="150" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.5" />
			<!-- Top 6-yard box -->
			<rect x="250" y="30" width="180" height="55" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />
			<!-- Top penalty spot -->
			<circle cx="340" cy="135" r="2.5" fill="rgba(255,255,255,0.1)" />
			<!-- Top penalty arc -->
			<path d="M 265 180 A 80 80 0 0 0 415 180" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />

			<!-- BOTTOM: Penalty area (FWD end) -->
			<rect x="170" y="820" width="340" height="150" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.5" />
			<!-- Bottom 6-yard box -->
			<rect x="250" y="915" width="180" height="55" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />
			<!-- Bottom penalty spot -->
			<circle cx="340" cy="865" r="2.5" fill="rgba(255,255,255,0.1)" />
			<!-- Bottom penalty arc -->
			<path d="M 265 820 A 80 80 0 0 1 415 820" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />

			<!-- Corner arcs -->
			<path d="M 40 38 A 8 8 0 0 0 48 30" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />
			<path d="M 632 30 A 8 8 0 0 0 640 38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />
			<path d="M 40 962 A 8 8 0 0 1 48 970" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />
			<path d="M 632 970 A 8 8 0 0 1 640 962" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2" />

			<!-- Vignette overlay -->
			<rect x="0" y="0" width="680" height="1000" fill="url(#pitchVignette)" />
		</svg>

		<!-- Player formation overlay -->
		<div class="formation-container">
			<!-- GK row -->
			<div class="formation-row">
				{#each gks as player}
					<button
						onclick={() => onPlayerClick?.(player)}
						class="player-node {selectedId === player.element_id ? 'player-node--selected' : ''}"
					>
						<div class="player-shirt-wrapper">
							<img src={shirtUrl(player.team_code, true)} alt="" class="player-shirt" />
							{#if selectedId === player.element_id}
								<div class="player-glow"></div>
							{/if}
						</div>
						<div class="player-name-pill">
							<span class="player-name-text">{player.web_name}</span>
						</div>
						<span class="player-price">{formatPrice(player.current_price)}</span>
					</button>
				{/each}
			</div>

			<!-- DEF row -->
			<div class="formation-row">
				{#each defs as player}
					<button
						onclick={() => onPlayerClick?.(player)}
						class="player-node {selectedId === player.element_id ? 'player-node--selected' : ''}"
					>
						<div class="player-shirt-wrapper">
							<img src={shirtUrl(player.team_code, false)} alt="" class="player-shirt" />
							{#if selectedId === player.element_id}
								<div class="player-glow"></div>
							{/if}
						</div>
						<div class="player-name-pill">
							<span class="player-name-text">{player.web_name}</span>
						</div>
						<span class="player-price">{formatPrice(player.current_price)}</span>
					</button>
				{/each}
			</div>

			<!-- MID row -->
			<div class="formation-row">
				{#each mids as player}
					<button
						onclick={() => onPlayerClick?.(player)}
						class="player-node {selectedId === player.element_id ? 'player-node--selected' : ''}"
					>
						<div class="player-shirt-wrapper">
							<img src={shirtUrl(player.team_code, false)} alt="" class="player-shirt" />
							{#if selectedId === player.element_id}
								<div class="player-glow"></div>
							{/if}
						</div>
						<div class="player-name-pill">
							<span class="player-name-text">{player.web_name}</span>
						</div>
						<span class="player-price">{formatPrice(player.current_price)}</span>
					</button>
				{/each}
			</div>

			<!-- FWD row -->
			<div class="formation-row">
				{#each fwds as player}
					<button
						onclick={() => onPlayerClick?.(player)}
						class="player-node {selectedId === player.element_id ? 'player-node--selected' : ''}"
					>
						<div class="player-shirt-wrapper">
							<img src={shirtUrl(player.team_code, false)} alt="" class="player-shirt" />
							{#if selectedId === player.element_id}
								<div class="player-glow"></div>
							{/if}
						</div>
						<div class="player-name-pill">
							<span class="player-name-text">{player.web_name}</span>
						</div>
						<span class="player-price">{formatPrice(player.current_price)}</span>
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Bench -->
	<div class="bench-area">
		<div class="bench-label">SUBS</div>
		<div class="bench-players">
			{#each bench as player}
				<button
					onclick={() => onPlayerClick?.(player)}
					class="player-node player-node--bench {selectedId === player.element_id ? 'player-node--selected' : ''}"
				>
					<div class="player-shirt-wrapper">
						<img src={shirtUrl(player.team_code, player.element_type === 1)} alt="" class="player-shirt player-shirt--bench" />
						{#if selectedId === player.element_id}
							<div class="player-glow"></div>
						{/if}
					</div>
					<div class="player-name-pill player-name-pill--bench">
						<span class="player-name-text">{player.web_name}</span>
					</div>
					<span class="player-price">{formatPrice(player.current_price)}</span>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.pitch-wrapper {
		position: relative;
		width: 100%;
	}

	/* ─── Pitch Surface ─── */
	.pitch-surface {
		position: relative;
		width: 100%;
		border-radius: 16px;
		overflow: hidden;
		background: #1b5e20;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.04),
			0 20px 60px -12px rgba(0, 0, 0, 0.6),
			inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.pitch-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* ─── Formation Container ─── */
	.formation-container {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem 1rem;
	}

	@media (min-width: 640px) {
		.formation-container {
			gap: 1.5rem;
			padding: 2rem 1.5rem;
		}
	}

	.formation-row {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
	}

	@media (min-width: 640px) {
		.formation-row {
			gap: 1rem;
		}
	}

	/* ─── Player Node ─── */
	.player-node {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px 6px;
		border-radius: 10px;
		border: none;
		background: transparent;
		cursor: pointer;
		position: relative;
		transition: transform 0.2s ease, filter 0.2s ease;
	}

	.player-node:hover {
		transform: translateY(-3px) scale(1.04);
		filter: brightness(1.1);
	}

	.player-node--selected {
		transform: translateY(-4px) scale(1.06);
	}

	.player-node--bench {
		opacity: 0.8;
	}

	.player-node--bench:hover {
		opacity: 1;
	}

	.player-node--selected.player-node--bench {
		opacity: 1;
	}

	/* ─── Shirt ─── */
	.player-shirt-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.player-shirt {
		width: 48px;
		height: 60px;
		object-fit: contain;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
		transition: transform 0.2s ease;
	}

	@media (min-width: 640px) {
		.player-shirt {
			width: 56px;
			height: 70px;
		}
	}

	.player-shirt--bench {
		width: 40px;
		height: 50px;
	}

	@media (min-width: 640px) {
		.player-shirt--bench {
			width: 40px;
			height: 50px;
		}
	}

	/* ─── Selection Glow ─── */
	.player-glow {
		position: absolute;
		inset: -8px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(99, 102, 241, 0.45) 0%, rgba(99, 102, 241, 0.15) 50%, transparent 70%);
		animation: pulseGlow 2s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes pulseGlow {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.6;
			transform: scale(1.15);
		}
	}

	/* ─── Name Pill ─── */
	.player-name-pill {
		background: rgba(8, 13, 25, 0.75);
		backdrop-filter: blur(4px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		padding: 1px 6px;
		max-width: 72px;
		overflow: hidden;
	}

	@media (min-width: 640px) {
		.player-name-pill {
			max-width: 84px;
			padding: 2px 8px;
		}
	}

	.player-name-pill--bench {
		max-width: 60px;
	}

	@media (min-width: 640px) {
		.player-name-pill--bench {
			max-width: 72px;
		}
	}

	.player-name-text {
		font-size: 9px;
		font-weight: 600;
		color: rgba(248, 250, 252, 0.9);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
	}

	@media (min-width: 640px) {
		.player-name-text {
			font-size: 10px;
		}
	}

	.player-price {
		font-family: 'Sohne Mono', monospace;
		font-size: 8px;
		color: rgba(255, 255, 255, 0.4);
		margin-top: 1px;
	}

	@media (min-width: 640px) {
		.player-price {
			font-size: 9px;
		}
	}

	/* ─── Bench Area ─── */
	.bench-area {
		margin-top: 12px;
		padding: 12px 16px 14px;
		border-radius: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		box-shadow:
			inset 0 2px 8px rgba(0, 0, 0, 0.3),
			0 -1px 0 rgba(255, 255, 255, 0.02);
	}

	.bench-label {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.15em;
		color: var(--color-text-3);
		margin-bottom: 8px;
		padding-left: 4px;
	}

	.bench-players {
		display: flex;
		justify-content: space-around;
		align-items: flex-start;
	}
</style>
