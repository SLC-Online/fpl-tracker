<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import PlayerPhoto from '$lib/components/PlayerPhoto.svelte';

	const DECAY = 0.85;

	let managerId = $state('');
	let loading = $state(false);
	let errorMsg = $state('');
	let squadData: any = $state(null);

	// Transfer declarations (post-deadline transfers the user has made)
	let declaredTransfers: { out: number; in_id: number; in_name: string }[] = $state([]);

	// Hypothetical transfer options
	let options: { name: string; transfers: { out: number; in_id: number }[]; squad: any[] }[] = $state([]);
	let activeOption = $state(-1);  // -1 = base squad

	async function loadSquad() {
		if (!managerId.trim()) return;
		loading = true;
		errorMsg = '';

		try {
			const resp = await fetch(`/api/squad?id=${managerId.trim()}`);
			if (!resp.ok) {
				const text = await resp.text();
				errorMsg = text || `Error ${resp.status}`;
				return;
			}
			squadData = await resp.json();
		} catch (e: any) {
			errorMsg = e.message;
		} finally {
			loading = false;
		}
	}

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function getTWxP(projections: { gw: number; pts: number }[]): number {
		return projections.reduce((sum, p, i) => sum + p.pts * Math.pow(DECAY, i), 0);
	}

	function getSquadTWxP(squad: any[]): number {
		// For each GW, pick best 11 (by expected points), sum with decay
		if (!squad || squad.length === 0) return 0;

		// Get all GWs represented
		const allGws = new Set<number>();
		for (const p of squad) {
			for (const proj of p.projections || []) {
				allGws.add(proj.gw);
			}
		}
		const gws = [...allGws].sort((a, b) => a - b).slice(0, 8);

		let total = 0;
		for (let i = 0; i < gws.length; i++) {
			const gw = gws[i];
			// Get expected points for each player this GW
			const playerPts = squad.map(p => {
				const proj = (p.projections || []).find((pr: any) => pr.gw === gw);
				return { element_id: p.element_id, element_type: p.element_type, pts: proj?.pts || 0 };
			});

			// Pick optimal 11 respecting position constraints (1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD)
			const best11 = pickOptimal11(playerPts);
			const gwTotal = best11.reduce((s, p) => s + p.pts, 0);
			total += gwTotal * Math.pow(DECAY, i);
		}
		return total;
	}

	function pickOptimal11(players: { element_id: number; element_type: number; pts: number }[]): typeof players {
		// Sort by pts descending within each position
		const gk = players.filter(p => p.element_type === 1).sort((a, b) => b.pts - a.pts);
		const def = players.filter(p => p.element_type === 2).sort((a, b) => b.pts - a.pts);
		const mid = players.filter(p => p.element_type === 3).sort((a, b) => b.pts - a.pts);
		const fwd = players.filter(p => p.element_type === 4).sort((a, b) => b.pts - a.pts);

		// Must have: 1 GK, 3 DEF, 2 MID, 1 FWD minimum = 7 fixed
		// Remaining 4 spots go to highest scoring from remaining DEF/MID/FWD
		const team: typeof players = [];
		team.push(...gk.slice(0, 1));          // 1 GK
		const defPicks = def.slice(0, 3);      // min 3 DEF
		const midPicks = mid.slice(0, 2);      // min 2 MID
		const fwdPicks = fwd.slice(0, 1);      // min 1 FWD
		team.push(...defPicks, ...midPicks, ...fwdPicks);

		// Remaining pool (max from each position)
		const remaining = [
			...def.slice(3, 5),   // up to 2 more DEF
			...mid.slice(2, 5),   // up to 3 more MID
			...fwd.slice(1, 3),   // up to 2 more FWD
		].sort((a, b) => b.pts - a.pts);

		// Fill remaining 4 spots
		team.push(...remaining.slice(0, 4));
		return team.slice(0, 11);
	}

	let starting11 = $derived(squadData?.squad?.filter((p: any) => p.position <= 11) || []);
	let bench = $derived(squadData?.squad?.filter((p: any) => p.position > 11) || []);
	let totalBank = $derived(squadData?.bank || 0);
	let squadTWxP = $derived(getSquadTWxP(squadData?.squad || []));
</script>

<svelte:head>
	<title>My Team — FPL Tracker</title>
</svelte:head>

