<script lang="ts">
	import { onMount } from 'svelte';
	import { playerPhotoUrl, teamBadgeUrl, POSITIONS, POSITION_COLORS } from '$lib/types';
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
		const transfersIn = data.timeline.map((s: any) => s.transfers_in_event);
		const ownership = data.timeline.map((s: any) => parseFloat(s.selected_by_percent || 0));
		const pricePct = data.timeline.map((s: any) => parseFloat(s.price_change_percent || 0));

		const options = {
			chart: {
				type: 'line',
				height: 400,
				background: 'transparent',
				foreColor: '#94a3b8',
				toolbar: { show: true },
				zoom: { enabled: true },
			},
			theme: { mode: 'dark' as const },
			series: [
				{ name: 'Price (£)', data: prices, type: 'line' },
				{ name: 'Price Change %', data: pricePct, type: 'line' },
				{ name: 'Ownership %', data: ownership, type: 'line' },
			],
			xaxis: {
				type: 'datetime' as const,
				categories: timestamps,
			},
			yaxis: [
				{ title: { text: 'Price (£)' }, decimalsInFloat: 1 },
				{ title: { text: 'Price Change %' }, opposite: true, decimalsInFloat: 1 },
				{ title: { text: 'Ownership %' }, opposite: true, show: false },
			],
			stroke: { width: [3, 2, 1], curve: 'smooth' as const },
			colors: ['#38bdf8', '#4ade80', '#fbbf24'],
			grid: { borderColor: '#334155' },
			tooltip: { theme: 'dark' },
			annotations: {
				xaxis: data.priceChanges.map((pc: any) => ({
					x: new Date(pc.detected_at).getTime(),
					borderColor: pc.change > 0 ? '#4ade80' : '#f87171',
					label: {
						text: `${pc.change > 0 ? '↑' : '↓'} ${formatPrice(pc.new_cost)}`,
						style: { color: '#fff', background: pc.change > 0 ? '#4ade80' : '#f87171' }
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

<div class="space-y-8">
	<!-- Player Header -->
	<div class="flex items-start gap-6">
		<PlayerPhoto code={data.player.code} teamCode={data.player.teams.code} size="250x250"
			isGk={data.player.element_type === 1}
			class="w-32 h-32 rounded-xl bg-[var(--color-bg-card)] object-cover" />
		<div class="flex-1">
			<div class="flex items-center gap-3">
				<img src={teamBadgeUrl(data.player.teams.code)} alt="" class="w-8 h-8" />
				<h1 class="text-3xl font-bold">{data.player.web_name}</h1>
			</div>
			<p class="text-[var(--color-text-secondary)] mt-1">
				{data.player.first_name} {data.player.second_name} · {data.player.teams.name} · {POSITIONS[data.player.element_type]}
			</p>

			{#if data.timeline.length > 0}
				{@const latest = data.timeline[data.timeline.length - 1]}
				<div class="flex gap-6 mt-4">
					<div>
						<div class="text-2xl font-bold">{formatPrice(latest.now_cost)}</div>
						<div class="text-[var(--color-text-muted)] text-xs">Price</div>
					</div>
					<div>
						<div class="text-2xl font-bold">{latest.selected_by_percent}%</div>
						<div class="text-[var(--color-text-muted)] text-xs">Ownership</div>
					</div>
					<div>
						<div class="text-2xl font-bold" class:text-[var(--color-success)]={parseFloat(latest.price_change_percent || '0') > 0}
							class:text-[var(--color-danger)]={parseFloat(latest.price_change_percent || '0') < 0}>
							{parseFloat(latest.price_change_percent || '0').toFixed(1)}%
						</div>
						<div class="text-[var(--color-text-muted)] text-xs">Price Change Progress</div>
					</div>
					<div>
						<div class="text-2xl font-bold">{latest.form || '-'}</div>
						<div class="text-[var(--color-text-muted)] text-xs">Form</div>
					</div>
					<div>
						<div class="text-2xl font-bold">{latest.total_points}</div>
						<div class="text-[var(--color-text-muted)] text-xs">Total Points</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Chart -->
	{#if data.timeline.length >= 2}
		<section class="bg-[var(--color-bg-card)] rounded-xl p-6 border border-[var(--color-border)]">
			<h2 class="text-lg font-semibold mb-4">Price & Transfer Timeline</h2>
			<div bind:this={chartContainer}></div>
		</section>
	{:else}
		<div class="bg-[var(--color-bg-card)] rounded-xl p-8 border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
			<p>Collecting data... Charts will appear after a few more snapshots.</p>
		</div>
	{/if}

	<!-- Transfer Algorithm Data -->
	{#if data.csvData}
		<section class="bg-[var(--color-bg-card)] rounded-xl p-6 border border-[var(--color-border)]">
			<h2 class="text-lg font-semibold mb-4">Transfer Algorithm Data</h2>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
				<div>
					<div class="text-xl font-bold text-[var(--color-accent)]">{data.csvData.bcv?.toFixed(2)}</div>
					<div class="text-[var(--color-text-muted)] text-xs">BCV</div>
				</div>
				<div>
					<div class="text-xl font-bold">{data.csvData.projected_sum?.toFixed(1)}</div>
					<div class="text-[var(--color-text-muted)] text-xs">Projected Sum</div>
				</div>
				<div>
					<div class="text-xl font-bold">{formatPrice(data.csvData.csv_price * 10)}</div>
					<div class="text-[var(--color-text-muted)] text-xs">CSV Price</div>
				</div>
				<div>
					<div class="text-xl font-bold">{data.csvData.ppg_longer_term?.toFixed(2)}</div>
					<div class="text-[var(--color-text-muted)] text-xs">PPG (Long Term)</div>
				</div>
			</div>
		</section>
	{/if}

	<!-- Price Change History -->
	{#if data.priceChanges.length > 0}
		<section class="bg-[var(--color-bg-card)] rounded-xl p-6 border border-[var(--color-border)]">
			<h2 class="text-lg font-semibold mb-4">Price Change History</h2>
			<div class="space-y-2">
				{#each data.priceChanges as pc}
					<div class="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
						<span class="text-[var(--color-text-muted)] text-sm">
							{new Date(pc.detected_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
						</span>
						<span class={pc.change > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
							{formatPrice(pc.old_cost)} → {formatPrice(pc.new_cost)}
						</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
