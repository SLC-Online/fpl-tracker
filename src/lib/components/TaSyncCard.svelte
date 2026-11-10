<script lang="ts">
	import { onMount } from 'svelte';
	import { formatAgo } from '$lib/format';

	type Capture = { captured_at: string; uploaded_for_gw: number; row_count: number; player_count: number };
	type Run = { status: string; conclusion: string | null; createdAt: string; event: string };
	type Status = { capture: Capture | null; run: Run | null; canTrigger: boolean };

	let status: Status | null = $state(null);
	let loadFailed = $state(false);
	let syncing = $state(false); // we kicked off a run and are waiting on it
	let notice: { tone: 'ok' | 'info' | 'error'; text: string } | null = $state(null);
	let menuOpen = $state(false);
	let now = $state(Date.now());

	const running = $derived.by(() => {
		const run = status?.run;
		return syncing || (run != null && run.status !== 'completed');
	});
	const failed = $derived.by(() => {
		const run = status?.run;
		return run != null && run.status === 'completed' && run.conclusion != null && run.conclusion !== 'success';
	});

	async function load(): Promise<Status | null> {
		try {
			const res = await fetch('/api/ta-sync');
			if (!res.ok) throw new Error();
			const s: Status = await res.json();
			status = s;
			loadFailed = false;
			return s;
		} catch {
			loadFailed = true;
			return null;
		}
	}

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	async function sync(force = false) {
		menuOpen = false;
		notice = null;
		const before = status?.capture?.captured_at ?? null;
		syncing = true;

		const res = await fetch('/api/ta-sync', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ force })
		}).catch(() => null);

		if (!res || !res.ok) {
			const body = res ? await res.json().catch(() => ({})) : {};
			notice = { tone: 'error', text: body.message ?? 'Couldn’t start the import.' };
			syncing = false;
			return;
		}

		// Give GitHub a moment to register the run, then follow it to completion.
		await sleep(6000);
		for (let i = 0; i < 60; i++) {
			const s = await load();
			if (s?.run && s.run.status === 'completed') break;
			await sleep(4000);
		}
		syncing = false;

		const after = status?.capture?.captured_at ?? null;
		if (status?.run?.conclusion && status.run.conclusion !== 'success') {
			notice = { tone: 'error', text: 'The import run failed — see the workflow log on GitHub.' };
		} else if (after && after !== before) {
			notice = { tone: 'ok', text: `New data imported for GW${status?.capture?.uploaded_for_gw}.` };
		} else {
			notice = { tone: 'info', text: 'Checked — no newer post on Patreon yet.' };
		}
	}

	onMount(() => {
		load();
		const tick = setInterval(() => (now = Date.now()), 30_000);
		const refresh = setInterval(() => {
			if (!syncing) load();
		}, 60_000);
		const close = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest('[data-sync-menu]')) menuOpen = false;
		};
		document.addEventListener('click', close);
		return () => {
			clearInterval(tick);
			clearInterval(refresh);
			document.removeEventListener('click', close);
		};
	});
</script>

<section class="rounded-xl border border-[var(--color-surface-4)] bg-[var(--color-surface-2)] p-5 card-glow">
	<div class="flex items-start justify-between gap-4">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<span class="relative flex h-2 w-2">
					{#if running}
						<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent-light)] opacity-60"></span>
						<span class="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent-light)]"></span>
					{:else if failed}
						<span class="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-warning)]"></span>
					{:else if status?.capture}
						<span class="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-rise)]"></span>
					{:else}
						<span class="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-text-3)]"></span>
					{/if}
				</span>
				<h2 class="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-2)]">
					Transfer Algorithm sync
				</h2>
			</div>

			{#if status?.capture}
				<p class="mt-2 text-xl font-semibold text-[var(--color-text-0)]">
					Updated {formatAgo(status.capture.captured_at, now)}
				</p>
				<p class="mt-0.5 text-sm text-[var(--color-text-2)]">
					<span class="font-mono text-[var(--color-text-1)]">GW{status.capture.uploaded_for_gw}</span>
					<span class="mx-1.5 text-[var(--color-text-3)]">·</span>
					{status.capture.player_count} players
					<span class="mx-1.5 text-[var(--color-text-3)]">·</span>
					<time title={new Date(status.capture.captured_at).toLocaleString()}>
						{new Date(status.capture.captured_at).toLocaleString(undefined, {
							weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
						})}
					</time>
				</p>
			{:else if status}
				<p class="mt-2 text-xl font-semibold text-[var(--color-text-0)]">No data yet</p>
			{:else if loadFailed}
				<p class="mt-2 text-sm text-[var(--color-text-2)]">Couldn’t load sync status.</p>
			{:else}
				<div class="mt-3 h-6 w-48 animate-pulse rounded bg-[var(--color-surface-3)]"></div>
				<div class="mt-2 h-4 w-64 animate-pulse rounded bg-[var(--color-surface-3)]"></div>
			{/if}
		</div>

		{#if status?.canTrigger}
			<div class="relative flex shrink-0" data-sync-menu>
				<button
					onclick={() => sync(false)}
					disabled={running}
					class="inline-flex items-center gap-2 rounded-l-lg bg-[var(--color-accent)] py-2 pl-3.5 pr-3 text-sm font-medium text-white hover:bg-[var(--color-accent-light)] disabled:cursor-default disabled:opacity-60"
				>
					<svg class="h-3.5 w-3.5 {running ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none"
						stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
					</svg>
					{running ? 'Syncing…' : 'Sync now'}
				</button>
				<button
					onclick={() => (menuOpen = !menuOpen)}
					disabled={running}
					aria-label="More sync options"
					class="rounded-r-lg border-l border-white/15 bg-[var(--color-accent)] px-2 text-white hover:bg-[var(--color-accent-light)] disabled:cursor-default disabled:opacity-60"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
						<path d="m6 9 6 6 6-6" />
					</svg>
				</button>
				{#if menuOpen}
					<div class="absolute right-0 top-full z-20 mt-1.5 w-60 rounded-lg border border-[var(--color-surface-4)] bg-[var(--color-surface-3)] p-1 shadow-xl shadow-black/40">
						<button onclick={() => sync(true)}
							class="w-full rounded-md px-3 py-2 text-left hover:bg-[var(--color-surface-4)]">
							<span class="block text-sm text-[var(--color-text-0)]">Force re-import</span>
							<span class="block text-xs text-[var(--color-text-2)]">Re-download the latest post even if it looks unchanged</span>
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div class="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--color-surface-4)]/70 pt-3 text-xs">
		<span class="text-[var(--color-text-2)]">
			{#if running}
				Import running — checking Patreon for an updated post…
			{:else if status?.run}
				Last check {formatAgo(status.run.createdAt, now)}
				<span class="text-[var(--color-text-3)]">({status.run.event === 'schedule' ? 'automatic' : 'manual'})</span>
				{#if failed}
					<span class="text-[var(--color-warning)]"> · run failed</span>
				{/if}
			{:else if status}
				Last check unknown
			{/if}
		</span>
		{#if notice}
			<span class={notice.tone === 'ok'
				? 'text-[var(--color-rise)]'
				: notice.tone === 'error' ? 'text-[var(--color-fall)]' : 'text-[var(--color-text-1)]'}>
				{notice.text}
			</span>
		{:else if status && !status.canTrigger}
			<span class="text-[var(--color-text-3)]">Manual sync unavailable — set GITHUB_TOKEN</span>
		{/if}
	</div>
</section>
