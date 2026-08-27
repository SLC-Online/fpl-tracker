<script lang="ts">
	import { onMount } from 'svelte';
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import { gwCellColorFromRatio } from '$lib/gw-colors';
	import PlayerPhoto from '$lib/components/PlayerPhoto.svelte';

	let { data } = $props();
	let chartContainer: HTMLElement;

	function formatPrice(cost: number): string {
		return `£${(cost / 10).toFixed(1)}`;
	}

	onMount(async () => {
		if (data.timeline.length < 2) return;

		const ApexCharts = (await import('apexcharts')).default;

		const timestamps = data.timeline.map((s: any) => new Date(s.snapshots.timestamp).getTime());
		const prices = data.timeline.map((s: any) => s.now_cost / 10);
		const ownership = data.timeline.map((s: any) => parseFloat(s.selected_by_percent || 0));

		const options = {
			chart: {
				type: 'line',
				height: 280,
				background: 'transparent',
				foreColor: '#94a3b8',
				toolbar: { show: true, tools: { download: false, pan: false, reset: true, zoom: true, zoomin: false, zoomout: false } },
				zoom: { enabled: true },
				fontFamily: 'Sohne, system-ui, sans-serif',
			},
			theme: { mode: 'dark' as const },
			series: [
				{ name: 'Price (£m)', data: prices },
				{ name: 'Ownership (%)', data: ownership },
			],
			xaxis: {
				type: 'datetime' as const,
				categories: timestamps,
				labels: { style: { fontFamily: 'Sohne Mono', fontSize: '9px' }, datetimeFormatter: { hour: 'HH:mm', day: 'dd MMM' } },
				axisBorder: { show: false },
			},
			yaxis: [
				{
					title: { text: 'Price (£m)', style: { fontFamily: 'Sohne', fontSize: '10px', color: '#6366f1' } },
					labels: { formatter: (val: number) => `£${val.toFixed(1)}`, style: { fontFamily: 'Sohne Mono', fontSize: '9px', colors: ['#6366f1'] } },
					decimalsInFloat: 1,
				},
				{
					opposite: true,
					title: { text: 'Ownership (%)', style: { fontFamily: 'Sohne', fontSize: '10px', color: '#f59e0b' } },
					labels: { formatter: (val: number) => `${val.toFixed(1)}%`, style: { fontFamily: 'Sohne Mono', fontSize: '9px', colors: ['#f59e0b'] } },
					decimalsInFloat: 1,
				},
			],
			stroke: { width: [2.5, 1.5], curve: 'smooth' as const },
			colors: ['#6366f1', '#f59e0b'],
			grid: { borderColor: '#1a2440', strokeDashArray: 4 },
			legend: { fontFamily: 'Sohne', fontSize: '11px', labels: { colors: ['#6366f1', '#f59e0b'] } },
			tooltip: {
				theme: 'dark',
				style: { fontFamily: 'Sohne' },
				y: [
					{ formatter: (val: number) => `£${val.toFixed(1)}m` },
					{ formatter: (val: number) => `${val.toFixed(1)}%` },
				],
			},
			annotations: {
				xaxis: data.priceChanges.map((pc: any) => ({
					x: new Date(pc.detected_at).getTime(),
					borderColor: pc.change > 0 ? '#10b981' : '#ef4444',
					label: {
						text: `${pc.change > 0 ? '↑' : '↓'} ${formatPrice(pc.new_cost)}`,
						style: { color: '#fff', background: pc.change > 0 ? '#10b981' : '#ef4444', fontFamily: 'Sohne Mono', fontSize: '9px', padding: { left: 4, right: 4, top: 2, bottom: 2 } }
					}
				}))
			}
		};

		const chart = new ApexCharts(chartContainer, options);
		chart.render();

		return () => chart.destroy();
	});
</script>

<svelte:head>
	<title>{data.player.web_name} — FPL Tracker</title>
</svelte:head>

