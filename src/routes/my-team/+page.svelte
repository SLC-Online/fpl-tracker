<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import {
		calculateSquadTWxP, calculatePlayerTWxP, applyTransfers,
		transferPointsCost, isTransferWorthIt,
		DECAY, BCV_THRESHOLD, type SquadPlayer, type TransferOption
	} from '$lib/transfer-engine';

	let managerId = $state('');
	let loading = $state(false);
	let errorMsg = $state('');
	let squadData: any = $state(null);

	// Transfer planner state
	let options: TransferOption[] = $state([]);
	let activeOptionIdx = $state(-1);  // -1 = viewing base squad
	let showComparison = $state(false);
	let freeTransfers = $state(1);

	// Transfer-in search
	let transferMode = $state(false);
	let transferOutPlayer: SquadPlayer | null = $state(null);
	let searchQuery = $state('');
	let searchResults: any[] = $state([]);
	let searching = $state(false);

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
			options = [];
			activeOptionIdx = -1;
		} catch (e: any) {
			errorMsg = e.message;
		} finally {
			loading = false;
		}
	}

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	// Base squad as SquadPlayer[]
	let baseSquad = $derived<SquadPlayer[]>(
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

	let baseBank = $derived(squadData?.bank || 0);
	let baseTWxP = $derived(calculateSquadTWxP(baseSquad));

	// Currently displayed squad (base or option)
	let displaySquad = $derived.by(() => {
		if (activeOptionIdx >= 0 && options[activeOptionIdx]) {
			return options[activeOptionIdx].resultSquad;
		}
		return baseSquad;
	});

	let displayBank = $derived.by(() => {
		if (activeOptionIdx >= 0 && options[activeOptionIdx]) {
			return options[activeOptionIdx].bank;
		}
		return baseBank;
	});

	let displayTWxP = $derived.by(() => {
		if (activeOptionIdx >= 0 && options[activeOptionIdx]) {
			return options[activeOptionIdx].twxp;
		}
		return baseTWxP;
	});

	let starting11 = $derived(displaySquad.slice(0, 11));
	let bench = $derived(displaySquad.slice(11));

	// Start a transfer: click a player to sell
	function startTransferOut(player: SquadPlayer) {
		transferOutPlayer = player;
		transferMode = true;
		searchQuery = '';
		searchResults = [];
	}

	// Search for replacement players
	let searchTimeout: any;
	function onSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => searchPlayers(), 300);
	}

	async function searchPlayers() {
		if (!transferOutPlayer || searchQuery.length < 2) {
			searchResults = [];
			return;
		}
		searching = true;

		const maxBudget = displayBank + transferOutPlayer.selling_price;
		const excludeIds = displaySquad.map(p => p.element_id).join(',');

		try {
			const resp = await fetch(
				`/api/players?q=${encodeURIComponent(searchQuery)}&pos=${transferOutPlayer.element_type}&max_price=${maxBudget}&exclude=${excludeIds}`
			);
			if (resp.ok) {
				searchResults = await resp.json();
			}
		} finally {
			searching = false;
		}
	}

	// Complete a transfer: select the incoming player
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

		// If we're editing an existing option, add to it
		if (activeOptionIdx >= 0) {
			const opt = options[activeOptionIdx];
			opt.transfers.push({ out: transferOutPlayer, in: inSquadPlayer });
			const { squad, bank } = applyTransfers(baseSquad, baseBank, opt.transfers);
			opt.resultSquad = squad;
			opt.bank = bank;
			opt.twxp = calculateSquadTWxP(squad);
			opt.twxpDelta = opt.twxp - baseTWxP;
			opt.cost = transferPointsCost(opt.transfers.length, freeTransfers);
			opt.netGain = opt.twxpDelta - opt.cost;
			options = [...options];
		} else {
			// Create new option
			const transfers = [{ out: transferOutPlayer, in: inSquadPlayer }];
			const { squad, bank } = applyTransfers(baseSquad, baseBank, transfers);
			const twxp = calculateSquadTWxP(squad);
			const newOption: TransferOption = {
				id: crypto.randomUUID(),
				name: `Option ${options.length + 1}`,
				transfers,
				resultSquad: squad,
				bank,
				twxp,
				twxpDelta: twxp - baseTWxP,
				cost: transferPointsCost(1, freeTransfers),
				netGain: (twxp - baseTWxP) - transferPointsCost(1, freeTransfers),
			};
			options = [...options, newOption];
			activeOptionIdx = options.length - 1;
		}

		// Reset transfer mode
		transferMode = false;
		transferOutPlayer = null;
		searchQuery = '';
		searchResults = [];
	}

	function cancelTransfer() {
		transferMode = false;
		transferOutPlayer = null;
		searchQuery = '';
		searchResults = [];
	}

	function viewBaseSquad() {
		activeOptionIdx = -1;
	}

	function viewOption(idx: number) {
		activeOptionIdx = idx;
	}

	function deleteOption(idx: number) {
		options = options.filter((_, i) => i !== idx);
		if (activeOptionIdx === idx) activeOptionIdx = -1;
		else if (activeOptionIdx > idx) activeOptionIdx--;
	}

	function toggleComparison() {
		showComparison = !showComparison;
	}

	// Comparison: calculate relative bars (all options + base add up to visual comparison)
	let comparisonData = $derived.by(() => {
		const all = [
			{ name: 'No transfer', twxp: baseTWxP, cost: 0, netGain: 0, transfers: [] as any[] },
			...options.map(o => ({ name: o.name, twxp: o.twxp, cost: o.cost, netGain: o.netGain, transfers: o.transfers }))
		];
		const maxTwxp = Math.max(...all.map(a => a.twxp));
		const minTwxp = Math.min(...all.map(a => a.twxp));
		const range = maxTwxp - minTwxp || 1;

		return all.map(a => ({
			...a,
			barWidth: 30 + ((a.twxp - minTwxp) / range) * 70,  // 30-100% width
			verdict: a.transfers.length > 0 ? isTransferWorthIt(a as any, freeTransfers) : null,
		}));
	});
