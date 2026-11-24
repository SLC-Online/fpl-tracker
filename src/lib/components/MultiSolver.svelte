<script lang="ts">
	import { onDestroy } from 'svelte';
	import { formatPts } from '$lib/format';
	import type { FplRules, SolverPlayer } from '$lib/solver/fpl-solver';
	import type { ChipName, MultiRequest, MultiResult } from '$lib/solver/multi-week';
	import type { MultiIn, MultiOut } from '$lib/solver/multi.worker';
	import { CHIP_LABEL } from '$lib/plan';

	export interface ChipWindowAvail { name: string; start: number; stop: number }
	export interface MultiPlan { schedule: Record<number, ChipName>; result: MultiResult; gws: number[] }

	interface Props {
		players: (SolverPlayer & { proj: number[] })[];
		squadIds: number[];
		bank: number;
		freeTransfers: number;
		weights: number[];
		gws: number[];               // the horizon
		rules: FplRules;
		chipsAvailable: ChipWindowAvail[];
		baseTwxp: number;
		name: (id: number) => string;
		canRun: boolean;
		blocked: string;             // why it can't run, if it can't
		onUsePlan: (plan: MultiPlan) => void;
		/** This device's speed relative to the reference machine (1 = same, 2 = half as fast) */
		speedFactor?: number;
	}
	let { players, squadIds, bank, freeTransfers, weights, gws, rules, chipsAvailable, baseTwxp, name, canRun, blocked, onUsePlan, speedFactor = 1 }: Props = $props();

	// ─── Settings ──────────────────────────────────────────────────────────
	let maxPerWeek = $state<number | null>(null);
	let minutes = $state(5);   // 8-week plans with a chip take up to ~4 min to prove
	// One choice per chip window in the horizon: off, solver picks, a week, or a range.
	type Choice = { mode: 'off' | 'auto' | 'week' | 'range'; week: number; from: number; to: number };
	let windows = $derived(
		chipsAvailable
			.map((w) => ({ ...w, weeks: gws.filter((g) => g >= w.start && g <= w.stop) }))
			.filter((w) => w.weeks.length > 0)
	);
	let choices = $state<Record<string, Choice>>({});
	const keyOf = (w: { name: string; start: number }) => `${w.name}:${w.start}`;
	function choice(w: { name: string; start: number; weeks: number[] }): Choice {
		return choices[keyOf(w)] ?? { mode: 'off', week: w.weeks[0], from: w.weeks[0], to: w.weeks[w.weeks.length - 1] };
	}
	function setChoice(w: { name: string; start: number; weeks: number[] }, patch: Partial<Choice>) {
		choices = { ...choices, [keyOf(w)]: { ...choice(w), ...patch } };
	}

	// Every chip schedule the choices allow (one chip a week; no Free Hits in
	// back-to-back weeks across the GW19/20 boundary).
	let schedules = $derived.by(() => {
		let out: Record<number, ChipName>[] = [{}];
		for (const w of windows) {
			const c = choice(w);
			const opts: (number | null)[] =
				c.mode === 'off' ? [null]
				: c.mode === 'auto' ? [null, ...w.weeks]
				: c.mode === 'week' ? [c.week]
				: w.weeks.filter((g) => g >= c.from && g <= c.to);
			const next: Record<number, ChipName>[] = [];
			for (const s of out) for (const g of opts) {
				if (g === null) { next.push(s); continue; }
				const t = gws.indexOf(g);
				if (s[t] !== undefined) continue;
				if (w.name === 'freehit' && Object.entries(s).some(([u, n]) => n === 'freehit' && Math.abs(+u - t) === 1)) continue;
				next.push({ ...s, [t]: w.name as ChipName });
			}
			out = next;
		}
		return out;
	});
	const MAX_SCHEDULES = 40;

	// How many plans at once: one per core (leaving one for the page), but
	// within memory. An 8-week plan needs about 490 MB while it solves
	// (measured), roughly in proportion to the weeks; all workers share the
	// tab's memory, so allow ~1.6 GB on 8 GB+ devices, less on smaller ones.
	const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
	const memory = typeof navigator !== 'undefined' ? (navigator as any).deviceMemory ?? 8 : 8;
	const budgetMb = memory >= 8 ? 1100 : memory >= 4 ? 600 : 500;
	let poolSize = $derived(Math.max(1, Math.min(cores - 1, schedules.length, Math.floor(budgetMb / (530 * gws.length / 8)))));

	// Measured in Chrome on an M-series Mac with live data: an 8-week plan
	// takes about 3 minutes to prove, a little longer with a chip (roughly
	// weeks^3.6: 4 weeks takes 10-50 s). Scaled by this device's measured
	// speed, capped by the time allowed per plan.
	const perPlan = (s: Record<number, ChipName>) =>
		Math.min(minutes * 60, 170 * Math.pow(gws.length / 8, 3.6) * (Object.keys(s).length ? 1.2 : 1) * speedFactor);
	let estimateSeconds = $derived.by(() => {
		// Longest plans first across the pool: a simple upper estimate.
		const times = schedules.map(perPlan).sort((a, b) => b - a);
		const lanes = new Array(poolSize).fill(0);
		for (const t of times) { lanes.sort((a, b) => a - b); lanes[0] += t; }
		return Math.max(...lanes, 0);
	});

	const label = (s: Record<number, ChipName>) => {
		const parts = Object.entries(s).sort((a, b) => +a[0] - +b[0]).map(([t, n]) => `${CHIP_LABEL[n]} GW${gws[+t]}`);
		return parts.length ? parts.join(' · ') : 'No chips';
	};
	function fmtDuration(s: number) {
		if (s < 60) return `${Math.max(1, Math.round(s))} s`;
		return `${Math.round(s / 60)} min`;
	}

	// ─── Running ───────────────────────────────────────────────────────────
	type Job = {
		id: string; schedule: Record<number, ChipName>; label: string;
		state: 'queued' | 'running' | 'done' | 'error';
		best: number | null; bound: number | null; seconds: number;
		result?: MultiResult; error?: string;
	};
	let jobs = $state<Job[]>([]);
	let running = $state(false);
	let startedAt = 0;
	let elapsed = $state(0);
	let ticker: ReturnType<typeof setInterval> | null = null;
	let workers: Worker[] = [];
	let expanded = $state<string | null>(null);

	function stopAll() {
		for (const w of workers) w.terminate();
		workers = [];
		if (ticker) clearInterval(ticker);
		ticker = null;
		running = false;
		jobs = jobs.map((j) => (j.state === 'running' || j.state === 'queued' ? { ...j, state: 'error', error: 'Cancelled' } : j));
	}
	onDestroy(stopAll);

	async function run() {
		if (!canRun || schedules.length === 0 || schedules.length > MAX_SCHEDULES) return;
		stopAll();
		expanded = null;
		jobs = schedules.map((s, i) => ({ id: `j${i}`, schedule: s, label: label(s), state: 'queued', best: null, bound: null, seconds: 0 }));
		running = true;
		startedAt = performance.now();
		elapsed = 0;
		ticker = setInterval(() => (elapsed = (performance.now() - startedAt) / 1000), 500);
		const { default: MultiWorker } = await import('$lib/solver/multi.worker?worker');
		const base: Omit<MultiRequest, 'schedule'> = {
			players: players.map((p) => ({ ...p, proj: [...p.proj] as any })),
			squadIds, bank, freeTransfers, weights, rules: $state.snapshot(rules) as FplRules,
			timeLimitSeconds: minutes * 60,
			...(maxPerWeek !== null ? { maxTransfersPerWeek: maxPerWeek } : {})
		};
		let next = 0;
		const update = (id: string, patch: Partial<Job>) => (jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
		const feed = (w: Worker) => {
			const job = jobs[next++];
			if (!job) {
				w.terminate();
				workers = workers.filter((x) => x !== w);
				if (!workers.length) { running = false; if (ticker) clearInterval(ticker); ticker = null; }
				return;
			}
			update(job.id, { state: 'running' });
			(w as any).__job = job.id;
			// Reactive state is a proxy, which can't be copied into a worker: send a plain copy.
			w.postMessage({ type: 'solve', id: job.id, req: { ...base, schedule: $state.snapshot(job.schedule) } } satisfies MultiIn);
		};
		for (let i = 0; i < poolSize; i++) {
			const w = new MultiWorker();
			w.onmessage = (ev: MessageEvent<MultiOut>) => {
				const m = ev.data;
				if (m.type === 'progress') update(m.id, { best: m.best, bound: m.bound, seconds: m.seconds });
				else if (m.type === 'result') { update(m.id, { state: 'done', result: m.result, best: m.result.objective, bound: m.bound, seconds: m.result.timings.solveMs / 1000 }); feed(w); }
				else if (m.type === 'error') { update(m.id, { state: 'error', error: m.message }); feed(w); }
			};
			w.onerror = (e) => {
				// A worker that fails to start or crashes: mark its job, carry on with the rest.
				const id = jobs.find((j) => j.state === 'running' && (w as any).__job === j.id)?.id;
				if (id) update(id, { state: 'error', error: e.message || 'The solver stopped unexpectedly' });
				feed(w);
			};
			workers.push(w);
			feed(w);
		}
	}

	let sorted = $derived([...jobs].sort((a, b) => (b.best ?? -Infinity) - (a.best ?? -Infinity)));
	let doneCount = $derived(jobs.filter((j) => j.state === 'done').length);
	const net = (v: number | null) => (v === null ? null : v - baseTwxp);
	const fmtNet = (v: number | null) => (v === null ? '—' : `${v > 0.0049 ? '+' : v < -0.0049 ? '−' : ''}${formatPts(Math.abs(v))}`);
</script>

<div class="ms">
	<div class="ms-card">
		<p class="ms-intro">Plans transfers week by week over the next {gws.length} gameweeks, with free transfers rolling over{windows.length ? ' and your chips' : ''}. Each plan is proved the best possible, or you're told how close it got in the time allowed.</p>
		<div class="ms-grid">
			<label class="ms-field">
				<span class="ms-label">Transfers a week</span>
				<select class="ms-select" bind:value={maxPerWeek}>
					<option value={null}>Any number</option>
					<option value={1}>At most 1</option>
					<option value={2}>At most 2</option>
					<option value={3}>At most 3</option>
				</select>
			</label>
			<label class="ms-field">
				<span class="ms-label">Time per plan</span>
				<select class="ms-select" bind:value={minutes}>
					<option value={1}>1 minute</option>
					<option value={3}>3 minutes</option>
					<option value={5}>5 minutes</option>
					<option value={10}>10 minutes</option>
				</select>
			</label>
		</div>

		{#if windows.length}
			<div class="ms-chips">
				<span class="ms-label">Chips</span>
				{#each windows as w (keyOf(w))}
					{@const c = choice(w)}
					<div class="ms-chip-row">
						<span class="ms-chip-name">{CHIP_LABEL[w.name as ChipName]}<span class="ms-chip-win">{w.stop >= 38 ? 'second half' : `until GW${w.stop}`}</span></span>
						<select class="ms-select ms-select--sm" value={c.mode} onchange={(e) => setChoice(w, { mode: (e.currentTarget as HTMLSelectElement).value as Choice['mode'] })}>
							<option value="off">Don't use</option>
							<option value="auto">Solver picks the week</option>
							<option value="week">In a chosen week</option>
							<option value="range">In one of a range</option>
						</select>
						{#if c.mode === 'week'}
							<select class="ms-select ms-select--xs" value={c.week} onchange={(e) => setChoice(w, { week: +(e.currentTarget as HTMLSelectElement).value })}>
								{#each w.weeks as g}<option value={g}>GW{g}</option>{/each}
							</select>
						{:else if c.mode === 'range'}
							<span class="ms-range">
								<select class="ms-select ms-select--xs" value={c.from} onchange={(e) => setChoice(w, { from: +(e.currentTarget as HTMLSelectElement).value })}>
									{#each w.weeks as g}<option value={g}>GW{g}</option>{/each}
								</select>
								<span>to</span>
								<select class="ms-select ms-select--xs" value={c.to} onchange={(e) => setChoice(w, { to: +(e.currentTarget as HTMLSelectElement).value })}>
									{#each w.weeks as g}<option value={g}>GW{g}</option>{/each}
								</select>
							</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="ms-run">
			<div class="ms-run-info">
				{#if running}
					<span class="ms-spinner" aria-hidden="true"></span>
					<span>{doneCount} of {jobs.length} plans done · {fmtDuration(elapsed)}</span>
				{:else if blocked}
					<span>{blocked}</span>
				{:else if schedules.length > MAX_SCHEDULES}
					<span class="ms-warn">{schedules.length} chip combinations: narrow the chip choices to {MAX_SCHEDULES} or fewer.</span>
				{:else}
					<span>{schedules.length} plan{schedules.length === 1 ? '' : 's'} to solve, {poolSize} at a time · about {fmtDuration(estimateSeconds)}</span>
				{/if}
			</div>
			{#if running}
				<button class="ms-btn ms-btn--ghost" onclick={stopAll}>Cancel</button>
			{:else}
				<button class="ms-btn" disabled={!canRun || schedules.length > MAX_SCHEDULES} onclick={run}>Plan my weeks</button>
			{/if}
		</div>
	</div>

	{#if jobs.length}
		<div class="ms-results">
			{#each sorted as j (j.id)}
				{@const open = expanded === j.id}
				{@const proven = j.state === 'done' && j.result?.status === 'Optimal'}
				<div class="ms-row" class:is-open={open}>
					<button class="ms-row-head" disabled={j.state !== 'done'} onclick={() => (expanded = open ? null : j.id)}>
						<span class="ms-row-label">{j.label}</span>
						<span class="ms-row-status">
							{#if j.state === 'queued'}Waiting
							{:else if j.state === 'running'}<span class="ms-spinner ms-spinner--sm"></span>{j.best !== null ? `best so far ${fmtNet(net(j.best))}` : 'starting'}{j.bound !== null ? ` · at most ${fmtNet(net(j.bound))}` : ''}
							{:else if j.state === 'error'}{j.error}
							{:else if proven}Proven best
							{:else}Best found · at most {fmtNet(net(j.bound))}{/if}
						</span>
						<span class="ms-row-net" class:pos={(net(j.best) ?? 0) > 0.0049}>{fmtNet(net(j.best))}</span>
					</button>
					{#if open && j.result}
						<div class="ms-plan">
							<table class="ms-table">
								<thead><tr><th>GW</th><th>Transfers</th><th class="r">FT</th><th class="r">Hit</th></tr></thead>
								<tbody>
									{#each j.result.weeks as w}
										<tr>
											<td class="ms-gw">{gws[w.t]}{#if w.chip}<span class="ms-chip-tag">{CHIP_LABEL[w.chip]}</span>{/if}</td>
											<td>
												{#if w.chip === 'freehit'}<span class="ms-muted">Free Hit squad for this week</span>
												{:else if w.transfers.length === 0}<span class="ms-muted">Save</span>
												{:else}
													{#each w.transfers as t}
														<span class="ms-move"><span class="ms-out">{name(t.out)}</span> → <span class="ms-in">{name(t.in)}</span></span>
													{/each}
												{/if}
											</td>
											<td class="r ms-mono">{w.freeTransfers}</td>
											<td class="r ms-mono">{w.hits ? `−${w.hits}` : ''}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<div class="ms-actions">
								<button class="ms-use" onclick={() => onUsePlan({ schedule: j.schedule, result: j.result!, gws })}>Load into the planner</button>
								<span class="ms-note">Shows it week by week on the pitch, where you can change anything and save it as an option.</span>
							</div>
						</div>
					{/if}
				</div>
			{/each}
			<p class="ms-foot">Net is the change in time-weighted points over {gws.length} weeks after hits, against keeping your team. “At most” is the most any plan with those chips could score.</p>
		</div>
	{/if}
</div>

<style>
	.ms { display: flex; flex-direction: column; gap: 10px; }
	.ms-card { background: var(--color-surface-2); border: 1px solid var(--color-surface-4); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
	.ms-intro { font-size: 12px; color: var(--color-text-2); line-height: 1.45; }
	.ms-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
	.ms-field { display: flex; flex-direction: column; gap: 5px; }
	.ms-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-2); }
	.ms-select { width: 100%; padding: 7px 8px; border-radius: 8px; background: var(--color-surface-0); border: 1px solid var(--color-surface-4); color: var(--color-text-0); font-size: 12px; }
	.ms-select:focus { outline: none; border-color: var(--color-accent); }
	.ms-select--sm { width: auto; flex: 1; min-width: 0; }
	.ms-select--xs { width: auto; padding: 6px; }
	.ms-chips { display: flex; flex-direction: column; gap: 6px; }
	.ms-chip-row { display: flex; align-items: center; gap: 8px; }
	.ms-chip-name { width: 128px; flex-shrink: 0; font-size: 13px; color: var(--color-text-0); display: flex; flex-direction: column; }
	.ms-chip-win { font-size: 10px; color: var(--color-text-3); }
	.ms-range { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--color-text-2); }
	.ms-run { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 1px solid var(--color-surface-4); }
	.ms-run-info { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-2); min-width: 0; }
	.ms-warn { color: var(--color-warning); }
	.ms-btn { padding: 8px 16px; border-radius: 8px; background: var(--color-accent); color: #fff; font-size: 13px; font-weight: 600; white-space: nowrap; }
	.ms-btn:hover:not(:disabled) { background: var(--color-accent-light); }
	.ms-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.ms-btn--ghost { background: transparent; border: 1px solid var(--color-surface-4); color: var(--color-text-1); }
	.ms-spinner { width: 12px; height: 12px; flex-shrink: 0; border-radius: 50%; border: 2px solid var(--color-surface-4); border-top-color: var(--color-accent-light); animation: ms-spin 0.8s linear infinite; display: inline-block; }
	.ms-spinner--sm { width: 10px; height: 10px; margin-right: 5px; vertical-align: -1px; }
	@keyframes ms-spin { to { transform: rotate(360deg); } }
	.ms-results { display: flex; flex-direction: column; gap: 4px; }
	.ms-row { background: var(--color-surface-2); border: 1px solid var(--color-surface-4); border-radius: 8px; overflow: hidden; }
	.ms-row.is-open { border-color: rgba(129, 140, 248, 0.6); }
	.ms-row-head { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto 64px; align-items: center; gap: 10px; padding: 10px 12px; text-align: left; }
	.ms-row-head:hover:not(:disabled) { background: var(--color-surface-3); }
	.ms-row-head:disabled { cursor: default; }
	.ms-row-label { font-size: 13px; font-weight: 600; color: var(--color-text-0); }
	.ms-row-status { font-size: 11px; color: var(--color-text-2); white-space: nowrap; }
	.ms-row-net { font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--color-text-1); text-align: right; }
	.ms-row-net.pos { color: var(--color-rise); }
	.ms-plan { border-top: 1px solid var(--color-surface-4); padding: 8px 12px 12px; background: rgba(8, 13, 25, 0.35); }
	.ms-table { width: 100%; border-collapse: collapse; font-size: 12px; }
	.ms-table th { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--color-text-3); text-align: left; padding: 4px 4px 6px; }
	.ms-table td { padding: 5px 4px; border-top: 1px solid rgba(36, 48, 84, 0.5); vertical-align: top; color: var(--color-text-1); }
	.ms-table .r { text-align: right; }
	.ms-gw { font-family: var(--font-mono); color: var(--color-text-0); white-space: nowrap; }
	.ms-chip-tag { display: block; font-family: var(--font-sans); font-size: 9px; font-weight: 600; color: var(--color-accent-light); margin-top: 1px; }
	.ms-move { display: block; }
	.ms-out { color: var(--color-fall); }
	.ms-in { color: var(--color-rise); font-weight: 600; }
	.ms-muted { color: var(--color-text-3); }
	.ms-mono { font-family: var(--font-mono); }
	.ms-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
	.ms-use { padding: 6px 12px; border-radius: 7px; background: var(--color-accent-glow); color: var(--color-accent-light); border: 1px solid rgba(129, 140, 248, 0.4); font-size: 12px; font-weight: 600; white-space: nowrap; }
	.ms-use:hover { background: rgba(99, 102, 241, 0.25); }
	.ms-note { font-size: 11px; color: var(--color-text-2); line-height: 1.35; }
	.ms-foot { font-size: 11px; color: var(--color-text-2); line-height: 1.5; padding: 4px 2px 0; }
</style>
