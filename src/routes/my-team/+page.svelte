<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import {
		calculateSquadTWxP, calculatePlayerTWxP, applyTransfers,
		transferPointsCost, isTransferWorthIt,
		DECAY, BCV_THRESHOLD, type SquadPlayer, type TransferOption
	} from '$lib/transfer-engine';
	import PitchView from '$lib/components/PitchView.svelte';
	import TransferModal from '$lib/components/TransferModal.svelte';

	// --- View mode ---
	let viewMode: 'pitch' | 'list' = $state('pitch');

	// --- Squad loader state ---
	let managerId = $state('');
	let loading = $state(false);
	let errorMsg = $state('');
	let squadData: any = $state(null);

	// --- Top bar state ---
	let freeTransfers = $state(1);

	// --- Declared actual transfers ---
	let declaredTransfers: { out: SquadPlayer; in: SquadPlayer }[] = $state([]);
	let declareMode = $state(false);
	let declareStep: 'select-out' | 'search-in' = $state('select-out');
	let declareOutPlayer: SquadPlayer | null = $state(null);
	let declareSearchQuery = $state('');
	let declareSearching = $state(false);
	let declaredSectionOpen = $state(false);

	// --- Transfer planner state ---
	let savedOptions: TransferOption[] = $state([]);
	let currentTransfers: { out: SquadPlayer; in: SquadPlayer }[] = $state([]);
	let transferMode = $state(false);
	let transferOutPlayer: SquadPlayer | null = $state(null);
	let searchQuery = $state('');

	// --- Helpers ---
	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function formatRank(rank: number): string {
		if (rank >= 1_000_000) return `${(rank / 1_000_000).toFixed(1)}m`;
		if (rank >= 1_000) return `${(rank / 1_000).toFixed(0)}k`;
		return rank.toLocaleString();
	}

	// --- Squad loading ---
	async function loadSquad() {
		if (!managerId.trim()) return;
		loading = true;
		errorMsg = '';
		try {
			const resp = await fetch(`/api/squad?id=${managerId.trim()}`);
			if (!resp.ok) {
				errorMsg = await resp.text();
				return;
			}
			squadData = await resp.json();
			declaredTransfers = [];
			savedOptions = [];
			currentTransfers = [];
			freeTransfers = 1;
		} catch (e: any) {
			errorMsg = e.message;
		} finally {
			loading = false;
		}
	}

	// --- Base squad from raw API (before declared transfers) ---
	let rawSquad = $derived<SquadPlayer[]>(
		(squadData?.squad || []).map((p: any) => ({
			element_id: p.element_id,
			web_name: p.web_name,
			element_type: p.element_type,
			team_code: p.team_code,
			team_short: p.team_short,
			current_price: p.current_price,
			purchase_price: p.purchase_price,
			selling_price: p.selling_price,
			projections: p.projections || [],
			bcv: null,
		}))
	);
	let rawBank = $derived(squadData?.bank || 0);

	// --- Adjusted squad (after declared actual transfers) ---
	let baseSquad = $derived.by(() => {
		if (declaredTransfers.length === 0) return rawSquad;
		const { squad } = applyTransfers(rawSquad, rawBank, declaredTransfers);
		return squad;
	});

	let baseBank = $derived.by(() => {
		if (declaredTransfers.length === 0) return rawBank;
		const { bank } = applyTransfers(rawSquad, rawBank, declaredTransfers);
		return bank;
	});

	let baseTWxP = $derived(calculateSquadTWxP(baseSquad));

	// --- Working squad (base + planned current transfers) ---
	let workingSquad = $derived.by(() => {
		if (currentTransfers.length === 0) return baseSquad;
		const { squad } = applyTransfers(baseSquad, baseBank, currentTransfers);
		return squad;
	});

	let workingBank = $derived.by(() => {
		if (currentTransfers.length === 0) return baseBank;
		const { bank } = applyTransfers(baseSquad, baseBank, currentTransfers);
		return bank;
	});

	let workingTWxP = $derived(calculateSquadTWxP(workingSquad));

	let transferCost = $derived(transferPointsCost(currentTransfers.length, freeTransfers));

	// --- Squad display (starting XI / bench) ---
	let starting11 = $derived(workingSquad.filter((_, i) => i < 11));
	let bench = $derived(workingSquad.filter((_, i) => i >= 11));

	// --- GW columns ---
	let gwColumns = $derived.by(() => {
		const gws = new Set<number>();
		for (const p of workingSquad) {
			for (const proj of (p.projections || [])) {
				gws.add(proj.gw);
			}
		}
		return [...gws].sort((a, b) => a - b).slice(0, 5);
	});

	function getPlayerGwPts(player: SquadPlayer, gw: number): string {
		const proj = (player.projections || []).find(p => p.gw === gw);
		return proj ? proj.pts.toFixed(1) : '--';
	}

	// --- Declare actual transfers ---
	function startDeclareTransfer() {
		declareMode = true;
		declareStep = 'select-out';
		declareOutPlayer = null;
		declareSearchQuery = '';
		
	}

	function selectDeclareOut(player: SquadPlayer) {
		declareOutPlayer = player;
		declareStep = 'search-in';
		declareSearchQuery = '';
		
	}

	let declareSearchTimeout: any;
	function onDeclareSearchInput() {
		// No-op: search is reactive
	}

	let declareSearchResults = $derived.by(() => {
		if (!declareOutPlayer || declareSearchQuery.length < 2) return [];
		const q = stripAccents(declareSearchQuery);
		const squadIds = new Set(
			rawSquad
				.filter(p => !declaredTransfers.some(t => t.out.element_id === p.element_id))
				.map(p => p.element_id)
		);
		return allPlayers
			.filter(p => {
				if (squadIds.has(p.element_id)) return false;
				const name = stripAccents((p.web_name || '') + ' ' + (p.first_name || '') + ' ' + (p.second_name || ''));
				return name.includes(q);
			})
			.sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
			.slice(0, 30);
	});

	function completeDeclareTransfer(inPlayer: any) {
		if (!declareOutPlayer) return;
		const inSquadPlayer: SquadPlayer = {
			element_id: inPlayer.element_id,
			web_name: inPlayer.web_name,
			element_type: inPlayer.element_type,
			team_code: inPlayer.team_code,
			team_short: inPlayer.team_short,
			current_price: inPlayer.now_cost,
			purchase_price: inPlayer.now_cost,
			selling_price: inPlayer.now_cost,
			projections: inPlayer.projections || [],
			bcv: inPlayer.bcv,
		};
		declaredTransfers = [...declaredTransfers, { out: declareOutPlayer, in: inSquadPlayer }];
		declareMode = false;
		declareOutPlayer = null;
		declareSearchQuery = '';
		
		// Reset planned transfers when base changes
		currentTransfers = [];
	}

	function removeDeclaredTransfer(idx: number) {
		declaredTransfers = declaredTransfers.filter((_, i) => i !== idx);
		currentTransfers = [];
	}

	function cancelDeclare() {
		declareMode = false;
		declareOutPlayer = null;
	}

	// --- Transfer planner ---
	function startTransferOut(player: SquadPlayer) {
		if (transferMode) return;
		transferOutPlayer = player;
		transferMode = true;
		searchQuery = '';
		
	}

	// --- Transfer search (client-side for instant, accent-insensitive filtering) ---
	let allPlayers: any[] = $state([]);
	let allPlayersLoaded = $state(false);

	async function loadAllPlayers() {
		if (allPlayersLoaded) return;
		try {
			// Load without search filter to get all players
			const resp = await fetch('/api/players?q=');
			if (resp.ok) {
				allPlayers = await resp.json();
				allPlayersLoaded = true;
			}
		} catch {}
	}

	$effect(() => {
		if (squadData && !allPlayersLoaded) {
			loadAllPlayers();
		}
	});

	function stripAccents(s: string): string {
		return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
	}

	let searchTimeout: any;
	function onSearchInput() {
		// No-op: search is now reactive via $derived
	}

	let searchResults = $derived.by(() => {
		if (!searchQuery || searchQuery.length < 2 || !transferOutPlayer) return [];
		const q = stripAccents(searchQuery);
		const maxBudget = workingBank + transferOutPlayer.selling_price;
		const squadIds = new Set(workingSquad.map(p => p.element_id));

		return allPlayers
			.filter(p => {
				if (squadIds.has(p.element_id)) return false;
				if (maxBudget > 0 && p.now_cost > maxBudget) return false;
				const name = stripAccents((p.web_name || '') + ' ' + (p.first_name || '') + ' ' + (p.second_name || ''));
				return name.includes(q);
			})
			.sort((a, b) => {
				const twxpA = calculatePlayerTWxP(a.projections || []);
				const twxpB = calculatePlayerTWxP(b.projections || []);
				return twxpB - twxpA;
			})
			.slice(0, 30);
	});

	function completeTransfer(inPlayer: any) {
		if (!transferOutPlayer) return;
		const inSquadPlayer: SquadPlayer = {
			element_id: inPlayer.element_id,
			web_name: inPlayer.web_name,
			element_type: inPlayer.element_type,
			team_code: inPlayer.team_code,
			team_short: inPlayer.team_short,
			current_price: inPlayer.now_cost,
			purchase_price: inPlayer.now_cost,
			selling_price: inPlayer.now_cost,
			projections: inPlayer.projections || [],
			bcv: inPlayer.bcv,
		};
		currentTransfers = [...currentTransfers, { out: transferOutPlayer, in: inSquadPlayer }];
		transferMode = false;
		transferOutPlayer = null;
		searchQuery = '';
		
	}

	function cancelTransfer() {
		transferMode = false;
		transferOutPlayer = null;
		searchQuery = '';
		
	}

	function removeCurrentTransfer(idx: number) {
		currentTransfers = currentTransfers.filter((_, i) => i !== idx);
	}

	function resetTransfers() {
		currentTransfers = [];
		transferMode = false;
		transferOutPlayer = null;
	}

	function saveAsOption() {
		if (currentTransfers.length === 0) return;
		const { squad, bank } = applyTransfers(baseSquad, baseBank, currentTransfers);
		const twxp = calculateSquadTWxP(squad);
		const cost = transferPointsCost(currentTransfers.length, freeTransfers);
		const newOption: TransferOption = {
			id: crypto.randomUUID(),
			name: `Option ${String.fromCharCode(65 + savedOptions.length)}`,
			transfers: [...currentTransfers],
			resultSquad: squad,
			bank,
			twxp,
			twxpDelta: twxp - baseTWxP,
			cost,
			netGain: (twxp - baseTWxP) - cost,
		};
		savedOptions = [...savedOptions, newOption];
		currentTransfers = [];
	}

	function deleteOption(idx: number) {
		savedOptions = savedOptions.filter((_, i) => i !== idx);
	}

	// --- Comparison ---
	let comparisonData = $derived.by(() => {
		const all = [
			{ name: 'No transfer', twxp: baseTWxP, cost: 0, netGain: 0, transfers: [] as any[], verdict: null as any },
			...savedOptions.map(o => ({
				name: o.name,
				twxp: o.twxp,
				cost: o.cost,
				netGain: o.netGain,
				transfers: o.transfers,
				verdict: isTransferWorthIt(o, freeTransfers),
			}))
		];
		const maxTwxp = Math.max(...all.map(a => a.twxp));
		const minTwxp = Math.min(...all.map(a => a.twxp));
		const range = maxTwxp - minTwxp || 1;
		return all.map(a => ({
			...a,
			barWidth: 30 + ((a.twxp - minTwxp) / range) * 70,
		}));
	});

	// Position color helper
	function positionBg(elementType: number): string {
		const colors: Record<number, string> = {
			1: 'bg-amber-500/15 text-amber-400',
			2: 'bg-emerald-500/15 text-emerald-400',
			3: 'bg-blue-500/15 text-blue-400',
			4: 'bg-red-500/15 text-red-400',
		};
		return colors[elementType] || '';
	}

	// Fixture difficulty color (placeholder - ready for real data)
	function fixtureDifficultyClass(_difficulty: number): string {
		const classes: Record<number, string> = {
			1: 'text-emerald-400 bg-emerald-500/10',
			2: 'text-emerald-300 bg-emerald-500/5',
			3: 'text-[var(--color-text-1)]',
			4: 'text-orange-400 bg-orange-500/10',
			5: 'text-red-400 bg-red-500/10',
		};
		return classes[_difficulty] || 'text-[var(--color-text-2)]';
	}
