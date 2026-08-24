<script lang="ts">
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import PlayerPhoto from '$lib/components/PlayerPhoto.svelte';

	let { data } = $props();

	let search = $state('');
	let selectedTeam = $state('');
	let selectedPos = $state('');
	let sortCol = $state('twxp');
	let sortAsc = $state(false);
	let expandedId = $state<number | null>(null);

	const DECAY = 0.85;

	// csvGwOffset: how many GW columns to skip (e.g. if GW1 has kicked off, skip gw1)
	$effect(() => {
		// This just ensures we react to data changes
	});

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function getPlayer(row: any) {
		const p = Array.isArray(row.players) ? row.players[0] : row.players;
		const t = p?.teams ? (Array.isArray(p.teams) ? p.teams[0] : p.teams) : {};
		return { ...p, teams: t };
	}

	function getTimeWeightedXP(elementId: number): number | null {
		const csv = data.csvLookup?.[elementId];
		if (!csv) return null;
		const allGws = [csv.gw1, csv.gw2, csv.gw3, csv.gw4, csv.gw5, csv.gw6, csv.gw7, csv.gw8];
		// Skip gameweeks that have already kicked off
		const gws = allGws.slice(data.csvGwOffset || 0);
		let total = 0;
		let hasData = false;
		for (let i = 0; i < gws.length; i++) {
			if (gws[i] !== null && gws[i] !== undefined) {
				total += gws[i] * Math.pow(DECAY, i);
				hasData = true;
			}
		}
		return hasData ? total : null;
	}

	function getRemainingGws(elementId: number): { gw: number; pts: number; weight: number }[] {
		const csv = data.csvLookup?.[elementId];
		if (!csv) return [];
		const allGws = [csv.gw1, csv.gw2, csv.gw3, csv.gw4, csv.gw5, csv.gw6, csv.gw7, csv.gw8];
		const offset = data.csvGwOffset || 0;
		const csvGameweek = csv.gameweek || 1;
		const result: { gw: number; pts: number; weight: number }[] = [];
		for (let i = offset; i < allGws.length; i++) {
			if (allGws[i] !== null && allGws[i] !== undefined) {
				result.push({
					gw: csvGameweek + i,
					pts: allGws[i],
					weight: Math.pow(DECAY, i - offset)
				});
			}
		}
		return result;
	}

	function getSortValue(row: any): number {
		if (sortCol === 'twxp') return getTimeWeightedXP(row.element_id) ?? -999;
		if (sortCol === 'total_points') return row.total_points ?? 0;
		if (sortCol === 'now_cost') return row.now_cost ?? 0;
		if (sortCol === 'form') return parseFloat(row.form || '0');
		if (sortCol === 'selected_by_percent') return row.selected_by_percent ?? 0;
		if (sortCol === 'price_change_percent') return parseFloat(row.price_change_percent || '0');
		if (sortCol === 'transfers_in_event') return row.transfers_in_event ?? 0;
		if (sortCol === 'ep_next') return parseFloat(row.ep_next || '0');
		return 0;
	}

	let filteredPlayers = $derived.by(() => {
		let result = data.players;

		// Search filter
		if (search.length > 0) {
			const q = search.toLowerCase();
			result = result.filter((row: any) => {
				const p = getPlayer(row);
				return p.web_name?.toLowerCase().includes(q) ||
					p.first_name?.toLowerCase().includes(q) ||
					p.second_name?.toLowerCase().includes(q);
			});
		}

		// Team filter
		if (selectedTeam) {
			result = result.filter((row: any) => {
				const p = getPlayer(row);
				return p.teams?.short_name === selectedTeam;
			});
		}

		// Position filter
		if (selectedPos) {
			const posInt = parseInt(selectedPos);
			result = result.filter((row: any) => {
				const p = getPlayer(row);
				return p.element_type === posInt;
			});
		}

		// Sort
		result = [...result].sort((a: any, b: any) => {
			const av = getSortValue(a);
			const bv = getSortValue(b);
			return sortAsc ? av - bv : bv - av;
		});

		return result.slice(0, 100);
	});

	function toggleSort(col: string) {
		if (sortCol === col) {
			sortAsc = !sortAsc;
		} else {
			sortCol = col;
			sortAsc = false;
		}
	}

	function toggleExpand(elementId: number) {
		expandedId = expandedId === elementId ? null : elementId;
	}

	const columns = [
		{ id: 'now_cost', label: 'Price' },
		{ id: 'total_points', label: 'Pts' },
		{ id: 'form', label: 'Form' },
		{ id: 'selected_by_percent', label: 'Own%' },
		{ id: 'price_change_percent', label: 'Pressure' },
		{ id: 'twxp', label: 'TWxP' },
	];
