<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import PlayerPhoto from '$lib/components/PlayerPhoto.svelte';

	let { data } = $props();

	let search = $state(data.filters.search);
	let selectedTeam = $state(data.filters.team);
	let selectedPos = $state(data.filters.position);
	let sort = $state(data.filters.sort);

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	function applyFilters() {
		const params = new URLSearchParams();
		if (search) params.set('q', search);
		if (selectedTeam) params.set('team', selectedTeam);
		if (selectedPos) params.set('pos', selectedPos);
		if (sort) params.set('sort', sort);
		goto(`/players?${params.toString()}`, { replaceState: true });
	}

	function getPlayer(row: any) {
		const p = Array.isArray(row.players) ? row.players[0] : row.players;
		const t = p?.teams ? (Array.isArray(p.teams) ? p.teams[0] : p.teams) : {};
		return { ...p, teams: t };
	}
</script>

<svelte:head>
	<title>Players — FPL Tracker</title>
</svelte:head>

<div class="space-y-8">
	<header>
		<h1 class="font-display font-bold text-3xl tracking-tight">Players</h1>
	</header>

	<!-- Filters -->
	<div class="flex flex-wrap gap-3">
		<input
			type="text"
			placeholder="Search player..."
			bind:value={search}
			onkeydown={(e) => { if (e.key === 'Enter') applyFilters(); }}
			class="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] placeholder:text-[var(--color-text-3)] text-sm w-56 focus:outline-none focus:border-[var(--color-accent)]"
		/>

		<select bind:value={selectedTeam} onchange={applyFilters}
			class="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-sm focus:outline-none focus:border-[var(--color-accent)]">
			<option value="">All teams</option>
			{#each data.teams as team}
				<option value={team.short_name}>{team.name}</option>
			{/each}
		</select>

		<select bind:value={selectedPos} onchange={applyFilters}
			class="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-sm focus:outline-none focus:border-[var(--color-accent)]">
			<option value="">All positions</option>
			<option value="1">Goalkeeper</option>
			<option value="2">Defender</option>
			<option value="3">Midfielder</option>
			<option value="4">Forward</option>
		</select>

		<select bind:value={sort} onchange={applyFilters}
			class="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] text-[var(--color-text-1)] text-sm focus:outline-none focus:border-[var(--color-accent)]">
			<option value="total_points">Points</option>
			<option value="now_cost">Price</option>
			<option value="form">Form</option>
			<option value="selected_by_percent">Ownership</option>
			<option value="price_change_percent">Price pressure</option>
			<option value="transfers_in_event">Transfers in</option>
			<option value="ep_next">xPts next</option>
		</select>

		<button onclick={applyFilters}
			class="px-4 py-2 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent-light)]">
			Filter
		</button>
	</div>

	<!-- Player table -->
	<div class="rounded-2xl bg-[var(--color-surface-2)] card-glow overflow-hidden">
		<table class="w-full">
			<thead>
				<tr class="text-[var(--color-text-2)] text-xs uppercase tracking-wider border-b border-[var(--color-surface-4)]">
					<th class="text-left px-5 py-4">Player</th>
					<th class="text-right px-4 py-4 hidden sm:table-cell">Pos</th>
					<th class="text-right px-4 py-4">Price</th>
					<th class="text-right px-4 py-4">Pts</th>
					<th class="text-right px-4 py-4 hidden sm:table-cell">Form</th>
					<th class="text-right px-4 py-4 hidden md:table-cell">Own%</th>
					<th class="text-right px-4 py-4 hidden md:table-cell">Pressure</th>
					<th class="text-right px-5 py-4 hidden lg:table-cell">xPts</th>
				</tr>
			</thead>
			<tbody>
				{#each data.players as row}
					{@const player = getPlayer(row)}
					<tr class="border-b border-[var(--color-surface-4)]/50 hover:bg-[var(--color-surface-3)]/50 transition-colors">
						<td class="px-5 py-3">
							<a href="/player/{row.element_id}" class="flex items-center gap-3 group">
								<PlayerPhoto code={player.code} teamCode={player.teams.code} size="40x40"
									class="w-8 h-8 rounded-full" />
								<div>
									<span class="font-medium text-sm group-hover:text-[var(--color-accent-light)]">{player.web_name}</span>
									<span class="text-[var(--color-text-3)] text-xs ml-1.5">{player.teams.short_name}</span>
								</div>
							</a>
						</td>
						<td class="text-right px-4 py-3 text-xs text-[var(--color-text-2)] hidden sm:table-cell">
							{POSITIONS[player.element_type]}
						</td>
						<td class="text-right px-4 py-3 font-mono text-sm">{formatPrice(row.now_cost)}</td>
						<td class="text-right px-4 py-3 font-mono text-sm font-semibold">{row.total_points}</td>
						<td class="text-right px-4 py-3 font-mono text-sm text-[var(--color-text-1)] hidden sm:table-cell">{row.form || '-'}</td>
						<td class="text-right px-4 py-3 font-mono text-sm text-[var(--color-text-2)] hidden md:table-cell">{row.selected_by_percent}%</td>
						<td class="text-right px-4 py-3 font-mono text-sm hidden md:table-cell
							{parseFloat(row.price_change_percent || '0') > 3 ? 'text-[var(--color-rise)]' : parseFloat(row.price_change_percent || '0') < -3 ? 'text-[var(--color-fall)]' : 'text-[var(--color-text-2)]'}">
							{row.price_change_percent ? parseFloat(row.price_change_percent).toFixed(1) + '%' : '-'}
						</td>
						<td class="text-right px-5 py-3 font-mono text-sm text-[var(--color-text-1)] hidden lg:table-cell">{row.ep_next || '-'}</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if data.players.length === 0}
			<div class="p-10 text-center text-[var(--color-text-2)]">
				No players found matching your filters.
			</div>
		{/if}
	</div>
</div>