</script>

<svelte:head>
	<title>My Team — FPL Tracker</title>
</svelte:head>

<div class="space-y-6">
	{#if !squadData}
		<!-- ═══════════════════════════════════════════════════════════════
		     SQUAD LOADER
		     ═══════════════════════════════════════════════════════════════ -->
		<div class="flex items-center justify-center min-h-[60vh]">
			<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-8 w-full max-w-md">
				<h1 class="font-display font-bold text-2xl mb-2">Transfer Planner</h1>
				<p class="text-[var(--color-text-2)] text-sm mb-6 leading-relaxed">
					Enter your FPL Manager ID to load your squad. You can find it in the URL when viewing your team on the
					<a href="https://fantasy.premierleague.com" target="_blank" class="text-[var(--color-accent-light)] hover:underline">FPL website</a>
					— it's the number after <code class="font-mono text-xs bg-[var(--color-surface-3)] px-1.5 py-0.5 rounded">/entry/</code>
				</p>
				<div class="flex gap-3">
					<input
						type="text"
						placeholder="e.g. 1234567"
						bind:value={managerId}
						onkeydown={(e) => { if (e.key === 'Enter') loadSquad(); }}
						class="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] font-mono placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30"
					/>
					<button
						onclick={loadSquad}
						disabled={loading || !managerId.trim()}
						class="px-6 py-3 rounded-xl bg-[var(--color-accent)] text-white font-semibold hover:bg-[var(--color-accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{loading ? 'Loading…' : 'Load'}
					</button>
				</div>
				{#if errorMsg}
					<p class="text-[var(--color-fall)] text-sm mt-4">{errorMsg}</p>
				{/if}
			</section>
		</div>
	{:else}
		<!-- ═══════════════════════════════════════════════════════════════
		     TOP BAR
		     ═══════════════════════════════════════════════════════════════ -->
		<header class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-5">
			<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
				<!-- Left: Team info -->
				<div class="min-w-0">
					<h1 class="font-display font-bold text-xl lg:text-2xl truncate">{squadData.manager.team_name}</h1>
					<p class="text-[var(--color-text-2)] text-sm mt-0.5">
						{squadData.manager.name} · GW{squadData.gameweek} · Rank {formatRank(squadData.manager.overall_rank)}
					</p>
				</div>
				<!-- Right: Key stats -->
				<div class="flex flex-wrap items-center gap-4 lg:gap-6">
					<!-- Free Transfers -->
					<div class="text-center">
						<select
							bind:value={freeTransfers}
							class="bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] rounded-lg px-3 py-1.5 font-mono text-sm text-[var(--color-text-0)] focus:outline-none focus:border-[var(--color-accent)]"
						>
							<option value={1}>1 FT</option>
							<option value={2}>2 FT</option>
							<option value={3}>3 FT</option>
							<option value={15}>WC</option>
						</select>
						<div class="text-[var(--color-text-3)] text-[10px] mt-1 uppercase tracking-wider">Free Transfers</div>
					</div>
					<!-- Bank -->
					<div class="text-center">
						<div class="font-mono text-lg font-semibold">{formatPrice(workingBank)}</div>
						<div class="text-[var(--color-text-3)] text-[10px] uppercase tracking-wider">Bank</div>
					</div>
					<!-- Squad Value -->
					<div class="text-center">
						<div class="font-mono text-lg font-semibold">{formatPrice(squadData.squad_value)}</div>
						<div class="text-[var(--color-text-3)] text-[10px] uppercase tracking-wider">Squad Value</div>
					</div>
					<!-- Transfer Cost -->
					<div class="text-center">
						<div class="font-mono text-lg font-semibold {transferCost > 0 ? 'text-[var(--color-fall)]' : 'text-[var(--color-rise)]'}">
							{transferCost > 0 ? `-${transferCost}` : '0'} pts
						</div>
						<div class="text-[var(--color-text-3)] text-[10px] uppercase tracking-wider">Transfer Cost</div>
					</div>
					<!-- TWxP -->
					<div class="text-center">
						<div class="font-mono text-lg font-semibold text-[var(--color-accent-light)]">{workingTWxP.toFixed(1)}</div>
						<div class="text-[var(--color-text-3)] text-[10px] uppercase tracking-wider">TWxP</div>
					</div>
				</div>
			</div>
		</header>

		<!-- ═══════════════════════════════════════════════════════════════
		     DECLARE ACTUAL TRANSFERS
		     ═══════════════════════════════════════════════════════════════ -->
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
			<button
				onclick={() => declaredSectionOpen = !declaredSectionOpen}
				class="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[var(--color-surface-3)]/30"
			>
				<div class="flex items-center gap-3">
					<span class="text-[var(--color-warning)] text-lg">⚠</span>
					<div>
						<h2 class="font-display font-semibold text-sm">Declare Actual Transfers</h2>
						<p class="text-[var(--color-text-2)] text-xs mt-0.5">
							Made transfers since last deadline? Declare them here to update your base squad.
						</p>
					</div>
				</div>
				<span class="text-[var(--color-text-2)] text-sm transition-transform {declaredSectionOpen ? 'rotate-180' : ''}">▾</span>
			</button>

			{#if declaredSectionOpen}
				<div class="px-5 pb-5 border-t border-[var(--color-surface-4)] pt-4 space-y-3">
					<!-- Declared transfers list -->
					{#if declaredTransfers.length > 0}
						<div class="space-y-2">
							{#each declaredTransfers as t, i}
								<div class="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--color-surface-3)]/50 text-sm">
									<img src={teamBadgeUrl(t.out.team_code)} alt="" class="w-4 h-4" />
									<span class="text-[var(--color-fall)]">{t.out.web_name}</span>
									<span class="text-[var(--color-text-3)]">→</span>
									<img src={teamBadgeUrl(t.in.team_code)} alt="" class="w-4 h-4" />
									<span class="text-[var(--color-rise)]">{t.in.web_name}</span>
									<span class="font-mono text-xs text-[var(--color-text-2)] ml-auto">{formatPrice(t.in.current_price)}</span>
									<button onclick={() => removeDeclaredTransfer(i)} class="text-[var(--color-text-3)] hover:text-[var(--color-fall)] ml-2 text-xs">✕</button>
								</div>
							{/each}
						</div>
					{/if}

					{#if declareMode}
						{#if declareStep === 'select-out'}
							<div class="space-y-2">
								<p class="text-[var(--color-text-1)] text-sm font-medium">Who did you sell?</p>
								<div class="max-h-48 overflow-y-auto space-y-1">
									{#each rawSquad.filter(p => !declaredTransfers.some(t => t.out.element_id === p.element_id)) as player}
										<button
											onclick={() => selectDeclareOut(player)}
											class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-surface-3)] transition-colors text-left text-sm"
										>
											<img src={teamBadgeUrl(player.team_code)} alt="" class="w-4 h-4" />
											<span>{player.web_name}</span>
											<span class="text-[var(--color-text-3)] text-xs ml-auto">{POSITIONS[player.element_type]}</span>
											<span class="font-mono text-xs text-[var(--color-text-2)]">{formatPrice(player.selling_price)}</span>
										</button>
									{/each}
								</div>
								<button onclick={cancelDeclare} class="text-[var(--color-text-2)] text-xs hover:text-[var(--color-text-0)]">Cancel</button>
							</div>
						{:else if declareStep === 'search-in' && declareOutPlayer}
							<div class="space-y-2">
								<p class="text-[var(--color-text-1)] text-sm font-medium">
									Sold <span class="text-[var(--color-fall)]">{declareOutPlayer.web_name}</span> — who did you buy?
								</p>
								<input
									type="text"
									placeholder="Search replacement..."
									bind:value={declareSearchQuery}
									oninput={onDeclareSearchInput}
									class="w-full px-4 py-2.5 rounded-xl bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] text-sm"
								/>
								{#if declareSearchResults.length > 0}
									<div class="max-h-48 overflow-y-auto space-y-1">
										{#each declareSearchResults as player}
											<button
												onclick={() => completeDeclareTransfer(player)}
												class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-surface-3)] transition-colors text-left text-sm"
											>
												<img src={teamBadgeUrl(player.team_code)} alt="" class="w-4 h-4" />
												<span class="flex-1">{player.web_name}</span>
												<span class="text-[var(--color-text-3)] text-xs">{player.team_short}</span>
												<span class="font-mono text-xs">{formatPrice(player.now_cost)}</span>
											</button>
										{/each}
									</div>
								{:else if declareSearchQuery.length >= 2 && !declareSearching}
									<p class="text-[var(--color-text-2)] text-xs">No players found.</p>
								{/if}
								<button onclick={cancelDeclare} class="text-[var(--color-text-2)] text-xs hover:text-[var(--color-text-0)]">Cancel</button>
							</div>
						{/if}
					{:else}
						<button
							onclick={startDeclareTransfer}
							class="px-4 py-2 rounded-lg bg-[var(--color-surface-3)] text-sm text-[var(--color-text-1)] hover:bg-[var(--color-surface-4)] hover:text-[var(--color-text-0)]"
						>
							+ Declare a transfer
						</button>
					{/if}
				</div>
			{/if}
		</section>

		<!-- ═══════════════════════════════════════════════════════════════
		     PLANNED TRANSFERS (current working set)
		     ═══════════════════════════════════════════════════════════════ -->
		{#if currentTransfers.length > 0}
			<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-5 space-y-3">
				<div class="flex items-center justify-between">
					<h2 class="font-display font-semibold text-sm">Planned Transfers</h2>
					<div class="flex gap-2">
						<button
							onclick={saveAsOption}
							class="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-medium hover:bg-[var(--color-accent-light)]"
						>
							Save as Option {String.fromCharCode(65 + savedOptions.length)}
						</button>
						<button
							onclick={resetTransfers}
							class="px-3 py-1.5 rounded-lg bg-[var(--color-surface-3)] text-[var(--color-text-2)] text-xs font-medium hover:text-[var(--color-fall)]"
						>
							Reset
						</button>
					</div>
				</div>
				<div class="space-y-2">
					{#each currentTransfers as t, i}
						<div class="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--color-surface-3)]/50 text-sm">
							<img src={teamBadgeUrl(t.out.team_code)} alt="" class="w-5 h-5" />
							<span class="text-[var(--color-fall)] font-medium">{t.out.web_name}</span>
							<span class="font-mono text-xs text-[var(--color-text-3)]">{formatPrice(t.out.selling_price)}</span>
							<span class="text-[var(--color-text-3)] mx-1">→</span>
							<img src={teamBadgeUrl(t.in.team_code)} alt="" class="w-5 h-5" />
							<span class="text-[var(--color-rise)] font-medium">{t.in.web_name}</span>
							<span class="font-mono text-xs text-[var(--color-text-3)]">{formatPrice(t.in.current_price)}</span>
							<span class="font-mono text-xs ml-auto {calculatePlayerTWxP(t.in.projections) - calculatePlayerTWxP(t.out.projections) > 0 ? 'text-[var(--color-rise)]' : 'text-[var(--color-fall)]'}">
								{(calculatePlayerTWxP(t.in.projections) - calculatePlayerTWxP(t.out.projections)) > 0 ? '+' : ''}{(calculatePlayerTWxP(t.in.projections) - calculatePlayerTWxP(t.out.projections)).toFixed(1)} xPts
							</span>
							<button onclick={() => removeCurrentTransfer(i)} class="text-[var(--color-text-3)] hover:text-[var(--color-fall)] ml-2" title="Remove transfer">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
							</button>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ═══════════════════════════════════════════════════════════════
		     TRANSFER MODAL
		     ═══════════════════════════════════════════════════════════════ -->
		{#if transferMode && transferOutPlayer}
			<TransferModal
				outPlayer={transferOutPlayer}
				budget={workingBank + transferOutPlayer.selling_price}
				{allPlayers}
				{allPlayersLoaded}
				onSelect={completeTransfer}
				onCancel={cancelTransfer}
			/>
		{/if}

		<!-- ═══════════════════════════════════════════════════════════════
		     VIEW TOGGLE + SQUAD
		     ═══════════════════════════════════════════════════════════════ -->
		<div class="flex items-center justify-between mb-4">
			<div class="flex items-center gap-1 bg-[var(--color-surface-3)] rounded-lg p-0.5">
				<button
					onclick={() => viewMode = 'pitch'}
					class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors
						{viewMode === 'pitch' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-2)] hover:text-[var(--color-text-0)]'}"
				>Pitch</button>
				<button
					onclick={() => viewMode = 'list'}
					class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors
						{viewMode === 'list' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-2)] hover:text-[var(--color-text-0)]'}"
				>List</button>
			</div>
			{#if !transferMode}
				<p class="text-[var(--color-text-3)] text-xs">Tap a player to transfer out</p>
			{/if}
		</div>

		{#if viewMode === 'pitch'}
			<PitchView
				starting={starting11}
				bench={bench}
				onTransferOut={startTransferOut}
				{transferMode}
			/>
		{:else}
		<!-- LIST VIEW -->
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
					<div class="grid grid-cols-[2.5fr_auto_auto_auto_repeat(var(--gw-cols,5),minmax(0,1fr))_auto_auto] gap-x-2 px-5 py-3 text-[10px] text-[var(--color-text-3)] uppercase tracking-wider border-b border-[var(--color-surface-4)] items-center"
						style="--gw-cols: {gwColumns.length}; grid-template-columns: 2.5fr 52px 60px 60px repeat({gwColumns.length}, minmax(40px,1fr)) 56px 36px;">
						<span>Player</span>
						<span class="text-center">Pos</span>
						<span class="text-right">Price</span>
						<span class="text-center">Fixture</span>
						{#each gwColumns as gw}
							<span class="text-center">GW{gw}</span>
						{/each}
						<span class="text-right">TWxP</span>
						<span></span>
					</div>

					<!-- Starting XI -->
					<div class="px-2 pt-1 pb-2">
						{#each starting11 as player}
							<div class="group grid items-center gap-x-2 px-3 py-2 rounded-xl hover:bg-[var(--color-surface-3)]/40 transition-colors"
								style="grid-template-columns: 2.5fr 52px 60px 60px repeat({gwColumns.length}, minmax(40px,1fr)) 56px 36px;">
								<!-- Player name + team badge -->
								<div class="flex items-center gap-2 min-w-0">
									<img src={teamBadgeUrl(player.team_code)} alt="" class="w-5 h-5 flex-shrink-0" />
									<a href="/player/{player.element_id}" class="font-medium text-sm truncate hover:text-[var(--color-accent-light)] transition-colors">
										{player.web_name}
									</a>
								</div>
								<!-- Position badge -->
								<div class="flex justify-center">
									<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded {positionBg(player.element_type)}">
										{POSITIONS[player.element_type]}
									</span>
								</div>
								<!-- Price (current + selling) -->
								<div class="text-right">
									<span class="font-mono text-xs">{formatPrice(player.current_price)}</span>
									<span class="font-mono text-[10px] text-[var(--color-text-3)] ml-0.5">({formatPrice(player.selling_price)})</span>
								</div>
								<!-- Next fixture (placeholder) -->
								<div class="flex justify-center">
									<span class="text-xs text-[var(--color-text-3)] font-mono">--</span>
								</div>
								<!-- GW expected points -->
								{#each gwColumns as gw}
									<div class="text-center font-mono text-xs text-[var(--color-text-1)]">
										{getPlayerGwPts(player, gw)}
									</div>
								{/each}
								<!-- TWxP -->
								<div class="text-right font-mono text-sm font-semibold text-[var(--color-accent-light)]">
									{calculatePlayerTWxP(player.projections).toFixed(1)}
								</div>
								<!-- Transfer out button -->
								<div class="flex justify-center">
									<button
										onclick={() => startTransferOut(player)}
										disabled={transferMode}
										class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-[var(--color-fall-bg)] text-[var(--color-text-3)] hover:text-[var(--color-fall)] disabled:cursor-not-allowed"
										title="Transfer out"
									>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4m0 0l6-6m-6 6l6 6"/></svg>
									</button>
								</div>
							</div>
						{/each}
					</div>

					<!-- Bench separator -->
					<div class="mx-5 border-t border-dashed border-[var(--color-surface-4)] my-1"></div>
					<div class="px-5 py-1.5">
						<span class="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider font-semibold">Bench</span>
					</div>

					<!-- Bench -->
					<div class="px-2 pb-3 opacity-70">
						{#each bench as player}
							<div class="group grid items-center gap-x-2 px-3 py-1.5 rounded-xl hover:bg-[var(--color-surface-3)]/30 transition-colors"
								style="grid-template-columns: 2.5fr 52px 60px 60px repeat({gwColumns.length}, minmax(40px,1fr)) 56px 36px;">
								<!-- Player name + team badge -->
								<div class="flex items-center gap-2 min-w-0">
									<img src={teamBadgeUrl(player.team_code)} alt="" class="w-5 h-5 flex-shrink-0" />
									<a href="/player/{player.element_id}" class="text-sm truncate hover:text-[var(--color-accent-light)] transition-colors">
										{player.web_name}
									</a>
								</div>
								<!-- Position badge -->
								<div class="flex justify-center">
									<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded {positionBg(player.element_type)}">
										{POSITIONS[player.element_type]}
									</span>
								</div>
								<!-- Price -->
								<div class="text-right">
									<span class="font-mono text-xs">{formatPrice(player.current_price)}</span>
									<span class="font-mono text-[10px] text-[var(--color-text-3)] ml-0.5">({formatPrice(player.selling_price)})</span>
								</div>
								<!-- Fixture placeholder -->
								<div class="flex justify-center">
									<span class="text-xs text-[var(--color-text-3)] font-mono">--</span>
								</div>
								<!-- GW pts -->
								{#each gwColumns as gw}
									<div class="text-center font-mono text-xs text-[var(--color-text-2)]">
										{getPlayerGwPts(player, gw)}
									</div>
								{/each}
								<!-- TWxP -->
								<div class="text-right font-mono text-sm text-[var(--color-text-2)]">
									{calculatePlayerTWxP(player.projections).toFixed(1)}
								</div>
								<!-- Transfer out button -->
								<div class="flex justify-center">
									<button
										onclick={() => startTransferOut(player)}
										disabled={transferMode}
										class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-[var(--color-fall-bg)] text-[var(--color-text-3)] hover:text-[var(--color-fall)] disabled:cursor-not-allowed"
										title="Transfer out"
									>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4m0 0l6-6m-6 6l6 6"/></svg>
									</button>
								</div>
							</div>
						{/each}
					</div>
		</section>
		{/if}

		<!-- ═══════════════════════════════════════════════════════════════
		     COMPARISON VIEW
		     ═══════════════════════════════════════════════════════════════ -->
		{#if savedOptions.length > 0}
			<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-5 space-y-5">
				<div class="flex items-center justify-between">
					<h2 class="font-display font-semibold text-lg">Compare Options</h2>
					<span class="text-[var(--color-text-3)] text-xs">{savedOptions.length} option{savedOptions.length > 1 ? 's' : ''} saved</span>
				</div>

				<div class="grid gap-4 lg:grid-cols-{Math.min(comparisonData.length, 3)}">
					{#each comparisonData as item, i}
						<div class="rounded-xl bg-[var(--color-surface-3)]/40 p-4 space-y-3 {item.verdict?.worth ? 'ring-1 ring-[var(--color-rise)]/30' : ''}">
							<!-- Option header -->
							<div class="flex items-center justify-between">
								<h3 class="font-semibold text-sm">{item.name}</h3>
								{#if i > 0}
									<button onclick={() => deleteOption(i - 1)} class="text-[var(--color-text-3)] hover:text-[var(--color-fall)] text-xs p-1">✕</button>
								{/if}
							</div>

							<!-- Transfers list -->
							{#if item.transfers.length > 0}
								<div class="space-y-1">
									{#each item.transfers as t}
										<div class="flex items-center gap-2 text-xs">
											<span class="text-[var(--color-fall)]">{t.out.web_name}</span>
											<span class="text-[var(--color-text-3)]">→</span>
											<span class="text-[var(--color-rise)]">{t.in.web_name}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-[var(--color-text-2)] text-xs italic">Baseline — no changes</p>
							{/if}

							<!-- Stats -->
							<div class="grid grid-cols-3 gap-2 text-center pt-2 border-t border-[var(--color-surface-4)]">
								<div>
									<div class="font-mono text-sm font-semibold">{item.twxp.toFixed(1)}</div>
									<div class="text-[9px] text-[var(--color-text-3)] uppercase">TWxP</div>
								</div>
								<div>
									<div class="font-mono text-sm font-semibold {item.cost > 0 ? 'text-[var(--color-fall)]' : ''}">{item.cost > 0 ? `-${item.cost}` : '0'}</div>
									<div class="text-[9px] text-[var(--color-text-3)] uppercase">Cost</div>
								</div>
								<div>
									<div class="font-mono text-sm font-semibold {item.netGain > 0 ? 'text-[var(--color-rise)]' : item.netGain < 0 ? 'text-[var(--color-fall)]' : ''}">
										{item.netGain > 0 ? '+' : ''}{item.netGain.toFixed(1)}
									</div>
									<div class="text-[9px] text-[var(--color-text-3)] uppercase">Net Gain</div>
								</div>
							</div>

							<!-- Bar -->
							<div class="h-2 rounded-full overflow-hidden bg-[var(--color-surface-4)]">
								<div
									class="h-full rounded-full transition-all duration-700 {i === 0 ? 'bg-[var(--color-surface-4)]' : item.verdict?.worth ? 'bg-[var(--color-rise)]' : 'bg-[var(--color-fall)]/60'}"
									style="width: {item.barWidth}%"
								></div>
							</div>

							<!-- Verdict -->
							{#if item.verdict}
								<div class="flex items-center gap-2">
									<span class="text-xs px-2.5 py-1 rounded-full font-medium
										{item.verdict.worth ? 'bg-[var(--color-rise-bg)] text-[var(--color-rise)]' : 'bg-[var(--color-fall-bg)] text-[var(--color-fall)]'}">
										{item.verdict.worth ? '✓ Worth it' : '✗ Hold'}
									</span>
									<span class="text-[var(--color-text-2)] text-[10px] flex-1">{item.verdict.reason}</span>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ═══════════════════════════════════════════════════════════════
		     FOOTER
		     ═══════════════════════════════════════════════════════════════ -->
		<div class="flex items-center justify-between pt-2">
			<button
				onclick={() => { squadData = null; managerId = ''; savedOptions = []; currentTransfers = []; declaredTransfers = []; }}
				class="text-[var(--color-text-2)] text-sm hover:text-[var(--color-text-0)] transition-colors"
			>
				← Load different team
			</button>
			<span class="text-[var(--color-text-3)] text-xs">
				TWxP uses {DECAY} decay over 8 GWs · BCV threshold {BCV_THRESHOLD}
			</span>
		</div>
	{/if}
</div>
