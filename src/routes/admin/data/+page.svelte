<script lang="ts">
	import { POSITIONS } from '$lib/types';

	let { data } = $props();

	function timeAgo(iso: string | null): string {
		if (!iso) return '—';
		const then = new Date(iso).getTime();
		const mins = Math.floor((Date.now() - then) / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('en-GB', {
			day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
		});
	}

	// Colour a source name badge
	function sourceLabel(name: string): string {
		return name.replace(/_/g, ' ');
	}
</script>

<svelte:head>
	<title>Data — Admin — FPL Tracker</title>
</svelte:head>

<div class="max-w-5xl space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl sm:text-2xl font-bold">Captured Data</h1>
		<a href="/admin" class="text-sm text-[var(--color-text-2)] hover:text-[var(--color-text-0)]">← Admin</a>
	</div>

	{#if data.drillDown}
		<!-- ══════════════ DRILL-DOWN: one snapshot's rows ══════════════ -->
		<section class="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] p-4 sm:p-6">
			<div class="flex items-center justify-between mb-4">
				<div>
					<h2 class="text-lg font-semibold capitalize">{sourceLabel(data.drillDown.source_name)}</h2>
					<p class="text-sm text-[var(--color-text-2)]">
						Snapshot uploaded for GW{data.drillDown.uploaded_for_gw} · {data.drillDown.players.length} players
					</p>
				</div>
				<a href="/admin/data" class="text-sm text-[var(--color-accent-light)] hover:underline">← All sources</a>
			</div>

			<div class="overflow-x-auto rounded-lg border border-[var(--color-surface-4)]">
				<table class="w-full text-sm">
					<thead class="bg-[var(--color-surface-3)] text-[var(--color-text-2)] text-xs uppercase tracking-wider">
						<tr>
							<th class="text-left px-3 py-2 sticky left-0 bg-[var(--color-surface-3)]">Player</th>
							<th class="text-center px-2 py-2">Pos</th>
							{#each data.drillDown.gwCols as gw}
								<th class="text-center px-2 py-2 whitespace-nowrap">GW{gw}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.drillDown.players as p}
							<tr class="border-t border-[var(--color-surface-4)]/40 hover:bg-white/[0.02]">
								<td class="px-3 py-1.5 sticky left-0 bg-[var(--color-surface-2)]">
									<a href="/player/{p.element_id}" class="hover:text-[var(--color-accent-light)]">
										{p.web_name}
									</a>
									<span class="text-[var(--color-text-3)] text-xs ml-1">{p.team_short}</span>
								</td>
								<td class="text-center px-2 py-1.5 text-[var(--color-text-3)] text-xs">{POSITIONS[p.element_type] || '—'}</td>
								{#each data.drillDown.gwCols as gw}
									<td class="text-center px-2 py-1.5 font-mono text-xs">
										{p.gws[gw] != null ? p.gws[gw].toFixed(1) : '—'}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{:else}
		<!-- ══════════════ OVERVIEW: all sources + their snapshots ══════════════ -->
		<p class="text-sm text-[var(--color-text-2)]">
			Every projection source and the snapshots captured for it. Each snapshot is a version
			uploaded before a given gameweek — click one to see the exact numbers it recorded.
		</p>

		{#each data.sources as source}
			{@const snaps = data.summaries[source.id] || []}
			<section class="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] overflow-hidden">
				<div class="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-[var(--color-surface-4)]">
					<div>
						<h2 class="font-semibold capitalize flex items-center gap-2">
							{sourceLabel(source.source_name)}
							{#if !source.active}
								<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-surface-4)] text-[var(--color-text-3)]">inactive</span>
							{/if}
						</h2>
						{#if source.description}
							<p class="text-xs text-[var(--color-text-3)] mt-0.5">{source.description.split('|')[0]}</p>
						{/if}
					</div>
					<div class="text-right text-xs text-[var(--color-text-3)]">
						{snaps.length} snapshot{snaps.length === 1 ? '' : 's'}
					</div>
				</div>

				{#if snaps.length === 0}
					<div class="px-5 py-6 text-center text-sm text-[var(--color-text-3)]">
						No data captured yet.
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="text-[var(--color-text-3)] text-[11px] uppercase tracking-wider">
								<tr class="border-b border-[var(--color-surface-4)]/50">
									<th class="text-left px-4 sm:px-5 py-2">Uploaded for</th>
									<th class="text-right px-3 py-2">Players</th>
									<th class="text-right px-3 py-2">Rows</th>
									<th class="text-center px-3 py-2 whitespace-nowrap">GW range</th>
									<th class="text-right px-3 py-2 whitespace-nowrap">Last captured</th>
									<th class="px-3 py-2"></th>
								</tr>
							</thead>
							<tbody>
								{#each snaps as snap}
									<tr class="border-b border-[var(--color-surface-4)]/30 hover:bg-white/[0.02]">
										<td class="px-4 sm:px-5 py-2 font-medium">GW{snap.uploaded_for_gw}</td>
										<td class="text-right px-3 py-2 font-mono">{snap.players}</td>
										<td class="text-right px-3 py-2 font-mono text-[var(--color-text-2)]">{snap.rows.toLocaleString()}</td>
										<td class="text-center px-3 py-2 font-mono text-xs text-[var(--color-text-2)]">
											GW{snap.gwMin}–{snap.gwMax}
										</td>
										<td class="text-right px-3 py-2 text-xs text-[var(--color-text-2)]" title={fmtDate(snap.latest)}>
											{timeAgo(snap.latest)}
										</td>
										<td class="text-right px-3 py-2">
											<a href="/admin/data?source={source.id}&gw={snap.uploaded_for_gw}"
												class="text-xs text-[var(--color-accent-light)] hover:underline whitespace-nowrap">View →</a>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/each}

		<!-- ══════════════ Price snapshot history ══════════════ -->
		<section class="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] overflow-hidden">
			<div class="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-[var(--color-surface-4)]">
				<div>
					<h2 class="font-semibold">Price / player snapshots</h2>
					<p class="text-xs text-[var(--color-text-3)] mt-0.5">Hourly capture of FPL player data (prices, ownership, form)</p>
				</div>
				<div class="text-right text-xs text-[var(--color-text-3)]">
					{data.totalSnapshots.toLocaleString()} total
				</div>
			</div>
			<div class="overflow-x-auto max-h-96 overflow-y-auto">
				<table class="w-full text-sm">
					<thead class="sticky top-0 bg-[var(--color-surface-2)] text-[var(--color-text-3)] text-[11px] uppercase tracking-wider">
						<tr class="border-b border-[var(--color-surface-4)]/50">
							<th class="text-left px-4 sm:px-5 py-2">Captured</th>
							<th class="text-right px-3 py-2">Players</th>
							<th class="text-left px-3 py-2">Source</th>
						</tr>
					</thead>
					<tbody>
						{#each data.recentSnapshots as snap}
							<tr class="border-b border-[var(--color-surface-4)]/30 hover:bg-white/[0.02]">
								<td class="px-4 sm:px-5 py-1.5 text-[var(--color-text-1)]" title={fmtDate(snap.timestamp)}>
									{fmtDate(snap.timestamp)}
									<span class="text-[var(--color-text-3)] text-xs ml-1">({timeAgo(snap.timestamp)})</span>
								</td>
								<td class="text-right px-3 py-1.5 font-mono text-[var(--color-text-2)]">{snap.players_count ?? '—'}</td>
								<td class="px-3 py-1.5 text-xs text-[var(--color-text-3)]">{snap.source}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="px-4 sm:px-5 py-2 text-[11px] text-[var(--color-text-3)] border-t border-[var(--color-surface-4)]/50">
				Showing 50 most recent of {data.totalSnapshots.toLocaleString()}.
			</p>
		</section>
	{/if}
</div>