</script>

<svelte:head>
	<title>My Team — FPL Tracker</title>
</svelte:head>

<div class="space-y-8">
	<header>
		<h1 class="font-display font-bold text-3xl tracking-tight">My Team</h1>
	</header>

	{#if !squadData}
		<!-- Squad Loader -->
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-8 max-w-lg">
			<h2 class="font-display font-semibold text-lg mb-4">Load your squad</h2>
			<p class="text-[var(--color-text-2)] text-sm mb-5">
				Enter your FPL Manager ID — the number in your FPL URL when you click "Points".
			</p>
			<div class="flex gap-3">
				<input type="text" placeholder="e.g. 1234567" bind:value={managerId}
					onkeydown={(e) => { if (e.key === 'Enter') loadSquad(); }}
					class="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)]" />
				<button onclick={loadSquad} disabled={loading || !managerId.trim()}
					class="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] text-white font-medium hover:bg-[var(--color-accent-light)] disabled:opacity-50">
					{loading ? 'Loading...' : 'Load'}
				</button>
			</div>
			{#if errorMsg}<p class="text-[var(--color-fall)] text-sm mt-3">{errorMsg}</p>{/if}
		</section>
	{:else}
		<!-- Manager Header -->
		<section class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h2 class="font-display font-semibold text-xl">{squadData.manager.team_name}</h2>
				<p class="text-[var(--color-text-2)] text-sm">
					{squadData.manager.name} · GW{squadData.gameweek} · {squadData.total_points} pts
				</p>
			</div>
			<div class="flex gap-5">
				<div class="text-right">
					<div class="font-mono text-lg font-semibold">{formatPrice(displayBank)}</div>
					<div class="text-[var(--color-text-2)] text-xs">Bank</div>
				</div>
				<div class="text-right">
					<div class="font-mono text-lg font-semibold text-[var(--color-accent)]">{displayTWxP.toFixed(1)}</div>
					<div class="text-[var(--color-text-2)] text-xs">TWxP (8wk)</div>
				</div>
				<div class="text-right">
					<label class="text-[var(--color-text-2)] text-xs block mb-0.5">Free transfers</label>
					<select bind:value={freeTransfers} class="bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] rounded-lg px-2 py-1 text-sm font-mono">
						<option value={1}>1</option>
						<option value={2}>2</option>
						<option value={3}>3</option>
						<option value={5}>5 (WC)</option>
					</select>
				</div>
			</div>
		</section>

		<!-- Option Tabs -->
		<div class="flex flex-wrap gap-2">
			<button onclick={viewBaseSquad}
				class="px-4 py-2 rounded-lg text-sm font-medium transition-all
					{activeOptionIdx === -1 ? 'bg-[var(--color-surface-3)] text-[var(--color-text-0)]' : 'text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]'}">
				Current
			</button>
			{#each options as opt, i}
				<div class="flex items-center gap-1">
					<button onclick={() => viewOption(i)}
						class="px-4 py-2 rounded-lg text-sm font-medium transition-all
							{activeOptionIdx === i ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-1)] hover:bg-[var(--color-surface-3)]'}">
						{opt.name}
						<span class="ml-1 opacity-70">({opt.transfers.length})</span>
					</button>
					<button onclick={() => deleteOption(i)} class="text-[var(--color-text-3)] hover:text-[var(--color-fall)] text-xs px-1">✕</button>
				</div>
			{/each}
			{#if options.length > 0}
				<button onclick={toggleComparison}
					class="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-surface-2)] text-[var(--color-accent)] hover:bg-[var(--color-accent-glow)] border border-[var(--color-accent)]/30">
					Compare
				</button>
			{/if}
		</div>

		<!-- Comparison View -->
		{#if showComparison && options.length > 0}
			<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-6 space-y-4">
				<h3 class="font-display font-semibold text-lg">Comparison</h3>
				{#each comparisonData as item, i}
					<div class="space-y-1.5">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{item.name}</span>
							<div class="flex items-center gap-3">
								<span class="font-mono text-sm">{item.twxp.toFixed(1)} TWxP</span>
								{#if item.cost > 0}
									<span class="text-[var(--color-fall)] text-xs font-mono">-{item.cost}pts</span>
								{/if}
								{#if item.verdict}
									<span class="text-xs px-2 py-0.5 rounded-full
										{item.verdict.worth ? 'bg-[var(--color-rise-bg)] text-[var(--color-rise)]' : 'bg-[var(--color-fall-bg)] text-[var(--color-fall)]'}">
										{item.verdict.worth ? '✓ Worth it' : '✗ Hold'}
									</span>
								{/if}
							</div>
						</div>
						<div class="h-8 rounded-lg overflow-hidden bg-[var(--color-surface-3)]">
							<div class="h-full rounded-lg transition-all duration-500
								{i === 0 ? 'bg-[var(--color-surface-4)]' : item.verdict?.worth ? 'bg-[var(--color-rise)]' : 'bg-[var(--color-accent)]'}"
								style="width: {item.barWidth}%">
							</div>
						</div>
						{#if item.verdict}
							<p class="text-[var(--color-text-2)] text-xs">{item.verdict.reason}</p>
						{/if}
					</div>
				{/each}
			</section>
		{/if}

		<!-- Transfer Mode: Search for incoming player -->
		{#if transferMode && transferOutPlayer}
			<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow p-6">
				<div class="flex items-center justify-between mb-4">
					<h3 class="font-display font-semibold text-base">
						Replace {transferOutPlayer.web_name} ({formatPrice(transferOutPlayer.selling_price)})
					</h3>
					<button onclick={cancelTransfer} class="text-[var(--color-text-2)] text-sm hover:text-[var(--color-fall)]">Cancel</button>
				</div>
				<p class="text-[var(--color-text-2)] text-sm mb-3">
					Budget: {formatPrice(displayBank + transferOutPlayer.selling_price)} · Position: {POSITIONS[transferOutPlayer.element_type]}
				</p>
				<input type="text" placeholder="Search player..." bind:value={searchQuery}
					oninput={onSearchInput}
					class="w-full px-4 py-2.5 rounded-xl bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] mb-3" />

				{#if searchResults.length > 0}
					<div class="max-h-64 overflow-y-auto space-y-1">
						{#each searchResults as player}
							<button onclick={() => completeTransfer(player)}
								class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-3)] transition-colors text-left">
								<img src={teamBadgeUrl(player.team_code)} alt="" class="w-5 h-5" />
								<span class="font-medium text-sm flex-1">{player.web_name}</span>
								<span class="text-[var(--color-text-2)] text-xs">{player.team_short}</span>
								<span class="font-mono text-sm">{formatPrice(player.now_cost)}</span>
								<span class="font-mono text-xs text-[var(--color-accent)]">
									{calculatePlayerTWxP(player.projections).toFixed(1)}
								</span>
							</button>
						{/each}
					</div>
				{:else if searchQuery.length >= 2 && !searching}
					<p class="text-[var(--color-text-2)] text-sm">No players found within budget.</p>
				{/if}
			</section>
		{/if}

		<!-- Squad Display -->
		<section class="rounded-2xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
			<div class="px-6 pt-5 pb-3 flex items-center justify-between">
				<h3 class="font-display font-semibold text-base">
					{activeOptionIdx >= 0 ? options[activeOptionIdx].name : 'Starting XI'}
				</h3>
				{#if !transferMode}
					<p class="text-[var(--color-text-2)] text-xs">Click a player to transfer out</p>
				{/if}
			</div>
			<div class="px-3 pb-3">
				{#each starting11 as player}
					<button onclick={() => !transferMode && startTransferOut(player)}
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-3)]/50 transition-colors text-left
							{transferMode ? 'opacity-50 cursor-default' : 'cursor-pointer'}">
						<img src={teamBadgeUrl(player.team_code)} alt="" class="w-6 h-6" />
						<div class="flex-1 min-w-0">
							<span class="font-medium text-sm">{player.web_name}</span>
							{#if player.bcv != null}
								<span class="text-[var(--color-text-3)] text-xs ml-1">{player.bcv.toFixed(2)}</span>
							{/if}
							<span class="text-[var(--color-text-3)] text-xs ml-2">{POSITIONS[player.element_type]}</span>
						</div>
						<span class="font-mono text-xs text-[var(--color-text-2)]">{formatPrice(player.current_price)}</span>
						<span class="font-mono text-xs text-[var(--color-text-2)] w-14 text-right" title="Selling price">
							({formatPrice(player.selling_price)})
						</span>
						<span class="font-mono text-sm font-semibold text-[var(--color-accent-light)] w-12 text-right">
							{calculatePlayerTWxP(player.projections).toFixed(1)}
						</span>
					</button>
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
					<button onclick={() => !transferMode && startTransferOut(player)}
						class="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[var(--color-surface-3)]/30 transition-colors opacity-70 text-left
							{transferMode ? 'cursor-default' : 'cursor-pointer'}">
						<img src={teamBadgeUrl(player.team_code)} alt="" class="w-5 h-5" />
						<div class="flex-1 min-w-0">
							<span class="text-sm">{player.web_name}</span>
							<span class="text-[var(--color-text-3)] text-xs ml-2">{POSITIONS[player.element_type]}</span>
						</div>
						<span class="font-mono text-xs text-[var(--color-text-2)]">{formatPrice(player.current_price)}</span>
						<span class="font-mono text-xs text-[var(--color-text-2)] w-14 text-right">({formatPrice(player.selling_price)})</span>
						<span class="font-mono text-sm text-[var(--color-text-2)] w-12 text-right">
							{calculatePlayerTWxP(player.projections).toFixed(1)}
						</span>
					</button>
				{/each}
			</div>
		</section>

		<!-- Load different team -->
		<button onclick={() => { squadData = null; managerId = ''; options = []; }}
			class="text-[var(--color-text-2)] text-sm hover:text-[var(--color-text-0)]">
			← Load different team
		</button>
	{/if}
</div>
