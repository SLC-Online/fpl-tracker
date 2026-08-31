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

	function fmtDateTime(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('en-GB', {
			day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
		});
	}

	function sourceLabel(name: string): string {
		return name.replace(/_/g, ' ');
	}

	// Group a source's captures by uploaded_for_gw so we can show, per GW,
	// the full history of captures (newest first).
	function groupByGw(caps: any[]) {
		const map = new Map<number, any[]>();
		for (const c of caps) {
			if (!map.has(c.uploaded_for_gw)) map.set(c.uploaded_for_gw, []);
			map.get(c.uploaded_for_gw)!.push(c);
		}
		return [...map.entries()]
			.map(([gw, list]) => ({ gw, captures: list }))
			.sort((a, b) => b.gw - a.gw);
	}

	// Which GW groups are expanded (default: none — click to reveal history)
	let expanded = $state<Record<string, boolean>>({});
	function toggle(key: string) {
		expanded[key] = !expanded[key];
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
		<!-- ══════════════ DRILL-DOWN: one capture ══════════════ -->
		{@const dd = data.drillDown}
		<section class="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-surface-4)] p-4 sm:p-6">
			<div class="flex items-start justify-between mb-4 gap-4">
				<div>
					<h2 class="text-lg font-semibold capitalize">{sourceLabel(dd.source_name)}</h2>
					<p class="text-sm text-[var(--color-text-2)] mt-0.5">
						Captured {fmtDateTime(dd.capture.captured_at)} · uploaded for GW{dd.capture.uploaded_for_gw}
					</p>
					<p class="text-xs text-[var(--color-text-3)] mt-0.5">
						{dd.capture.player_count} players · {dd.capture.row_count} rows · hash {dd.capture.content_hash?.slice(0, 12)}
						{#if dd.capture.meta?.patreon_published_at}
							· post published {fmtDateTime(dd.capture.meta.patreon_published_at)}
						{/if}
					</p>
				</div>
				<a href="/admin/data" class="text-sm text-[var(--color-accent-light)] hover:underline whitespace-nowrap">← All sources</a>
			</div>

			<div class="overflow-x-auto rounded-lg border border-[var(--color-surface-4)]">
				<table class="w-full text-sm">
					<thead class="bg-[var(--color-surface-3)] text-[var(--color-text-2)] text-xs uppercase tracking-wider">
						<tr>
							<th class="text-left px-3 py-2 sticky left-0 bg-[var(--color-surface-3)]">Player</th>
							<th class="text-center px-2 py-2">Pos</th>
							{#each dd.gwCols as gw}
								<th class="text-center px-2 py-2 whitespace-nowrap">GW{gw}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each dd.players as p}
							<tr class="border-t border-[var(--color-surface-4)]/40 hover:bg-white/[0.02]">
								<td class="px-3 py-1.5 sticky left-0 bg-[var(--color-surface-2)]">
									<a href="/player/{p.element_id}" class="hover:text-[var(--color-accent-light)]">{p.web_name}</a>
									<span class="text-[var(--color-text-3)] text-xs ml-1">{p.team_short}</span>
								</td>
								<td class="text-center px-2 py-1.5 text-[var(--color-text-3)] text-xs">{POSITIONS[p.element_type] || '—'}</td>
								{#each dd.gwCols as gw}
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
		<!-- ══════════════ OVERVIEW ══════════════ -->
		<p class="text-sm text-[var(--color-text-2)]">
			Every scrape/import is saved as a timestamped capture — but only when the data
			actually changed. Expand a gameweek to see its full capture history, and click any
			capture to see the exact numbers it recorded.
		</p>

		{#each data.sources as source}
			{@const caps = data.capturesBySource[source.id] || []}
			{@const groups = groupByGw(caps)}
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
						{caps.length} capture{caps.length === 1 ? '' : 's'}
					</div>
				</div>

				{#if groups.length === 0}
					<div class="px-5 py-6 text-center text-sm text-[var(--color-text-3)]">No data captured yet.</div>
				{:else}
					<div class="divide-y divide-[var(--color-surface-4)]/40">
						{#each groups as group}
							{@const key = `${source.id}-${group.gw}`}
							<div>
								<!-- GW header row: shows latest capture + count, click to expand history -->
								<button
									onclick={() => toggle(key)}
									class="w-full flex items-center justify-between px-4 sm:px-5 py-2.5 hover:bg-white/[0.02] text-left"
								>
									<div class="flex items-center gap-3">
										<span class="text-[var(--color-text-3)] text-xs w-4">{expanded[key] ? '▾' : '▸'}</span>
										<span class="font-medium">GW{group.gw}</span>
										<span class="text-xs text-[var(--color-text-3)]">
											{group.captures.length} capture{group.captures.length === 1 ? '' : 's'}
										</span>
									</div>
									<span class="text-xs text-[var(--color-text-2)]">
										latest {timeAgo(group.captures[0].captured_at)}
									</span>
								</button>

								{#if expanded[key]}
									<div class="pb-2">
										{#each group.captures as cap, i}
											<a href="/admin/data?capture={cap.id}"
												class="flex items-center justify-between pl-11 pr-4 sm:pr-5 py-1.5 text-xs hover:bg-white/[0.03] group">
												<div class="flex items-center gap-2">
													<span class="text-[var(--color-text-1)]">{fmtDateTime(cap.captured_at)}</span>
													{#if i === 0}
														<span class="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent-light)]">live</span>
													{/if}
												</div>
												<div class="flex items-center gap-3 text-[var(--color-text-3)]">
													<span>{cap.player_count} players</span>
													<span class="font-mono">{cap.row_count} rows</span>
													<span class="text-[var(--color-accent-light)] group-hover:underline">view →</span>
												</div>
											</a>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
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
				<div class="text-right text-xs text-[var(--color-text-3)]">{data.totalSnapshots.toLocaleString()} total</div>
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
								<td class="px-4 sm:px-5 py-1.5 text-[var(--color-text-1)]">
									{fmtDateTime(snap.timestamp)}
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