</script>

<svelte:head>
	<title>Players — FPL Tracker</title>
</svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="font-display font-bold text-3xl tracking-tight">Players</h1>
	</header>

	<!-- Filters -->
	<div class="flex flex-wrap gap-3">
		<input
			type="text"
			placeholder="Search..."
			bind:value={search}
			class="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] placeholder:text-[var(--color-text-3)] text-sm w-52 focus:outline-none focus:border-[var(--color-accent)]"
		/>

		<select bind:value={selectedTeam}
			class="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-sm focus:outline-none focus:border-[var(--color-accent)]">
			<option value="">All teams</option>
			{#each data.teams as team}
				<option value={team.short_name}>{team.name}</option>
			{/each}
		</select>

		<select bind:value={selectedPos}
			class="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-sm focus:outline-none focus:border-[var(--color-accent)]">
			<option value="">All positions</option>
			<option value="1">Goalkeeper</option>
			<option value="2">Defender</option>
			<option value="3">Midfielder</option>
			<option value="4">Forward</option>
		</select>
	</div>

	<!-- Player table -->
	<div class="rounded-xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
		<table class="w-full">
			<thead>
				<tr class="text-[var(--color-text-2)] text-xs uppercase tracking-wider border-b border-[var(--color-surface-4)]">
					<th class="text-left px-5 py-4">Player</th>
					{#each columns as col}
						<th class="text-right px-3 py-4 cursor-pointer select-none hover:text-[var(--color-text-0)] transition-colors
							{col.id === 'selected_by_percent' || col.id === 'price_change_percent' ? 'hidden md:table-cell' : ''}
							{col.id === 'form' ? 'hidden sm:table-cell' : ''}"
							onclick={() => toggleSort(col.id)}>
							<div class="flex items-center justify-end gap-1">
								<span>{col.label}</span>
								{#if sortCol === col.id}
									<span class="text-[var(--color-accent)]">{sortAsc ? '↑' : '↓'}</span>
								{/if}
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each filteredPlayers as row (row.element_id)}
					{@const player = getPlayer(row)}
					{@const twxp = getTimeWeightedXP(row.element_id)}
					{@const isExpanded = expandedId === row.element_id}
					<!-- Main row -->
					<tr class="border-b border-[var(--color-surface-4)]/50 hover:bg-[var(--color-surface-3)]/50 cursor-pointer transition-colors"
						onclick={() => toggleExpand(row.element_id)}>
						<td class="px-5 py-3">
							<div class="flex items-center gap-3">
								<img src={teamBadgeUrl(player.teams.code)} alt="" class="w-7 h-7" />
								<div>
									<a href="/player/{row.element_id}" class="font-medium text-sm hover:text-[var(--color-accent-light)]"
										onclick={(e) => e.stopPropagation()}>{player.web_name}</a>
									<div class="flex items-center gap-1.5 mt-0.5">
										<span class="text-[var(--color-text-3)] text-xs">{player.teams.short_name}</span>
										<span class="text-[var(--color-text-3)] text-xs">·</span>
										<span class="text-[var(--color-text-3)] text-xs">{POSITIONS[player.element_type]}</span>
									</div>
								</div>
							</div>
						</td>
						<td class="text-right px-3 py-3 font-mono text-sm">{formatPrice(row.now_cost)}</td>
						<td class="text-right px-3 py-3 font-mono text-sm font-semibold">{row.total_points}</td>
						<td class="text-right px-3 py-3 font-mono text-sm text-[var(--color-text-1)] hidden sm:table-cell">{row.form || '-'}</td>
						<td class="text-right px-3 py-3 font-mono text-sm text-[var(--color-text-2)] hidden md:table-cell">{row.selected_by_percent}%</td>
						<td class="text-right px-3 py-3 font-mono text-sm hidden md:table-cell
							{parseFloat(row.price_change_percent || '0') > 3 ? 'text-[var(--color-rise)]' : parseFloat(row.price_change_percent || '0') < -3 ? 'text-[var(--color-fall)]' : 'text-[var(--color-text-2)]'}">
							{row.price_change_percent ? parseFloat(row.price_change_percent).toFixed(1) + '%' : '-'}
						</td>
						<td class="text-right px-3 py-3 font-mono text-sm font-semibold text-[var(--color-accent-light)]">
							{twxp !== null ? twxp.toFixed(1) : '-'}
						</td>
					</tr>

					<!-- Expanded detail row -->
					{#if isExpanded}
						<tr class="bg-[var(--color-surface-3)]/30">
							<td colspan="7" class="px-5 py-4">
								<div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
									{#if data.csvLookup?.[row.element_id]}
										{@const remainingGws = getRemainingGws(row.element_id)}
										{@const gwPts = remainingGws.map(g => g.pts)}
										{@const gwMax = Math.max(...gwPts, 1)}
										{@const gwMin = Math.min(...gwPts, 0)}
										{#each remainingGws as gw, i}
											{@const range = gwMax - gwMin || 1}
											{@const ratio = (gw.pts - gwMin) / range}
											<div class="text-center p-2 rounded-lg"
												style="background: {ratio > 0.7 ? `rgba(22, 163, 74, ${0.15 + ratio * 0.25})` : ratio > 0.3 ? `rgba(202, 138, 4, ${0.08 + ratio * 0.1})` : `rgba(255, 255, 255, 0.03)`}">
												<div class="text-[var(--color-text-2)] text-[10px] mb-0.5">GW{gw.gw}</div>
												<div class="font-mono font-semibold text-sm">{gw.pts.toFixed(1)}</div>
											</div>
										{/each}
										{#if remainingGws.length === 0}
											<div class="col-span-full text-[var(--color-text-2)] text-sm">
												All projected gameweeks have passed. Awaiting new data.
											</div>
										{/if}
									{:else}
										<div class="col-span-full text-[var(--color-text-2)] text-sm">
											No expected points data available for this player.
										</div>
									{/if}
								</div>

								<!-- Additional stats row -->
								<div class="flex flex-wrap gap-6 mt-4 pt-3 border-t border-[var(--color-surface-4)]">
									<div>
										<span class="text-[var(--color-text-2)] text-xs">Minutes</span>
										<span class="font-mono text-sm ml-1.5">{row.minutes}</span>
									</div>
									<div>
										<span class="text-[var(--color-text-2)] text-xs">Goals</span>
										<span class="font-mono text-sm ml-1.5">{row.goals_scored}</span>
									</div>
									<div>
										<span class="text-[var(--color-text-2)] text-xs">Assists</span>
										<span class="font-mono text-sm ml-1.5">{row.assists}</span>
									</div>
									<div>
										<span class="text-[var(--color-text-2)] text-xs">CS</span>
										<span class="font-mono text-sm ml-1.5">{row.clean_sheets}</span>
									</div>
									<div>
										<span class="text-[var(--color-text-2)] text-xs">xG</span>
										<span class="font-mono text-sm ml-1.5">{row.expected_goals || '-'}</span>
									</div>
									<div>
										<span class="text-[var(--color-text-2)] text-xs">xA</span>
										<span class="font-mono text-sm ml-1.5">{row.expected_assists || '-'}</span>
									</div>
									<div>
										<span class="text-[var(--color-text-2)] text-xs">Transfers in</span>
										<span class="font-mono text-sm ml-1.5">{row.transfers_in_event?.toLocaleString()}</span>
									</div>
									<div>
										<span class="text-[var(--color-text-2)] text-xs">Transfers out</span>
										<span class="font-mono text-sm ml-1.5">{row.transfers_out_event?.toLocaleString()}</span>
									</div>
									{#if data.csvLookup?.[row.element_id]?.ppg_longer_term}
										<div>
											<span class="text-[var(--color-text-2)] text-xs">PPG (long-term)</span>
											<span class="font-mono text-sm ml-1.5">{data.csvLookup[row.element_id].ppg_longer_term.toFixed(2)}</span>
										</div>
									{/if}
								</div>

								<div class="mt-3">
									<a href="/player/{row.element_id}" class="text-[var(--color-accent)] text-sm hover:text-[var(--color-accent-light)]">
										View full profile →
									</a>
								</div>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>

		{#if filteredPlayers.length === 0}
			<div class="p-10 text-center text-[var(--color-text-2)]">
				No players found.
			</div>
		{/if}
	</div>

	<p class="text-[var(--color-text-3)] text-xs">
		TWxP = Time-Weighted Expected Points (decay: {DECAY}× per GW). Showing top 100 results.
	</p>
</div>