<div class="space-y-6">
	<!-- Player Header -->
	<div class="flex items-start gap-6 sm:gap-8">
		<PlayerPhoto code={data.player.code} teamCode={data.player.teams.code} size="250x250"
			isGk={data.player.element_type === 1}
			class="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl bg-[var(--color-surface-2)] object-cover card-glow" />
		<div class="flex-1 pt-1">
			<div class="flex items-center gap-3">
				<img src={teamBadgeUrl(data.player.teams.code)} alt="" class="w-7 h-7" />
				<h1 class="font-display font-bold text-2xl sm:text-3xl tracking-tight">{data.player.web_name}</h1>
			</div>
			<p class="text-[var(--color-text-2)] text-sm mt-1">
				{data.player.first_name} {data.player.second_name} · {data.player.teams.name} · {POSITIONS[data.player.element_type]}
			</p>

			{#if data.timeline.length > 0}
				{@const latest = data.timeline[data.timeline.length - 1]}
				<div class="flex flex-wrap gap-6 mt-5">
					<div>
						<div class="font-mono text-2xl font-semibold">{formatPrice(latest.now_cost)}</div>
						<div class="text-[var(--color-text-2)] text-xs mt-0.5">Price</div>
					</div>
					<div>
						<div class="font-mono text-2xl font-semibold">{latest.selected_by_percent}%</div>
						<div class="text-[var(--color-text-2)] text-xs mt-0.5">Ownership</div>
					</div>
					<div>
						<div class="font-mono text-2xl font-semibold
							{parseFloat(latest.price_change_percent || '0') > 5 ? 'text-[var(--color-rise)]' : parseFloat(latest.price_change_percent || '0') < -5 ? 'text-[var(--color-fall)]' : ''}">
							{parseFloat(latest.price_change_percent || '0').toFixed(1)}%
						</div>
						<div class="text-[var(--color-text-2)] text-xs mt-0.5">Price pressure</div>
					</div>
					<div>
						<div class="font-mono text-2xl font-semibold">{latest.form || '-'}</div>
						<div class="text-[var(--color-text-2)] text-xs mt-0.5">Form</div>
					</div>
					<div>
						<div class="font-mono text-2xl font-semibold">{latest.total_points}</div>
						<div class="text-[var(--color-text-2)] text-xs mt-0.5">Points</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Stats Grid -->
	{#if data.timeline.length > 0}
		{@const latest = data.timeline[data.timeline.length - 1]}
		<section class="rounded-xl bg-[var(--color-surface-2)] card-glow p-6">
			<h2 class="font-display font-semibold text-lg mb-4">Stats</h2>
			<div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.total_points}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Total Pts</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.form || '-'}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Form</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.minutes || 0}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Minutes</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.goals_scored || 0}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Goals</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.assists || 0}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Assists</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.clean_sheets || 0}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Clean Sheets</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.expected_goals || '-'}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">xG</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.expected_assists || '-'}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">xA</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.expected_goal_involvements || '-'}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">xGI</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.selected_by_percent}%</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Ownership</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.transfers_in_event?.toLocaleString() || '0'}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Transfers In</div>
				</div>
				<div class="text-center">
					<div class="font-mono text-lg font-semibold">{latest.transfers_out_event?.toLocaleString() || '0'}</div>
					<div class="text-[var(--color-text-2)] text-[10px] uppercase tracking-wider">Transfers Out</div>
				</div>
			</div>
		</section>
	{/if}

	<!-- Chart -->
	<!-- Price & Ownership Chart -->
	{#if data.timeline.length >= 2}
		<section class="rounded-xl bg-[var(--color-surface-2)] card-glow p-6">
			<h2 class="font-display font-semibold text-lg mb-4">Price & Ownership</h2>
			<div bind:this={chartContainer}></div>
		</section>
	{:else}
		<div class="rounded-xl bg-[var(--color-surface-2)] card-glow p-10 text-center">
			<p class="text-[var(--color-text-2)]">Collecting data — charts appear after more snapshots.</p>
		</div>
	{/if}

	<!-- Expected Points (from CSV data, if available) -->
	{#if data.csvData}
		{@const allGws = [data.csvData.gw1, data.csvData.gw2, data.csvData.gw3, data.csvData.gw4, data.csvData.gw5, data.csvData.gw6, data.csvData.gw7, data.csvData.gw8]}
		{@const csvGameweek = data.csvData.gameweek || 1}
		{@const offset = Math.max(0, data.nextGw - csvGameweek)}
		{@const remaining = allGws.slice(offset).filter(p => p !== null)}
		{@const maxPts = Math.max(...remaining.map(p => p || 0))}
		{@const minPts = Math.min(...remaining.map(p => p || 0))}
		<section class="rounded-xl bg-[var(--color-surface-2)] card-glow p-6">
			<h2 class="font-display font-semibold text-lg mb-5">Expected Points</h2>
			<div class="grid grid-cols-4 sm:grid-cols-8 gap-2">
				{#each allGws.slice(offset) as pts, i}
					{#if pts !== null}
						{@const range = maxPts - minPts || 1}
						{@const ratio = (pts - minPts) / range}
						<div class="text-center p-3 rounded-lg"
							style="background: {gwCellColorFromRatio(Math.max(0, Math.min(1, ratio)))}">
							<div class="text-[var(--color-text-2)] text-[10px] mb-1">GW{csvGameweek + offset + i}</div>
							<div class="font-mono font-semibold text-base">{pts.toFixed(1)}</div>
						</div>
					{/if}
				{/each}
			</div>
			<div class="flex gap-6 mt-5 pt-4 border-t border-[var(--color-surface-4)]">
				<div>
					<span class="text-[var(--color-text-2)] text-sm">8-week total</span>
					<span class="font-mono font-semibold ml-2">{data.csvData.projected_sum?.toFixed(1)}</span>
				</div>
				<div>
					<span class="text-[var(--color-text-2)] text-sm">PPG (long-term)</span>
					<span class="font-mono font-semibold ml-2">{data.csvData.ppg_longer_term?.toFixed(2)}</span>
				</div>
			</div>
		</section>
	{/if}

	<!-- Price History -->
	{#if data.priceChanges.length > 0}
		<section class="rounded-xl bg-[var(--color-surface-2)] card-glow p-6">
			<h2 class="font-display font-semibold text-lg mb-4">Price History</h2>
			<div class="space-y-0">
				{#each data.priceChanges as pc}
					<div class="flex items-center justify-between py-3 border-b border-[var(--color-surface-4)] last:border-0">
						<span class="text-[var(--color-text-2)] text-sm font-mono">
							{new Date(pc.detected_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
						</span>
						<span class="font-mono font-semibold text-sm
							{pc.change > 0 ? 'text-[var(--color-rise)]' : 'text-[var(--color-fall)]'}">
							{formatPrice(pc.old_cost)} → {formatPrice(pc.new_cost)}
						</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