<div class="space-y-8">
	<header>
		<h1 class="font-display font-bold text-3xl tracking-tight">My Team</h1>
	</header>

	<!-- Squad Loader -->
	{#if !squadData}
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-8 max-w-lg">
			<h2 class="font-display font-semibold text-lg mb-4">Load your squad</h2>
			<p class="text-[var(--color-text-2)] text-sm mb-5">
				Enter your FPL Manager ID. You can find it in your FPL URL when you click "Points" —
				it's the number in the address bar.
			</p>
			<div class="flex gap-3">
				<input
					type="text"
					placeholder="e.g. 1234567"
					bind:value={managerId}
					onkeydown={(e) => { if (e.key === 'Enter') loadSquad(); }}
					class="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)]"
				/>
				<button onclick={loadSquad} disabled={loading || !managerId.trim()}
					class="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] text-white font-medium hover:bg-[var(--color-accent-light)] disabled:opacity-50 disabled:cursor-not-allowed">
					{loading ? 'Loading...' : 'Load'}
				</button>
			</div>
			{#if errorMsg}
				<p class="text-[var(--color-fall)] text-sm mt-3">{errorMsg}</p>
			{/if}
		</section>
	{:else}
		<!-- Manager header -->
		<section class="flex items-center justify-between">
			<div>
				<h2 class="font-display font-semibold text-xl">{squadData.manager.team_name}</h2>
				<p class="text-[var(--color-text-2)] text-sm">
					{squadData.manager.name} · GW{squadData.gameweek} · {squadData.total_points} pts
					· Rank {squadData.manager.overall_rank?.toLocaleString()}
				</p>
			</div>
			<div class="flex gap-6 text-right">
				<div>
					<div class="font-mono text-lg font-semibold">{formatPrice(totalBank)}</div>
					<div class="text-[var(--color-text-2)] text-xs">Bank</div>
				</div>
				<div>
					<div class="font-mono text-lg font-semibold">{formatPrice(squadData.squad_value)}</div>
					<div class="text-[var(--color-text-2)] text-xs">Value</div>
				</div>
				<div>
					<div class="font-mono text-lg font-semibold text-[var(--color-accent)]">{squadTWxP.toFixed(1)}</div>
					<div class="text-[var(--color-text-2)] text-xs">TWxP</div>
				</div>
			</div>
		</section>

		<!-- Starting 11 -->
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
			<div class="px-6 pt-5 pb-3">
				<h3 class="font-display font-semibold text-base">Starting XI</h3>
			</div>
			<div class="px-3 pb-3">
				{#each starting11 as player}
					<div class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-3)]/50 transition-colors">
						<img src={teamBadgeUrl(player.team_code)} alt="" class="w-6 h-6" />
						<div class="flex-1 min-w-0">
							<span class="font-medium text-sm">{player.web_name}</span>
							{#if player.is_captain}
								<span class="ml-1 text-xs bg-[var(--color-accent)] text-white px-1.5 py-0.5 rounded">C</span>
							{/if}
							{#if player.is_vice_captain}
								<span class="ml-1 text-xs bg-[var(--color-surface-4)] text-[var(--color-text-1)] px-1.5 py-0.5 rounded">V</span>
							{/if}
							<span class="text-[var(--color-text-3)] text-xs ml-2">{POSITIONS[player.element_type]}</span>
						</div>
						<span class="font-mono text-xs text-[var(--color-text-2)]">{formatPrice(player.current_price)}</span>
						<span class="font-mono text-xs text-[var(--color-text-2)] w-12 text-right" title="Selling price">
							({formatPrice(player.selling_price)})
						</span>
						<span class="font-mono text-sm font-semibold text-[var(--color-accent-light)] w-12 text-right">
							{getTWxP(player.projections).toFixed(1)}
						</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Bench -->
		<section class="rounded-2xl bg-[var(--color-surface-2)]/50 card-glow overflow-hidden">
			<div class="px-6 pt-5 pb-3">
				<h3 class="font-display font-semibold text-base text-[var(--color-text-2)]">Bench</h3>
			</div>
			<div class="px-3 pb-3">
				{#each bench as player}
					<div class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[var(--color-surface-3)]/30 transition-colors opacity-70">
						<img src={teamBadgeUrl(player.team_code)} alt="" class="w-5 h-5" />
						<div class="flex-1 min-w-0">
							<span class="text-sm">{player.web_name}</span>
							<span class="text-[var(--color-text-3)] text-xs ml-2">{POSITIONS[player.element_type]}</span>
						</div>
						<span class="font-mono text-xs text-[var(--color-text-2)]">{formatPrice(player.current_price)}</span>
						<span class="font-mono text-xs text-[var(--color-text-2)] w-12 text-right">
							({formatPrice(player.selling_price)})
						</span>
						<span class="font-mono text-sm text-[var(--color-text-2)] w-12 text-right">
							{getTWxP(player.projections).toFixed(1)}
						</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Reset -->
		<button onclick={() => { squadData = null; managerId = ''; }}
			class="text-[var(--color-text-2)] text-sm hover:text-[var(--color-text-0)]">
			← Load different team
		</button>
	{/if}
</div>
