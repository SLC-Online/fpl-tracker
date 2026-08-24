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

	// GK at top, then DEF, MID, FWD at bottom
	let gks = $derived(starting.filter((p) => p.element_type === 1));
	let defs = $derived(starting.filter((p) => p.element_type === 2));
	let mids = $derived(starting.filter((p) => p.element_type === 3));
	let fwds = $derived(starting.filter((p) => p.element_type === 4));
</script>

<div class="pitch-wrapper">
	<!-- Main pitch -->
	<div class="pitch-surface">
		<!-- SVG Pitch Markings -->
		<svg
			class="pitch-svg"
			viewBox="0 0 680 1000"
			preserveAspectRatio="xMidYMid slice"
			xmlns="http://www.w3.org/2000/svg"
		>
			<defs>
				<!-- Grass stripe pattern — alternating lighter/darker bands -->
				<pattern
					id="grassStripes"
					x="0"
					y="0"
					width="680"
					height="143"
					patternUnits="userSpaceOnUse"
				>
					<rect x="0" y="0" width="680" height="71.5" fill="rgba(255,255,255,0.028)" />
					<rect x="0" y="71.5" width="680" height="71.5" fill="rgba(0,0,0,0.035)" />
				</pattern>
			</defs>

			<!-- Base pitch colour — vibrant green -->
			<rect x="0" y="0" width="680" height="1000" fill="#2d7a3a" />
			<!-- Grass stripes overlay -->
			<rect x="0" y="0" width="680" height="1000" fill="url(#grassStripes)" />

			<!-- ── Pitch Markings ── -->
			<!-- All markings: white, 40-50% opacity, 2px -->

			<!-- Touchline border -->
			<rect
				x="40"
				y="30"
				width="600"
				height="940"
				fill="none"
				stroke="rgba(255,255,255,0.45)"
				stroke-width="2"
			/>

			<!-- Halfway line -->
			<line
				x1="40"
				y1="500"
				x2="640"
				y2="500"
				stroke="rgba(255,255,255,0.42)"
				stroke-width="2"
			/>

			<!-- Centre circle -->
			<circle
				cx="340"
				cy="500"
				r="80"
				fill="none"
				stroke="rgba(255,255,255,0.40)"
				stroke-width="2"
			/>
			<!-- Centre spot -->
			<circle cx="340" cy="500" r="4" fill="rgba(255,255,255,0.45)" />

			<!-- ── TOP penalty area (GK end) ── -->
			<rect
				x="170"
				y="30"
				width="340"
				height="150"
				fill="none"
				stroke="rgba(255,255,255,0.40)"
				stroke-width="2"
			/>
			<!-- Top 6-yard box -->
			<rect
				x="250"
				y="30"
				width="180"
				height="55"
				fill="none"
				stroke="rgba(255,255,255,0.38)"
				stroke-width="2"
			/>
			<!-- Top penalty spot -->
			<circle cx="340" cy="135" r="3.5" fill="rgba(255,255,255,0.42)" />
			<!-- Top penalty arc (outside the box) -->
			<path
				d="M 265 180 A 80 80 0 0 0 415 180"
				fill="none"
				stroke="rgba(255,255,255,0.36)"
				stroke-width="2"
			/>

			<!-- ── BOTTOM penalty area (FWD end) ── -->
			<rect
				x="170"
				y="820"
				width="340"
				height="150"
				fill="none"
				stroke="rgba(255,255,255,0.40)"
				stroke-width="2"
			/>
			<!-- Bottom 6-yard box -->
			<rect
				x="250"
				y="915"
				width="180"
				height="55"
				fill="none"
				stroke="rgba(255,255,255,0.38)"
				stroke-width="2"
			/>
			<!-- Bottom penalty spot -->
			<circle cx="340" cy="865" r="3.5" fill="rgba(255,255,255,0.42)" />
			<!-- Bottom penalty arc -->
			<path
				d="M 265 820 A 80 80 0 0 1 415 820"
				fill="none"
				stroke="rgba(255,255,255,0.36)"
				stroke-width="2"
			/>

			<!-- ── Corner arcs ── -->
			<path
				d="M 40 42 A 12 12 0 0 0 52 30"
				fill="none"
				stroke="rgba(255,255,255,0.38)"
				stroke-width="2"
			/>
			<path
				d="M 628 30 A 12 12 0 0 0 640 42"
				fill="none"
				stroke="rgba(255,255,255,0.38)"
				stroke-width="2"
			/>
			<path
				d="M 40 958 A 12 12 0 0 1 52 970"
				fill="none"
				stroke="rgba(255,255,255,0.38)"
				stroke-width="2"
			/>
			<path
				d="M 628 970 A 12 12 0 0 1 640 958"
				fill="none"
				stroke="rgba(255,255,255,0.38)"
				stroke-width="2"
			/>
		</svg>

		<!-- Player formation overlay -->
		<div class="formation-container">
			<!-- GK row -->
			<div class="formation-row">
				{#each gks as player}
					<button
						onclick={() => onPlayerClick?.(player)}
						class="player-card"
						class:player-card--selected={selectedId === player.element_id}
					>
						<img
							src={shirtUrl(player.team_code, true)}
							alt={player.web_name}
							class="player-shirt"
						/>
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
						class="player-card"
						class:player-card--selected={selectedId === player.element_id}
					>
						<img
							src={shirtUrl(player.team_code, false)}
							alt={player.web_name}
							class="player-shirt"
						/>
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
						class="player-card"
						class:player-card--selected={selectedId === player.element_id}
					>
						<img
							src={shirtUrl(player.team_code, false)}
							alt={player.web_name}
							class="player-shirt"
						/>
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
						class="player-card"
						class:player-card--selected={selectedId === player.element_id}
					>
						<img
							src={shirtUrl(player.team_code, false)}
							alt={player.web_name}
							class="player-shirt"
						/>
						<div class="player-name-pill">
							<span class="player-name-text">{player.web_name}</span>
						</div>
						<span class="player-price">{formatPrice(player.current_price)}</span>
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Bench area -->
	<div class="bench-area">
		<span class="bench-label">SUBS</span>
		<div class="bench-players">
			{#each bench as player}
				<button
					onclick={() => onPlayerClick?.(player)}
					class="player-card player-card--bench"
					class:player-card--selected={selectedId === player.element_id}
				>
					<img
						src={shirtUrl(player.team_code, player.element_type === 1)}
						alt={player.web_name}
						class="player-shirt player-shirt--bench"
					/>
					<div class="player-name-pill">
						<span class="player-name-text">{player.web_name}</span>
					</div>
					<span class="player-price">{formatPrice(player.current_price)}</span>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	/* ═══════════════════════════════════════════════
	   PITCH WRAPPER
	   ═══════════════════════════════════════════════ */
	.pitch-wrapper {
		position: relative;
		width: 100%;
		max-width: 520px;
		margin: 0 auto;
	}

	/* ═══════════════════════════════════════════════
	   PITCH SURFACE
	   ═══════════════════════════════════════════════ */
	.pitch-surface {
		position: relative;
		width: 100%;
		border-radius: 12px;
		overflow: hidden;
		background: #2d7a3a;
		box-shadow:
			0 4px 24px rgba(0, 0, 0, 0.3),
			0 0 0 1px rgba(255, 255, 255, 0.06);
	}

	.pitch-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* ═══════════════════════════════════════════════
	   FORMATION LAYOUT
	   ═══════════════════════════════════════════════ */
	.formation-container {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 1.25rem 0.5rem;
		min-height: 420px;
	}

	@media (min-width: 640px) {
		.formation-container {
			padding: 1.75rem 1rem;
			min-height: 500px;
		}
	}

	.formation-row {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		gap: 0.25rem;
	}

	@media (min-width: 640px) {
		.formation-row {
			gap: 0.75rem;
		}
	}

	/* ═══════════════════════════════════════════════
	   PLAYER CARD
	   ═══════════════════════════════════════════════ */
	.player-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px 4px 3px;
		border-radius: 8px;
		border: 2px solid transparent;
		background: transparent;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			border-color 0.15s ease;
	}

	.player-card:hover {
		transform: translateY(-2px);
	}

	.player-card--selected {
		border-color: rgba(99, 102, 241, 0.85);
		background: rgba(99, 102, 241, 0.08);
		transform: translateY(-2px);
	}

	/* ═══════════════════════════════════════════════
	   SHIRT IMAGE
	   ═══════════════════════════════════════════════ */
	.player-shirt {
		width: 44px;
		height: auto;
		object-fit: contain;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
	}

	@media (min-width: 640px) {
		.player-shirt {
			width: 54px;
		}
	}

	.player-shirt--bench {
		width: 36px;
	}

	@media (min-width: 640px) {
		.player-shirt--bench {
			width: 44px;
		}
	}

	/* ═══════════════════════════════════════════════
	   NAME PILL
	   ═══════════════════════════════════════════════ */
	.player-name-pill {
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(6px);
		border-radius: 9999px;
		padding: 1px 8px;
		max-width: 76px;
		overflow: hidden;
	}

	@media (min-width: 640px) {
		.player-name-pill {
			max-width: 88px;
			padding: 2px 10px;
		}
	}

	.player-name-text {
		font-size: 10px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.92);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
		line-height: 1.4;
	}

	/* ═══════════════════════════════════════════════
	   PRICE LABEL
	   ═══════════════════════════════════════════════ */
	.player-price {
		font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
		font-size: 9px;
		color: rgba(255, 255, 255, 0.5);
		line-height: 1.3;
	}

	/* ═══════════════════════════════════════════════
	   BENCH AREA
	   ═══════════════════════════════════════════════ */
	.bench-area {
		margin-top: 10px;
		padding: 10px 12px 12px;
		border-radius: 10px;
		background: var(--color-surface-2, #1e2330);
		border: 1px solid var(--color-surface-4, rgba(255, 255, 255, 0.06));
	}

	.bench-label {
		display: block;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--color-text-3, rgba(255, 255, 255, 0.4));
		margin-bottom: 6px;
		padding-left: 2px;
	}

	.bench-players {
		display: flex;
		justify-content: space-around;
		align-items: flex-start;
	}

	/* ═══════════════════════════════════════════════
	   BENCH PLAYER CARD OVERRIDES
	   ═══════════════════════════════════════════════ */
	.player-card--bench {
		padding: 3px 3px 2px;
	}

	.player-card--bench .player-name-pill {
		max-width: 66px;
	}

	@media (min-width: 640px) {
		.player-card--bench .player-name-pill {
			max-width: 78px;
		}
	}
</style>
