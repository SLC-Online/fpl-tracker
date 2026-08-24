<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import {
		calculateSquadTWxP, calculatePlayerTWxP, applyTransfers,
		transferPointsCost, isTransferWorthIt,
		DECAY, BCV_THRESHOLD, type SquadPlayer, type TransferOption
	} from '$lib/transfer-engine';
	import PitchView from '$lib/components/PitchView.svelte';

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
	let filterTeam = $state('');
	let filterPos = $state('');
	let sortBy: 'twxp' | 'price' | 'form' | 'points' | 'ep_next' | 'transfers_in' | 'xg' = $state('twxp');
	let sortAsc = $state(false);

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

	// --- Working squad (base + planned transfers, respecting manual ordering for subs) ---
	let workingSquadRaw = $derived.by(() => {
		if (currentTransfers.length === 0) return baseSquad;
		return applyTransfers(baseSquad, baseBank, currentTransfers).squad;
	});

	let workingSquad = $derived.by(() => {
		if (manualSquadOrder.length === 0) return workingSquadRaw;
		// Reorder based on manual order (from subs)
		const byId = new Map(workingSquadRaw.map(p => [p.element_id, p]));
		const ordered: SquadPlayer[] = [];
		for (const id of manualSquadOrder) {
			const p = byId.get(id);
			if (p) ordered.push(p);
		}
		// Add any players not in the manual order (new transfers)
		for (const p of workingSquadRaw) {
			if (!manualSquadOrder.includes(p.element_id)) ordered.push(p);
		}
		return ordered;
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
		if (transferOutPlayer?.element_id === player.element_id) {
			// Clicking same player deselects
			cancelTransfer();
			return;
		}
		transferOutPlayer = player;
		transferMode = true;
		searchQuery = '';
		filterTeam = '';
		filterPos = String(player.element_type);
		budgetFilterOn = true;  // Default to showing affordable players
	}

	// --- Player interaction: unified click handler ---
	// Click a player on pitch:
	//   - If no one selected → select them
	//   - If same player → deselect
	//   - If another squad player is already selected → SWAP (substitution)
	let selectedPlayer: SquadPlayer | null = $state(null);

	function onPitchPlayerClick(player: SquadPlayer) {
		if (!selectedPlayer) {
			// Select this player
			selectedPlayer = player;
			transferMode = true;
			transferOutPlayer = player;
			searchQuery = '';
			filterTeam = '';
			filterPos = String(player.element_type);
			budgetFilterOn = true;
		} else if (selectedPlayer.element_id === player.element_id) {
			// Deselect
			deselectPlayer();
		} else {
			// Swap the two players (substitution) — validate formation first
			const idx1 = workingSquadRaw.findIndex(p => p.element_id === selectedPlayer!.element_id);
			const idx2 = workingSquadRaw.findIndex(p => p.element_id === player.element_id);
			if (idx1 !== -1 && idx2 !== -1) {
				// Check if swap would create invalid formation
				const newSquad = [...workingSquadRaw];
				[newSquad[idx1], newSquad[idx2]] = [newSquad[idx2], newSquad[idx1]];
				const newStarting = newSquad.slice(0, 11);
				const gkCount = newStarting.filter(p => p.element_type === 1).length;
				const defCount = newStarting.filter(p => p.element_type === 2).length;
				const midCount = newStarting.filter(p => p.element_type === 3).length;
				const fwdCount = newStarting.filter(p => p.element_type === 4).length;

				// FPL constraints: 1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD
				if (gkCount !== 1 || defCount < 3 || defCount > 5 || midCount < 2 || midCount > 5 || fwdCount < 1 || fwdCount > 3) {
					// Invalid formation — don't allow
					deselectPlayer();
					return;
				}

				manualSquadOrder = newSquad.map(p => p.element_id);
			}
			deselectPlayer();
		}
	}

	function deselectPlayer() {
		selectedPlayer = null;
		transferMode = false;
		transferOutPlayer = null;
	}

	// Manual squad ordering (for subs) — stores the desired element_id order
	let manualSquadOrder: number[] = $state([]);

	// --- Transfer search (client-side for instant, accent-insensitive filtering) ---
	let allPlayers: any[] = $state([]);
	let allPlayersLoaded = $state(false);

	async function loadAllPlayers() {
		if (allPlayersLoaded) return;
		try {
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

	// Budget filter toggle
	let budgetFilterOn = $state(false);

	let searchResults = $derived.by(() => {
		if (!allPlayersLoaded) return [];
		const squadIds = new Set(workingSquad.map(p => p.element_id));
		const q = searchQuery ? stripAccents(searchQuery) : '';

		// Budget: only filter if toggle is on AND a player is selected
		const maxBudget = (budgetFilterOn && transferOutPlayer)
			? workingBank + transferOutPlayer.selling_price
			: Infinity;

		return allPlayers
			.filter(p => {
				if (squadIds.has(p.element_id)) return false;
				if (p.now_cost > maxBudget) return false;
				// Position filter
				if (filterPos && p.element_type !== parseInt(filterPos)) return false;
				// Team filter
				if (filterTeam && p.team_short !== filterTeam) return false;
				// Name search
				if (q.length >= 2) {
					const name = stripAccents((p.web_name || '') + ' ' + (p.first_name || '') + ' ' + (p.second_name || ''));
					if (!name.includes(q)) return false;
				}
				return true;
			})
			.sort((a, b) => {
				let diff = 0;
				if (sortBy === 'twxp') diff = calculatePlayerTWxP(b.projections || []) - calculatePlayerTWxP(a.projections || []);
				else if (sortBy === 'price') diff = b.now_cost - a.now_cost;
				else if (sortBy === 'form') diff = parseFloat(b.form || '0') - parseFloat(a.form || '0');
				else if (sortBy === 'points') diff = (b.total_points || 0) - (a.total_points || 0);
				else if (sortBy === 'ep_next') diff = parseFloat(b.ep_next || '0') - parseFloat(a.ep_next || '0');
				else if (sortBy === 'transfers_in') diff = (b.transfers_in_event || 0) - (a.transfers_in_event || 0);
				else if (sortBy === 'xg') diff = parseFloat(b.expected_goals || '0') - parseFloat(a.expected_goals || '0');
				return sortAsc ? -diff : diff;
			})
			.slice(0, 40);
	});

	// Available teams for filter dropdown
	let availableTeams = $derived.by(() => {
		const teams = new Set<string>();
		for (const p of allPlayers) {
			if (p.team_short) teams.add(p.team_short);
		}
		return [...teams].sort();
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
		// Update manual order: replace the outgoing player's id with incoming
		if (manualSquadOrder.length > 0) {
			manualSquadOrder = manualSquadOrder.map(id => id === transferOutPlayer!.element_id ? inPlayer.element_id : id);
		}
		deselectPlayer();
	}

	function cancelTransfer() {
		deselectPlayer();
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

	// Fixture difficulty color (placeholder)
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

{#if !squadData}
	<!-- ═══════════════════════════════════════════════════════════════
	     SQUAD LOADER
	     ═══════════════════════════════════════════════════════════════ -->
	<div class="loader-container">
		<section class="loader-card">
			<div class="loader-icon">
				<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
					<circle cx="24" cy="24" r="20" stroke="var(--color-surface-4)" stroke-width="2" />
					<circle cx="24" cy="24" r="8" stroke="var(--color-accent)" stroke-width="1.5" fill="none" />
					<path d="M24 4 L24 8 M24 40 L24 44 M4 24 L8 24 M40 24 L44 24" stroke="var(--color-surface-4)" stroke-width="1.5" stroke-linecap="round" />
				</svg>
			</div>
			<h1 class="font-display font-bold text-3xl mb-1 text-[var(--color-text-0)]">Transfer Planner</h1>
			<p class="text-[var(--color-text-2)] text-sm mb-8 leading-relaxed max-w-sm text-center">
				Enter your FPL Manager ID to load your squad.<br />
				Find it in the URL after <code class="font-mono text-[10px] bg-[var(--color-surface-3)] px-1.5 py-0.5 rounded text-[var(--color-accent-light)]">/entry/</code>
			</p>
			<div class="loader-input-group">
				<input
					type="text"
					placeholder="e.g. 1234567"
					bind:value={managerId}
					onkeydown={(e) => { if (e.key === 'Enter') loadSquad(); }}
					class="loader-input"
				/>
				<button
					onclick={loadSquad}
					disabled={loading || !managerId.trim()}
					class="loader-btn"
				>
					{#if loading}
						<svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" /></svg>
					{:else}
						Load Squad
					{/if}
				</button>
			</div>
			{#if errorMsg}
				<p class="text-[var(--color-fall)] text-sm mt-4 text-center">{errorMsg}</p>
			{/if}
		</section>
	</div>
{:else}
	<div class="page-shell">
		<!-- ═══════════════════════════════════════════════════════════════
		     TOP BAR
		     ═══════════════════════════════════════════════════════════════ -->
		<header class="top-bar">
			<div class="top-bar-inner">
				<!-- Left: Team info -->
				<div class="top-bar-team">
					<h1 class="font-display font-bold text-xl truncate">{squadData.manager.team_name}</h1>
					<p class="top-bar-meta">
						{squadData.manager.name} · GW{squadData.gameweek} · Rank {formatRank(squadData.manager.overall_rank)}
					</p>
				</div>
				<!-- Right: Stats strip -->
				<div class="top-bar-stats">
					<div class="stat-cell">
						<select
							bind:value={freeTransfers}
							class="stat-select"
						>
							<option value={1}>1 FT</option>
							<option value={2}>2 FT</option>
							<option value={3}>3 FT</option>
							<option value={15}>WC</option>
						</select>
						<span class="stat-label">Transfers</span>
					</div>
					<div class="stat-cell">
						<span class="stat-value font-mono">{formatPrice(workingBank)}</span>
						<span class="stat-label">Bank</span>
					</div>
					<div class="stat-cell">
						<span class="stat-value font-mono">{formatPrice(squadData.squad_value)}</span>
						<span class="stat-label">Value</span>
					</div>
					<div class="stat-cell">
						<span class="stat-value font-mono {transferCost > 0 ? 'text-[var(--color-fall)]' : 'text-[var(--color-rise)]'}">
							{transferCost > 0 ? `-${transferCost}` : '0'}
						</span>
						<span class="stat-label">Cost</span>
					</div>
					<div class="stat-cell">
						<span class="stat-value font-mono text-[var(--color-accent-light)]">{workingTWxP.toFixed(1)}</span>
						<span class="stat-label">TWxP</span>
					</div>
				</div>
			</div>
		</header>

		<!-- ═══════════════════════════════════════════════════════════════
		     DECLARE ACTUAL TRANSFERS (Collapsible)
		     ═══════════════════════════════════════════════════════════════ -->
		<section class="declare-section">
			<button
				onclick={() => declaredSectionOpen = !declaredSectionOpen}
				class="declare-toggle"
			>
				<div class="flex items-center gap-3">
					<span class="declare-icon">⚠</span>
					<div>
						<span class="declare-title">Declare Actual Transfers</span>
						{#if declaredTransfers.length > 0}
							<span class="declare-count">{declaredTransfers.length}</span>
						{/if}
					</div>
				</div>
				<svg class="declare-chevron {declaredSectionOpen ? 'rotate-180' : ''}" width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
			</button>

			{#if declaredSectionOpen}
				<div class="declare-body">
					{#if declaredTransfers.length > 0}
						<div class="space-y-2 mb-3">
							{#each declaredTransfers as t, i}
								<div class="transfer-pill">
									<img src={teamBadgeUrl(t.out.team_code)} alt="" class="w-4 h-4" />
									<span class="text-[var(--color-fall)] text-xs font-medium">{t.out.web_name}</span>
									<svg class="w-3 h-3 text-[var(--color-text-3)]" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
									<img src={teamBadgeUrl(t.in.team_code)} alt="" class="w-4 h-4" />
									<span class="text-[var(--color-rise)] text-xs font-medium">{t.in.web_name}</span>
									<span class="font-mono text-[10px] text-[var(--color-text-2)] ml-auto">{formatPrice(t.in.current_price)}</span>
									<button onclick={() => removeDeclaredTransfer(i)} class="ml-2 text-[var(--color-text-3)] hover:text-[var(--color-fall)] text-xs leading-none">✕</button>
								</div>
							{/each}
						</div>
					{/if}

					{#if declareMode}
						{#if declareStep === 'select-out'}
							<div class="space-y-2">
								<p class="text-[var(--color-text-1)] text-xs font-medium">Who did you sell?</p>
								<div class="declare-player-list">
									{#each rawSquad.filter(p => !declaredTransfers.some(t => t.out.element_id === p.element_id)) as player}
										<button onclick={() => selectDeclareOut(player)} class="declare-player-row">
											<img src={teamBadgeUrl(player.team_code)} alt="" class="w-4 h-4" />
											<span class="flex-1 text-xs">{player.web_name}</span>
											<span class="text-[var(--color-text-3)] text-[10px]">{POSITIONS[player.element_type]}</span>
											<span class="font-mono text-[10px] text-[var(--color-text-2)]">{formatPrice(player.selling_price)}</span>
										</button>
									{/each}
								</div>
								<button onclick={cancelDeclare} class="text-[var(--color-text-3)] text-[10px] hover:text-[var(--color-text-1)]">Cancel</button>
							</div>
						{:else if declareStep === 'search-in' && declareOutPlayer}
							<div class="space-y-2">
								<p class="text-[var(--color-text-1)] text-xs font-medium">
									Sold <span class="text-[var(--color-fall)]">{declareOutPlayer.web_name}</span> — who came in?
								</p>
								<input
									type="text"
									placeholder="Search replacement..."
									bind:value={declareSearchQuery}
									oninput={onDeclareSearchInput}
									class="panel-search-input"
								/>
								{#if declareSearchResults.length > 0}
									<div class="declare-player-list">
										{#each declareSearchResults as player}
											<button onclick={() => completeDeclareTransfer(player)} class="declare-player-row">
												<img src={teamBadgeUrl(player.team_code)} alt="" class="w-4 h-4" />
												<span class="flex-1 text-xs">{player.web_name}</span>
												<span class="text-[var(--color-text-3)] text-[10px]">{player.team_short}</span>
												<span class="font-mono text-[10px]">{formatPrice(player.now_cost)}</span>
											</button>
										{/each}
									</div>
								{:else if declareSearchQuery.length >= 2 && !declareSearching}
									<p class="text-[var(--color-text-3)] text-[10px]">No players found.</p>
								{/if}
								<button onclick={cancelDeclare} class="text-[var(--color-text-3)] text-[10px] hover:text-[var(--color-text-1)]">Cancel</button>
							</div>
						{/if}
					{:else}
						<button onclick={startDeclareTransfer} class="declare-add-btn">
							+ Declare a transfer
						</button>
					{/if}
				</div>
			{/if}
		</section>

		<!-- ═══════════════════════════════════════════════════════════════
		     PLANNED TRANSFERS STRIP
		     ═══════════════════════════════════════════════════════════════ -->
		{#if currentTransfers.length > 0}
			<section class="transfers-strip">
				<div class="transfers-strip-header">
					<h2 class="font-display font-semibold text-sm">Planned Transfers</h2>
					<div class="flex gap-2">
						<button onclick={saveAsOption} class="strip-btn strip-btn--accent">
							Save as Option {String.fromCharCode(65 + savedOptions.length)}
						</button>
						<button onclick={resetTransfers} class="strip-btn strip-btn--ghost">
							Reset
						</button>
					</div>
				</div>
				<div class="transfers-strip-list">
					{#each currentTransfers as t, i}
						<div class="transfer-pill transfer-pill--lg">
							<img src={teamBadgeUrl(t.out.team_code)} alt="" class="w-5 h-5" />
							<span class="text-[var(--color-fall)] text-xs font-semibold">{t.out.web_name}</span>
							<span class="font-mono text-[10px] text-[var(--color-text-3)]">{formatPrice(t.out.selling_price)}</span>
							<svg class="w-3.5 h-3.5 text-[var(--color-text-3)]" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
							<img src={teamBadgeUrl(t.in.team_code)} alt="" class="w-5 h-5" />
							<span class="text-[var(--color-rise)] text-xs font-semibold">{t.in.web_name}</span>
							<span class="font-mono text-[10px] text-[var(--color-text-3)]">{formatPrice(t.in.current_price)}</span>
							<span class="font-mono text-[10px] ml-auto {calculatePlayerTWxP(t.in.projections) - calculatePlayerTWxP(t.out.projections) > 0 ? 'text-[var(--color-rise)]' : 'text-[var(--color-fall)]'}">
								{(calculatePlayerTWxP(t.in.projections) - calculatePlayerTWxP(t.out.projections)) > 0 ? '+' : ''}{(calculatePlayerTWxP(t.in.projections) - calculatePlayerTWxP(t.out.projections)).toFixed(1)}
							</span>
							<button onclick={() => removeCurrentTransfer(i)} class="ml-2 text-[var(--color-text-3)] hover:text-[var(--color-fall)]">
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
							</button>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ═══════════════════════════════════════════════════════════════
		     MAIN SPLIT LAYOUT: Pitch (left) + Panel (right)
		     ═══════════════════════════════════════════════════════════════ -->
		<!-- View toggle (above split for alignment) -->
				<div class="view-toggle-bar">
					<div class="view-toggle-pills">
						<button
							onclick={() => viewMode = 'pitch'}
							class="view-pill {viewMode === 'pitch' ? 'view-pill--active' : ''}"
						>Pitch</button>
						<button
							onclick={() => viewMode = 'list'}
							class="view-pill {viewMode === 'list' ? 'view-pill--active' : ''}"
						>List</button>
					</div>
					{#if selectedPlayer}
						<span class="text-[10px] text-[var(--color-accent-light)]">
							<strong class="font-semibold">{selectedPlayer.web_name}</strong> selected
							<button onclick={deselectPlayer} class="ml-1.5 text-[var(--color-text-3)] hover:text-[var(--color-fall)]">✕</button>
						</span>
					{/if}
				</div>

		<div class="main-split">
			<div class="main-left">
				{#if viewMode === 'pitch'}
					<PitchView
						starting={starting11}
						{bench}
						onPlayerClick={onPitchPlayerClick}
						selectedId={selectedPlayer?.element_id}
					/>
				{:else}
					<!-- LIST VIEW -->
					<section class="list-view">
						<div class="list-header" style="grid-template-columns: 2.5fr 48px 56px repeat({gwColumns.length}, minmax(36px,1fr)) 52px 32px;">
							<span>Player</span>
							<span class="text-center">Pos</span>
							<span class="text-right">Price</span>
							{#each gwColumns as gw}
								<span class="text-center">GW{gw}</span>
							{/each}
							<span class="text-right">TWxP</span>
							<span></span>
						</div>

						<!-- Starting XI -->
						<div class="list-body">
							{#each starting11 as player}
								<div class="list-row" style="grid-template-columns: 2.5fr 48px 56px repeat({gwColumns.length}, minmax(36px,1fr)) 52px 32px;">
									<div class="flex items-center gap-2 min-w-0">
										<img src={teamBadgeUrl(player.team_code)} alt="" class="w-4 h-4 flex-shrink-0" />
										<a href="/player/{player.element_id}" class="text-xs font-medium truncate hover:text-[var(--color-accent-light)]">
											{player.web_name}
										</a>
									</div>
									<div class="flex justify-center">
										<span class="pos-badge {positionBg(player.element_type)}">{POSITIONS[player.element_type]}</span>
									</div>
									<div class="text-right font-mono text-[10px]">{formatPrice(player.current_price)}</div>
									{#each gwColumns as gw}
										<div class="text-center font-mono text-[10px] text-[var(--color-text-1)]">
											{getPlayerGwPts(player, gw)}
										</div>
									{/each}
									<div class="text-right font-mono text-[11px] font-semibold text-[var(--color-accent-light)]">
										{calculatePlayerTWxP(player.projections).toFixed(1)}
									</div>
									<div class="flex justify-center">
										<button
											onclick={() => startTransferOut(player)}
											disabled={transferMode}
											class="list-transfer-btn"
											title="Transfer out"
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4m0 0l6-6m-6 6l6 6"/></svg>
										</button>
									</div>
								</div>
							{/each}
						</div>

						<!-- Bench separator -->
						<div class="list-bench-sep">
							<span>Bench</span>
						</div>

						<div class="list-body list-body--bench">
							{#each bench as player}
								<div class="list-row" style="grid-template-columns: 2.5fr 48px 56px repeat({gwColumns.length}, minmax(36px,1fr)) 52px 32px;">
									<div class="flex items-center gap-2 min-w-0">
										<img src={teamBadgeUrl(player.team_code)} alt="" class="w-4 h-4 flex-shrink-0" />
										<a href="/player/{player.element_id}" class="text-xs truncate hover:text-[var(--color-accent-light)]">
											{player.web_name}
										</a>
									</div>
									<div class="flex justify-center">
										<span class="pos-badge {positionBg(player.element_type)}">{POSITIONS[player.element_type]}</span>
									</div>
									<div class="text-right font-mono text-[10px]">{formatPrice(player.current_price)}</div>
									{#each gwColumns as gw}
										<div class="text-center font-mono text-[10px] text-[var(--color-text-2)]">
											{getPlayerGwPts(player, gw)}
										</div>
									{/each}
									<div class="text-right font-mono text-[11px] text-[var(--color-text-2)]">
										{calculatePlayerTWxP(player.projections).toFixed(1)}
									</div>
									<div class="flex justify-center">
										<button
											onclick={() => startTransferOut(player)}
											disabled={transferMode}
											class="list-transfer-btn"
											title="Transfer out"
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4m0 0l6-6m-6 6l6 6"/></svg>
										</button>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			</div>

			<!-- RIGHT: Player Browser (always visible) -->
			<aside class="main-right">
				<div class="panel-sticky">
					<!-- Selected player banner (compact, only when player clicked) -->
					{#if transferOutPlayer}
						<div class="panel-card" style="padding: 8px 12px;">
							<div class="flex items-center gap-2">
								<img src="https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_{transferOutPlayer.team_code}{transferOutPlayer.element_type === 1 ? '_1' : ''}-66.webp" alt="" class="w-6 h-8 flex-shrink-0" />
								<div class="flex-1 min-w-0">
									<div class="text-[11px] font-semibold truncate">{transferOutPlayer.web_name}</div>
									<div class="text-[9px] text-[var(--color-text-3)]">Sell {formatPrice(transferOutPlayer.selling_price)} · Budget {formatPrice(workingBank + transferOutPlayer.selling_price)}</div>
								</div>
								<label class="flex items-center gap-1 cursor-pointer flex-shrink-0">
									<input type="checkbox" bind:checked={budgetFilterOn} class="w-3 h-3 rounded accent-[var(--color-accent)]" />
									<span class="text-[8px] text-[var(--color-text-2)]">Affordable</span>
								</label>
								<button onclick={cancelTransfer} class="text-[var(--color-text-3)] hover:text-[var(--color-fall)] p-0.5 flex-shrink-0">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
								</button>
							</div>
						</div>
					{/if}

					<!-- Filters (always visible) -->
					<div class="panel-card" style="padding: 8px 10px;">
						<input
							type="text"
							placeholder="Search..."
							bind:value={searchQuery}
							class="panel-search-input"
							style="margin-bottom: 6px;"
						/>
						<div class="flex gap-1.5">
							<select bind:value={filterPos}
								class="flex-1 px-1.5 py-1 rounded bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-[9px] focus:outline-none focus:border-[var(--color-accent)]">
								<option value="">All Pos</option>
								<option value="1">GKP</option>
								<option value="2">DEF</option>
								<option value="3">MID</option>
								<option value="4">FWD</option>
							</select>
							<select bind:value={filterTeam}
								class="flex-1 px-1.5 py-1 rounded bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-[9px] focus:outline-none focus:border-[var(--color-accent)]">
								<option value="">All Teams</option>
								{#each availableTeams as team}
									<option value={team}>{team}</option>
								{/each}
							</select>
							<select bind:value={sortBy} onchange={() => sortAsc = false}
								class="flex-1 px-1.5 py-1 rounded bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-[9px] focus:outline-none focus:border-[var(--color-accent)]">
								<option value="twxp">xPts (8wk)</option>
								<option value="ep_next">xPts next</option>
								<option value="price">Price</option>
								<option value="form">Form</option>
								<option value="points">Total Pts</option>
								<option value="transfers_in">GW Transfers In</option>
								<option value="xg">xG</option>
							</select>
						</div>
					</div>

					<!-- Column headers (clickable to toggle sort direction) -->
					<div class="flex items-center px-3 py-1.5 text-[8px] text-[var(--color-text-3)] uppercase tracking-widest border-b border-[var(--color-surface-4)]">
						<span class="w-7"></span>
						<span class="flex-1">Player</span>
						<button onclick={() => { if (sortBy === 'price') { sortAsc = !sortAsc; } else { sortBy = 'price'; sortAsc = false; } }}
							class="w-12 text-right cursor-pointer hover:text-[var(--color-text-0)] {sortBy === 'price' ? 'text-[var(--color-accent-light)]' : ''}">
							Price {sortBy === 'price' ? (sortAsc ? '↑' : '↓') : ''}
						</button>
						<button onclick={() => { sortAsc = !sortAsc; }}
							class="w-14 text-right cursor-pointer hover:text-[var(--color-text-0)] text-[var(--color-accent-light)]">
							{#if sortBy === 'twxp'}xPts{:else if sortBy === 'ep_next'}xP Nxt{:else if sortBy === 'form'}Form{:else if sortBy === 'points'}Pts{:else if sortBy === 'transfers_in'}TI{:else if sortBy === 'xg'}xG{:else}{sortBy}{/if}
							{sortAsc ? '↑' : '↓'}
						</button>
					</div>

					<!-- Player list -->
					<div class="panel-results">
						{#if searchResults.length > 0}
							{#each searchResults as player}
								<button
									onclick={() => transferOutPlayer ? completeTransfer(player) : null}
									disabled={!transferOutPlayer}
									class="panel-result-row {!transferOutPlayer ? 'opacity-70 cursor-default' : ''}"
								>
									<img src="https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_{player.team_code}-66.webp" alt="" class="panel-result-shirt" />
									<div class="flex-1 min-w-0">
										<div class="text-[11px] font-medium truncate text-[var(--color-text-0)]">{player.web_name}</div>
										<div class="text-[9px] text-[var(--color-text-3)]">{player.team_short} · {POSITIONS[player.element_type]}</div>
									</div>
									<div class="w-12 text-right">
										<div class="font-mono text-[10px] text-[var(--color-text-1)]">{formatPrice(player.now_cost)}</div>
									</div>
									<div class="w-14 text-right">
										<div class="font-mono text-[10px] text-[var(--color-accent-light)]">
											{#if sortBy === 'price'}{formatPrice(player.now_cost)}
											{:else if sortBy === 'ep_next'}{player.ep_next || '-'}
											{:else if sortBy === 'form'}{player.form || '-'}
											{:else if sortBy === 'points'}{player.total_points || 0}
											{:else if sortBy === 'transfers_in'}{(player.transfers_in_event || 0).toLocaleString()}
											{:else if sortBy === 'xg'}{player.expected_goals || '-'}
											{:else}{calculatePlayerTWxP(player.projections || []).toFixed(1)}
											{/if}
										</div>
									</div>
								</button>
							{/each}
						{:else if allPlayersLoaded}
							<div class="panel-empty">No players match</div>
						{:else}
							<div class="panel-empty">Loading...</div>
						{/if}
					</div>
				</div>
			</aside>
		</div>

		<!-- ═══════════════════════════════════════════════════════════════
		     COMPARISON VIEW
		     ═══════════════════════════════════════════════════════════════ -->
		{#if savedOptions.length > 0}
			<section class="comparison-section">
				<div class="comparison-header">
					<h2 class="font-display font-semibold text-lg">Compare Options</h2>
					<span class="text-[var(--color-text-3)] text-[10px]">{savedOptions.length} option{savedOptions.length > 1 ? 's' : ''} saved</span>
				</div>

				<div class="comparison-grid">
					{#each comparisonData as item, i}
						<div class="comparison-card {item.verdict?.worth ? 'comparison-card--worth' : ''}">
							<div class="comparison-card-header">
								<h3 class="font-semibold text-sm">{item.name}</h3>
								{#if i > 0}
									<button onclick={() => deleteOption(i - 1)} class="text-[var(--color-text-3)] hover:text-[var(--color-fall)] text-xs p-1 leading-none">✕</button>
								{/if}
							</div>

							{#if item.transfers.length > 0}
								<div class="space-y-1 mb-3">
									{#each item.transfers as t}
										<div class="flex items-center gap-1.5 text-[10px]">
											<span class="text-[var(--color-fall)]">{t.out.web_name}</span>
											<span class="text-[var(--color-text-3)]">→</span>
											<span class="text-[var(--color-rise)]">{t.in.web_name}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-[var(--color-text-3)] text-[10px] italic mb-3">No changes (baseline)</p>
							{/if}

							<div class="comparison-stats">
								<div>
									<div class="font-mono text-sm font-semibold">{item.twxp.toFixed(1)}</div>
									<div class="text-[8px] text-[var(--color-text-3)] uppercase">TWxP</div>
								</div>
								<div>
									<div class="font-mono text-sm font-semibold {item.cost > 0 ? 'text-[var(--color-fall)]' : ''}">{item.cost > 0 ? `-${item.cost}` : '0'}</div>
									<div class="text-[8px] text-[var(--color-text-3)] uppercase">Cost</div>
								</div>
								<div>
									<div class="font-mono text-sm font-semibold {item.netGain > 0 ? 'text-[var(--color-rise)]' : item.netGain < 0 ? 'text-[var(--color-fall)]' : ''}">
										{item.netGain > 0 ? '+' : ''}{item.netGain.toFixed(1)}
									</div>
									<div class="text-[8px] text-[var(--color-text-3)] uppercase">Net</div>
								</div>
							</div>

							<div class="comparison-bar">
								<div
									class="comparison-bar-fill {i === 0 ? 'comparison-bar-fill--base' : item.verdict?.worth ? 'comparison-bar-fill--worth' : 'comparison-bar-fill--hold'}"
									style="width: {item.barWidth}%"
								></div>
							</div>

							{#if item.verdict}
								<div class="comparison-verdict">
									<span class="comparison-verdict-badge {item.verdict.worth ? 'comparison-verdict-badge--worth' : 'comparison-verdict-badge--hold'}">
										{item.verdict.worth ? '✓ Worth it' : '✗ Hold'}
									</span>
									<span class="text-[var(--color-text-2)] text-[9px] leading-tight">{item.verdict.reason}</span>
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
		<footer class="page-footer">
			<button
				onclick={() => { squadData = null; managerId = ''; savedOptions = []; currentTransfers = []; declaredTransfers = []; }}
				class="footer-back"
			>
				← Load different team
			</button>
			<span class="text-[var(--color-text-3)] text-[10px] font-mono">
				decay={DECAY} · bcv_threshold={BCV_THRESHOLD}
			</span>
		</footer>
	</div>
{/if}

<style>
	/* ═══════════════════════════════════════════════════════════
	   PAGE SHELL
	   ═══════════════════════════════════════════════════════════ */
	.page-shell {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 1440px;
		margin: 0 auto;
		padding: 0 0 2rem;
	}

	/* ═══════════════════════════════════════════════════════════
	   LOADER
	   ═══════════════════════════════════════════════════════════ */
	.loader-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 70vh;
	}

	.loader-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3rem 2.5rem;
		border-radius: 20px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		box-shadow:
			0 0 0 1px var(--color-surface-4),
			0 20px 60px -12px rgba(0, 0, 0, 0.5),
			0 0 80px -20px rgba(99, 102, 241, 0.08);
		max-width: 420px;
		width: 100%;
	}

	.loader-icon {
		margin-bottom: 1.5rem;
		opacity: 0.6;
	}

	.loader-input-group {
		display: flex;
		gap: 10px;
		width: 100%;
	}

	.loader-input {
		flex: 1;
		padding: 14px 18px;
		border-radius: 12px;
		background: var(--color-surface-0);
		border: 1px solid var(--color-surface-4);
		color: var(--color-text-0);
		font-family: var(--font-mono);
		font-size: 14px;
	}

	.loader-input::placeholder {
		color: var(--color-text-3);
	}

	.loader-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
	}

	.loader-btn {
		padding: 14px 24px;
		border-radius: 12px;
		background: var(--color-accent);
		color: white;
		font-weight: 600;
		font-size: 14px;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.loader-btn:hover {
		background: var(--color-accent-light);
	}

	.loader-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* ═══════════════════════════════════════════════════════════
	   TOP BAR
	   ═══════════════════════════════════════════════════════════ */
	.top-bar {
		border-radius: 14px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		padding: 14px 20px;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
	}

	.top-bar-inner {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	@media (min-width: 1024px) {
		.top-bar-inner {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
	}

	.top-bar-team {
		min-width: 0;
	}

	.top-bar-meta {
		font-size: 12px;
		color: var(--color-text-2);
		margin-top: 2px;
	}

	.top-bar-stats {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px;
	}

	@media (min-width: 1024px) {
		.top-bar-stats {
			gap: 24px;
		}
	}

	.stat-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.stat-value {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-0);
	}

	.stat-label {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-3);
	}

	.stat-select {
		background: var(--color-surface-3);
		border: 1px solid var(--color-surface-4);
		border-radius: 8px;
		padding: 4px 10px;
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--color-text-0);
	}

	.stat-select:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	/* ═══════════════════════════════════════════════════════════
	   DECLARE SECTION
	   ═══════════════════════════════════════════════════════════ */
	.declare-section {
		border-radius: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		overflow: hidden;
	}

	.declare-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-1);
	}

	.declare-toggle:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.declare-icon {
		color: var(--color-warning);
		font-size: 14px;
	}

	.declare-title {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
	}

	.declare-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-accent);
		color: white;
		font-size: 9px;
		font-weight: 700;
		margin-left: 6px;
	}

	.declare-chevron {
		color: var(--color-text-3);
		transition: transform 0.2s ease;
	}

	.declare-body {
		padding: 0 16px 14px;
		border-top: 1px solid var(--color-surface-4);
		padding-top: 12px;
	}

	.declare-player-list {
		max-height: 180px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.declare-player-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 8px;
		background: none;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		color: var(--color-text-1);
	}

	.declare-player-row:hover {
		background: var(--color-surface-3);
	}

	.declare-add-btn {
		padding: 8px 14px;
		border-radius: 8px;
		background: var(--color-surface-3);
		border: 1px solid var(--color-surface-4);
		color: var(--color-text-2);
		font-size: 11px;
		cursor: pointer;
	}

	.declare-add-btn:hover {
		background: var(--color-surface-4);
		color: var(--color-text-0);
	}

	/* ═══════════════════════════════════════════════════════════
	   TRANSFER STRIP
	   ═══════════════════════════════════════════════════════════ */
	.transfers-strip {
		border-radius: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		padding: 14px 16px;
	}

	.transfers-strip-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}

	.transfers-strip-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.transfer-pill {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: 8px;
		background: var(--color-surface-3);
		border: 1px solid rgba(255, 255, 255, 0.03);
	}

	.transfer-pill--lg {
		padding: 8px 12px;
	}

	.strip-btn {
		padding: 5px 12px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		border: none;
		cursor: pointer;
	}

	.strip-btn--accent {
		background: var(--color-accent);
		color: white;
	}

	.strip-btn--accent:hover {
		background: var(--color-accent-light);
	}

	.strip-btn--ghost {
		background: var(--color-surface-3);
		color: var(--color-text-2);
	}

	.strip-btn--ghost:hover {
		color: var(--color-fall);
	}

	/* ═══════════════════════════════════════════════════════════
	   MAIN SPLIT LAYOUT
	   ═══════════════════════════════════════════════════════════ */
	.main-split {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	@media (min-width: 1024px) {
		.main-split {
			flex-direction: row;
			gap: 20px;
			align-items: flex-start;
		}
	}

	.main-left {
		flex: 1;
		min-width: 0;
	}

	@media (min-width: 1024px) {
		.main-left {
			flex: 0 0 55%;
		}
	}

	.main-right {
		width: 100%;
	}

	@media (min-width: 1024px) {
		.main-right {
			flex: 0 0 43%;
			max-width: 450px;
		}
	}

	.panel-sticky {
		position: sticky;
		top: 76px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: calc(100vh - 92px);
		overflow-y: auto;
	}

	/* ═══════════════════════════════════════════════════════════
	   VIEW TOGGLE
	   ═══════════════════════════════════════════════════════════ */
	.view-toggle-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}

	.view-toggle-pills {
		display: flex;
		gap: 2px;
		background: var(--color-surface-3);
		border-radius: 8px;
		padding: 2px;
	}

	.view-pill {
		padding: 5px 14px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-2);
		background: none;
		border: none;
		cursor: pointer;
	}

	.view-pill:hover {
		color: var(--color-text-0);
	}

	.view-pill--active {
		background: var(--color-accent);
		color: white;
	}

	/* ═══════════════════════════════════════════════════════════
	   LIST VIEW
	   ═══════════════════════════════════════════════════════════ */
	.list-view {
		border-radius: 14px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		overflow: hidden;
	}

	.list-header {
		display: grid;
		gap: 6px;
		padding: 10px 14px;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-3);
		border-bottom: 1px solid var(--color-surface-4);
		align-items: center;
	}

	.list-body {
		padding: 4px 6px;
	}

	.list-body--bench {
		opacity: 0.6;
	}

	.list-row {
		display: grid;
		gap: 6px;
		padding: 7px 8px;
		border-radius: 8px;
		align-items: center;
	}

	.list-row:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.list-bench-sep {
		margin: 4px 14px;
		padding: 4px 0;
		border-top: 1px dashed var(--color-surface-4);
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--color-text-3);
		font-weight: 600;
	}

	.list-transfer-btn {
		opacity: 0;
		padding: 4px;
		border-radius: 6px;
		border: none;
		background: none;
		color: var(--color-text-3);
		cursor: pointer;
	}

	.list-row:hover .list-transfer-btn {
		opacity: 1;
	}

	.list-transfer-btn:hover {
		background: var(--color-fall-bg);
		color: var(--color-fall);
	}

	.pos-badge {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
	}

	.pos-badge--sm {
		font-size: 8px;
		padding: 1px 4px;
	}

	/* ═══════════════════════════════════════════════════════════
	   RIGHT PANEL
	   ═══════════════════════════════════════════════════════════ */
	.panel-card {
		padding: 14px;
		border-radius: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
	}

	.panel-selected-player {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.panel-player-shirt {
		width: 36px;
		height: 44px;
		object-fit: contain;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
	}

	.panel-player-info {
		flex: 1;
		min-width: 0;
	}

	.panel-player-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		color: var(--color-text-2);
		margin-top: 2px;
	}

	.panel-close-btn {
		padding: 4px;
		border-radius: 6px;
		border: none;
		background: none;
		color: var(--color-text-3);
		cursor: pointer;
	}

	.panel-close-btn:hover {
		color: var(--color-fall);
		background: var(--color-fall-bg);
	}

	.panel-player-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px solid var(--color-surface-4);
	}

	.panel-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
	}

	.panel-stat-value {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-0);
	}

	.panel-stat-label {
		font-size: 8px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-3);
	}

	.panel-search-input {
		width: 100%;
		padding: 10px 14px;
		border-radius: 10px;
		background: var(--color-surface-0);
		border: 1px solid var(--color-surface-4);
		color: var(--color-text-0);
		font-size: 13px;
	}

	.panel-search-input::placeholder {
		color: var(--color-text-3);
	}

	.panel-search-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.panel-results {
		border-radius: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		overflow: hidden;
		max-height: calc(100vh - 420px);
		overflow-y: auto;
	}

	.panel-result-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
		cursor: pointer;
		color: inherit;
	}

	.panel-result-row:last-child {
		border-bottom: none;
	}

	.panel-result-row:hover {
		background: var(--color-surface-3);
	}

	.panel-result-shirt {
		width: 24px;
		height: 30px;
		object-fit: contain;
		flex-shrink: 0;
	}

	.panel-empty {
		padding: 24px 16px;
		text-align: center;
		font-size: 11px;
		color: var(--color-text-3);
	}

	/* ─── Panel Summary (idle mode) ─── */
	.panel-summary-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.panel-summary-item {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.panel-summary-value {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-0);
	}

	.panel-summary-label {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-3);
	}

	.panel-pos-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}

	.panel-pos-row:last-child {
		margin-bottom: 0;
	}

	.panel-pos-label {
		font-size: 10px;
		font-weight: 700;
		width: 28px;
	}

	.panel-pos-bar {
		flex: 1;
		height: 4px;
		border-radius: 2px;
		background: var(--color-surface-4);
		overflow: hidden;
	}

	.panel-pos-bar-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 0.5s ease;
		opacity: 0.7;
	}

	.panel-pos-value {
		font-size: 10px;
		color: var(--color-text-2);
		width: 32px;
		text-align: right;
	}

	.panel-hint {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 14px;
		border-radius: 10px;
		background: var(--color-surface-3);
		border: 1px solid var(--color-surface-4);
		font-size: 11px;
		color: var(--color-text-2);
	}

	/* ═══════════════════════════════════════════════════════════
	   COMPARISON
	   ═══════════════════════════════════════════════════════════ */
	.comparison-section {
		border-radius: 14px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		padding: 20px;
	}

	.comparison-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.comparison-grid {
		display: grid;
		gap: 14px;
		grid-template-columns: 1fr;
	}

	@media (min-width: 768px) {
		.comparison-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (min-width: 1280px) {
		.comparison-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.comparison-card {
		padding: 16px;
		border-radius: 12px;
		background: var(--color-surface-3);
		border: 1px solid rgba(255, 255, 255, 0.03);
	}

	.comparison-card--worth {
		border-color: rgba(16, 185, 129, 0.2);
		box-shadow: 0 0 20px -8px rgba(16, 185, 129, 0.1);
	}

	.comparison-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.comparison-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		text-align: center;
		padding: 10px 0;
		border-top: 1px solid var(--color-surface-4);
		border-bottom: 1px solid var(--color-surface-4);
		margin-bottom: 10px;
	}

	.comparison-bar {
		height: 5px;
		border-radius: 3px;
		background: var(--color-surface-4);
		overflow: hidden;
		margin-bottom: 10px;
	}

	.comparison-bar-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.6s ease;
	}

	.comparison-bar-fill--base {
		background: var(--color-surface-4);
	}

	.comparison-bar-fill--worth {
		background: var(--color-rise);
	}

	.comparison-bar-fill--hold {
		background: var(--color-fall);
		opacity: 0.6;
	}

	.comparison-verdict {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.comparison-verdict-badge {
		font-size: 10px;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 20px;
		white-space: nowrap;
	}

	.comparison-verdict-badge--worth {
		background: var(--color-rise-bg);
		color: var(--color-rise);
	}

	.comparison-verdict-badge--hold {
		background: var(--color-fall-bg);
		color: var(--color-fall);
	}

	/* ═══════════════════════════════════════════════════════════
	   FOOTER
	   ═══════════════════════════════════════════════════════════ */
	.page-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: 8px;
	}

	.footer-back {
		background: none;
		border: none;
		color: var(--color-text-2);
		font-size: 12px;
		cursor: pointer;
	}

	.footer-back:hover {
		color: var(--color-text-0);
	}
</style>
