<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { formatPts } from '$lib/format';
	import { teamBadgeUrl, POSITIONS } from '$lib/types';
	import type { SquadPlayer } from '$lib/transfer-engine';
	import {
		bestXiDetail, squadTwxp, rulesFromBootstrap, checkRuleChanges,
		type FplRules, type SolverPlayer
	} from '$lib/solver/fpl-solver';
	import type { RunRequest, WorkerMessage, WorkerPlan } from '$lib/solver/solver.worker';
	import { groupPlans } from '$lib/solver/group-plans';
	import MultiSolver, { type ChipWindowAvail, type MultiPlan } from './MultiSolver.svelte';

	export interface SolverPreview {
		squadIds: number[];
		transfers: { out: number; in: number }[];
		week: number;            // index into gws
		starters: number[];
		bench: number[];
		captain: number;
		label: string;
	}

	interface Props {
		squad: SquadPlayer[];                      // current squad (after declared transfers)
		sellingOptions: Map<number, number[]>;     // players whose selling price is unclear
		bank: number;
		freeTransfers: number;
		allPlayers: any[];
		allPlayersLoaded: boolean;
		previewKey: string | null;
		onPreview: (key: string | null, preview: SolverPreview | null) => void;
		onUsePlan: (transfers: { out: number; in: number }[]) => void;
		/** Small screens: the pitch is above the panel, so offer a jump to it. */
		onShowPitch?: () => void;
		/** Gameweek index shown, shared with the pitch */
		week?: number;
		chipsAvailable?: ChipWindowAvail[];
		onUseMultiPlan?: (plan: MultiPlan) => void;
		/** Weeks ahead and decay, shared with the planner so figures agree */
		weeks?: number;
		decay?: number;
	}

	let { squad, sellingOptions, bank, freeTransfers, allPlayers, allPlayersLoaded, previewKey, onPreview, onUsePlan, onShowPitch, week = $bindable(0), chipsAvailable = [], onUseMultiPlan, weeks = $bindable(8), decay = $bindable(0.85) }: Props = $props();

	let mode = $state<'now' | 'weeks'>('now');

	// ─── Settings ──────────────────────────────────────────────────────────
	let maxTransfers = $state(2);
	let topN = $state(5);
	let wildcard = $state(false);
	let showNoGain = $state(false);

	// ─── Rules (live from FPL) ─────────────────────────────────────────────
	let rules = $state<FplRules | null>(null);
	let ruleChanges: { setting: string; tested: unknown; now: unknown }[] = $state([]);
	let rulesError = $state('');
	onMount(async () => {
		try {
			const r = await fetch('/api/fpl-rules');
			if (!r.ok) throw new Error(`rules ${r.status}`);
			const bs = await r.json();
			rules = rulesFromBootstrap(bs);
			ruleChanges = checkRuleChanges(bs);
		} catch (e: any) {
			rulesError = "Couldn't read FPL's current rules, so the solver can't run yet.";
		}
	});

	// ─── Players ───────────────────────────────────────────────────────────
	let byId = $derived(new Map<number, any>(allPlayers.map((p) => [p.element_id, p])));
	let gws = $derived.by(() => {
		const s = new Set<number>();
		for (const p of allPlayers) for (const pr of p.projections ?? []) s.add(pr.gw);
		return [...s].sort((a, b) => a - b).slice(0, 8);
	});
	let horizon = $derived(gws.slice(0, weeks));
	let weights = $derived(horizon.map((_, i) => Math.pow(decay, i)));

	// Unclear selling prices the user has confirmed (FPL app > Transfers).
	let confirmed = $state(new Map<number, number>());
	let unclear = $derived([...sellingOptions.entries()].filter(([id]) => squad.some((p) => p.element_id === id)));
	let unconfirmed = $derived(unclear.filter(([id]) => !confirmed.has(id)));

	function sellOf(p: SquadPlayer) {
		return confirmed.get(p.element_id) ?? p.selling_price;
	}

	function toSolver(p: any, sell?: number): SolverPlayer & { proj: number[] } {
		const m = new Map<number, number>((p.projections ?? []).map((x: any) => [x.gw, x.pts]));
		return {
			id: p.element_id, pos: p.element_type, team: p.team_id, cost: p.now_cost, sell,
			proj: horizon.map((g) => m.get(g) ?? 0), hasProj: (p.projections ?? []).length > 0
		};
	}

	let solverPlayers = $derived.by(() => {
		if (!allPlayersLoaded) return [];
		const owned = new Map(squad.map((p) => [p.element_id, p]));
		return allPlayers.map((p) => {
			const o = owned.get(p.element_id);
			return toSolver(p, o ? sellOf(o) : undefined);
		});
	});
	let solverById = $derived(new Map(solverPlayers.map((p) => [p.id, p])));
	let squadIds = $derived(squad.map((p) => p.element_id));
	let baseTwxp = $derived(solverPlayers.length ? squadTwxp(squadIds.map((id) => solverById.get(id)!).filter(Boolean), weights) : 0);

	// ─── Device speed and time estimate ────────────────────────────────────
	// Reference timings, measured in headless Chrome on an M-series Mac with
	// live data (top 5): the per-squad scoring cost there, and how long each
	// stage took. Estimates scale these by this device's measured speed.
	const REF_MS_PER_SQUAD = 0.0149;
	const REF_SECONDS = { upTo1: 0.05, upTo2: 0.3, upTo3: 7, mipSolve: 2.5, wildcardSolve: 1.4 };
	let msPerSquad = $state<number | null>(null);
	onMount(() => {
		// A short fixed workload on this device: score one squad 3,000 times.
		setTimeout(() => {
			if (!solverPlayers.length) return;
			const s = squadIds.map((id) => solverById.get(id)!).filter(Boolean);
			const t = performance.now();
			for (let i = 0; i < 3000; i++) squadTwxp(s, weights);
			msPerSquad = (performance.now() - t) / 3000;
		}, 50);
	});
	$effect(() => {
		// Re-measure once the player list arrives if it wasn't ready at mount.
		if (msPerSquad === null && solverPlayers.length) {
			const s = squadIds.map((id) => solverById.get(id)!).filter(Boolean);
			const t = performance.now();
			for (let i = 0; i < 3000; i++) squadTwxp(s, weights);
			msPerSquad = (performance.now() - t) / 3000;
		}
	});
	let estimateSeconds = $derived.by(() => {
		if (msPerSquad === null) return null;
		const f = Math.max(0.3, msPerSquad / REF_MS_PER_SQUAD) * (weeks / 8);
		const list = topN / 10;
		let s = 0;
		const ranked = Math.min(3, maxTransfers);
		if (ranked >= 1) s += [0, REF_SECONDS.upTo1, REF_SECONDS.upTo2, REF_SECONDS.upTo3][ranked] * (0.6 + 0.4 * list);
		const solves = topN * 1.3 + 1;
		s += Math.max(0, maxTransfers - 3) * solves * REF_SECONDS.mipSolve;
		if (wildcard) s += solves * REF_SECONDS.wildcardSolve;
		return s * f;
	});
	function fmtDuration(s: number) {
		if (s < 1) return 'under a second';
		if (s < 60) return `${Math.round(s)} s`;
		const m = Math.round(s / 60);
		return `${m} min`;
	}

	// ─── Running ───────────────────────────────────────────────────────────
	type Section = { depth: number; plans: WorkerPlan[]; ms: number };
	let running = $state(false);
	let stage = $state('');
	let elapsed = $state(0);
	let sections: Section[] = $state([]);
	let wildcardPlans = $state<WorkerPlan[] | null>(null);
	let runError = $state('');
	let ranFor = $state('');          // settings fingerprint of the shown results
	let totalMs = $state<number | null>(null);
	let worker: Worker | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	let fingerprint = $derived(JSON.stringify([squadIds, bank, freeTransfers, maxTransfers, topN, weeks, decay, wildcard, showNoGain, [...confirmed]]));
	let stale = $derived(ranFor !== '' && ranFor !== fingerprint && !running);
	let canRun = $derived(!!rules && allPlayersLoaded && unconfirmed.length === 0 && (maxTransfers > 0 || wildcard));

	function stop() {
		worker?.terminate();
		worker = null;
		if (timer) clearInterval(timer);
		timer = null;
		running = false;
		stage = '';
	}
	onDestroy(stop);

	async function run() {
		if (!canRun || !rules) return;
		stop();
		sections = [];
		wildcardPlans = null;
		runError = '';
		totalMs = null;
		expanded = null;
		onPreview(null, null);
		running = true;
		ranFor = fingerprint;
		const started = performance.now();
		elapsed = 0;
		timer = setInterval(() => (elapsed = (performance.now() - started) / 1000), 200);
		const { default: SolverWorker } = await import('$lib/solver/solver.worker?worker');
		worker = new SolverWorker();
		worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
			const m = ev.data;
			if (m.type === 'stage') stage = m.label;
			else if (m.type === 'depth') sections = [...sections, { depth: m.depth, plans: m.plans, ms: m.ms }];
			else if (m.type === 'wildcard') wildcardPlans = m.plans;
			else if (m.type === 'error') { runError = m.message; stop(); }
			else if (m.type === 'done') { totalMs = m.ms; stop(); }
		};
		worker.onerror = (e) => { runError = e.message || 'The solver stopped unexpectedly.'; stop(); };
		const req: RunRequest = {
			type: 'run',
			players: solverPlayers.map((p) => ({ ...p, proj: [...p.proj] })),
			squadIds, bank, freeTransfers, weights, rules: $state.snapshot(rules) as FplRules,
			maxTransfers, topN, wildcard, hideNoGain: !showNoGain
		};
		worker.postMessage(req);
	}

	// ─── Display ───────────────────────────────────────────────────────────
	let expanded = $state<string | null>(null);
	let weekIdx = $derived(Math.min(week, Math.max(0, horizon.length - 1)));

	const planKey = (p: { squadIds: number[] }, tag: string) => tag + ':' + [...p.squadIds].sort((a, b) => a - b).join(',');
	const name = (id: number) => byId.get(id)?.web_name ?? `#${id}`;
	const hitLabel = (d: number) => {
		const h = Math.max(0, d - freeTransfers) * 4;
		return h ? `−${h} hit` : 'no hit';
	};
	const fmtSigned = (v: number) => (v > 0.0049 ? '+' : v < -0.0049 ? '−' : '') + formatPts(Math.abs(v));

	function detailFor(ids: number[], wk: number) {
		const s = ids.map((id) => solverById.get(id)!).filter(Boolean);
		return bestXiDetail(s, wk, rules?.captainMultiplier ?? 2);
	}

	function preview(key: string, ids: number[], transfers: { out: number; in: number }[], label: string, wk = weekIdx) {
		const d = detailFor(ids, wk);
		if (!d) return;
		onPreview(key, { squadIds: ids, transfers, week: wk, starters: d.starters, bench: d.bench, captain: d.captain, label });
	}

	function toggleRow(key: string, ids: number[], transfers: { out: number; in: number }[], label: string) {
		if (expanded === key) { expanded = null; return; }
		expanded = key;
		preview(key, ids, transfers, label, weekIdx);
	}

	function setWeek(i: number, key: string, ids: number[], transfers: { out: number; in: number }[], label: string) {
		week = Math.max(0, Math.min(horizon.length - 1, i));
		if (previewKey === key) preview(key, ids, transfers, label, week);
	}

	let nothingFound = $derived(!running && totalMs !== null && sections.every((s) => s.plans.length === 0) && !wildcardPlans?.length);
</script>

{#snippet lineup(ids: number[], key: string, transfers: { out: number; in: number }[], label: string, canUse: boolean)}
	{@const d = detailFor(ids, weekIdx)}
	{@const incoming = new Set(transfers.map((t) => t.in))}
	{#if d}
		<div class="sp-lineup">
			<div class="sp-week">
				<button class="sp-week-btn" disabled={weekIdx === 0} onclick={() => setWeek(weekIdx - 1, key, ids, transfers, label)} aria-label="Previous gameweek">
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>
				<div class="sp-week-label">
					<span class="sp-week-gw">GW{horizon[weekIdx]}</span>
					<span class="sp-week-meta">{d.formation.join('-')} · {formatPts(d.points)} pts</span>
				</div>
				<button class="sp-week-btn" disabled={weekIdx >= horizon.length - 1} onclick={() => setWeek(weekIdx + 1, key, ids, transfers, label)} aria-label="Next gameweek">
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>
			</div>
			<ul class="sp-xi">
				{#each d.starters as id}
					{@const p = solverById.get(id)}
					<li class="sp-xi-row" class:is-new={incoming.has(id)}>
						<span class="sp-pos">{POSITIONS[p?.pos ?? 0]}</span>
						<img src={teamBadgeUrl(byId.get(id)?.team_code)} alt="" class="sp-badge" />
						<span class="sp-xi-name">{name(id)}</span>
						{#if id === d.captain}<span class="sp-cap" title="Captain">C</span>{/if}
						<span class="sp-xi-pts">{formatPts((p?.proj[weekIdx] ?? 0) * (id === d.captain ? (rules?.captainMultiplier ?? 2) : 1))}</span>
					</li>
				{/each}
			</ul>
			<div class="sp-bench">
				<span class="sp-bench-label">Bench</span>
				{#each d.bench as id, i}
					{@const p = solverById.get(id)}
					<span class="sp-bench-item" class:is-new={incoming.has(id)}>
						<span class="sp-bench-n">{i === 0 ? 'GK' : i}</span>{name(id)}
						<span class="sp-bench-pts">{formatPts(p?.proj[weekIdx] ?? 0)}</span>
					</span>
				{/each}
			</div>
			{#if onShowPitch}
				<button class="sp-show-pitch" onclick={onShowPitch}>
					<svg viewBox="0 0 16 16" width="12" height="12" fill="none"><path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
					See it on the pitch
				</button>
			{/if}
			{#if canUse}
				<div class="sp-actions">
					<button class="sp-use" onclick={() => onUsePlan(transfers)}>Use these transfers</button>
					<span class="sp-actions-note">Adds them to Planned Transfers so you can adjust and save as an option.</span>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet planRow(plan: WorkerPlan, tag: string, rank: number, label: string, slotIn: number | null = null, alts: number[] = [])}
	{@const key = planKey(plan, tag)}
	{@const open = expanded === key}
	<div class="sp-row" class:is-open={open} class:is-previewed={previewKey === key}>
		<button class="sp-row-head" onclick={() => toggleRow(key, plan.squadIds, plan.transfers, label)} aria-expanded={open}>
			<span class="sp-rank">{rank}</span>
			<span class="sp-moves">
				{#if plan.transfers.length === 0}<span class="sp-keep">Keep your current team</span>{/if}
				{#each plan.transfers as t}
					<span class="sp-move">
						<span class="sp-out">{name(t.out)}</span>
						<svg class="sp-arrow" viewBox="0 0 16 16" width="12" height="12" fill="none"><path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
						<span class="sp-in">{name(t.in)}</span>
						{#if t.in === slotIn && alts.length}
							<span class="sp-or">or {alts.length} other{alts.length > 1 ? 's' : ''}</span>
						{/if}
					</span>
				{/each}
			</span>
			<span class="sp-score">
				<span class="sp-net" class:pos={plan.net > 0.0049} class:neg={plan.net < -0.0049}>{fmtSigned(plan.net)}</span>
				<span class="sp-sub">{formatPts(plan.twxp)}{plan.hits ? ` · −${plan.hits}` : ''}</span>
			</span>
			<svg class="sp-chev" viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
		</button>
		{#if !plan.proven}
			<p class="sp-unproven">Stopped at the time limit: best found, not proven best.</p>
		{/if}
		{#if open}
			{#if slotIn !== null && alts.length}
				<p class="sp-alts">
					Same score with any of these instead of {name(slotIn)}, as none of them changes the line-up:
					{alts.slice(0, 8).map(name).join(', ')}{alts.length > 8 ? ` and ${alts.length - 8} more` : ''}.
				</p>
			{/if}
			{@render lineup(plan.squadIds, key, plan.transfers, label, plan.transfers.length > 0 && tag !== 'wc')}
		{/if}
	</div>
{/snippet}

<div class="sp" data-ms-per-squad={msPerSquad}>
	{#if rulesError}
		<div class="sp-note sp-note--bad">{rulesError}</div>
	{:else if ruleChanges.length}
		<div class="sp-note sp-note--warn">
			<strong>FPL's rules have changed since the solver was tested.</strong>
			Results may not reflect the new rules:
			{ruleChanges.map((c) => c.setting).join(', ')}.
		</div>
	{/if}

	{#if unclear.length}
		<div class="sp-card sp-confirm">
			<p class="sp-confirm-title">Confirm selling price{unclear.length > 1 ? 's' : ''}</p>
			<p class="sp-confirm-text">FPL's public data allows two prices here. Check the FPL app (Transfers shows each player's selling price) and pick the right one.</p>
			{#each unclear as [id, opts]}
				<div class="sp-confirm-row">
					<span class="sp-confirm-name">{byId.get(id)?.web_name ?? squad.find((p) => p.element_id === id)?.web_name}</span>
					<div class="sp-seg">
						{#each opts as o}
							<button class="sp-seg-btn" class:on={confirmed.get(id) === o}
								onclick={() => { const m = new Map(confirmed); m.set(id, o); confirmed = m; }}>£{(o / 10).toFixed(1)}m</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div class="sp-modes" role="tablist">
		<button class="sp-mode" class:on={mode === 'now'} onclick={() => (mode = 'now')} role="tab" aria-selected={mode === 'now'}>
			<strong>This week</strong><span>Best transfers to make now</span>
		</button>
		<button class="sp-mode" class:on={mode === 'weeks'} onclick={() => (mode = 'weeks')} role="tab" aria-selected={mode === 'weeks'}>
			<strong>Across weeks</strong><span>Week-by-week plan, with chips</span>
		</button>
	</div>

	<div class="sp-shared">
		<label class="sp-field">
			<span class="sp-label">Weeks ahead</span>
			<select bind:value={weeks} class="sp-select">
				{#each [8, 7, 6, 5, 4, 3, 2, 1] as w}
					<option value={w} disabled={w > gws.length}>{w}{w === 8 ? ' (standard)' : ''}</option>
				{/each}
			</select>
		</label>
		<label class="sp-field">
			<span class="sp-label">Decay</span>
			<select bind:value={decay} class="sp-select">
				{#each [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7] as d}
					<option value={d}>{d.toFixed(2)}{d === 0.85 ? ' (standard)' : d === 1 ? ' (none)' : ''}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if mode === 'weeks'}
		{#if rules}
			<MultiSolver
				players={solverPlayers}
				{squadIds}
				{bank}
				{freeTransfers}
				{weights}
				gws={horizon}
				{rules}
				{chipsAvailable}
				{baseTwxp}
				{name}
				canRun={!!rules && allPlayersLoaded && unconfirmed.length === 0}
				blocked={unconfirmed.length ? 'Confirm the selling price above to run.' : !allPlayersLoaded ? 'Loading players…' : ''}
				onUsePlan={(p) => onUseMultiPlan?.(p)}
			/>
		{/if}
	{:else}
	<div class="sp-card sp-controls">
		<div class="sp-field">
			<span class="sp-label">Transfers</span>
			<div class="sp-seg">
				{#each [0, 1, 2, 3, 4, 5] as n}
					<button class="sp-seg-btn" class:on={maxTransfers === n} onclick={() => (maxTransfers = n)}>{n === 0 ? 'None' : `Up to ${n}`}</button>
				{/each}
			</div>
		</div>
		<div class="sp-grid">
			<label class="sp-field">
				<span class="sp-label">Options each</span>
				<select bind:value={topN} class="sp-select">
					<option value={1}>Best only</option>
					<option value={5}>Top 5</option>
					<option value={10}>Top 10</option>
					<option value={20}>Top 20</option>
				</select>
			</label>
		</div>
		<div class="sp-toggles">
			<label class="sp-check">
				<input type="checkbox" bind:checked={wildcard} />
				<span><strong>Wildcard</strong> · best squad from scratch, held for {weeks} week{weeks > 1 ? 's' : ''}</span>
			</label>
			<label class="sp-check">
				<input type="checkbox" bind:checked={showNoGain} />
				<span>Show plans with a transfer that adds nothing</span>
			</label>
		</div>
		<div class="sp-run">
			<div class="sp-run-info">
				{#if running}
					<span class="sp-spinner" aria-hidden="true"></span>
					<span>{stage || 'Starting'} · {elapsed.toFixed(0)} s{estimateSeconds ? ` of about ${fmtDuration(estimateSeconds)}` : ''}</span>
				{:else if unconfirmed.length}
					<span>Confirm the selling price above to run.</span>
				{:else if !allPlayersLoaded || !rules}
					<span>Loading players and rules…</span>
				{:else if estimateSeconds !== null && (maxTransfers > 0 || wildcard)}
					<span>About {fmtDuration(estimateSeconds)} on this device</span>
				{/if}
			</div>
			{#if running}
				<button class="sp-btn sp-btn--ghost" onclick={stop}>Cancel</button>
			{:else}
				<button class="sp-btn" disabled={!canRun} onclick={run}>{ranFor ? 'Run again' : 'Find transfers'}</button>
			{/if}
		</div>
	</div>

	{#if runError}
		<div class="sp-note sp-note--bad">The solver hit a problem: {runError}</div>
	{/if}

	{#if ranFor}
		{#if stale}
			<div class="sp-note">Settings have changed since these results. Run again to update them.</div>
		{/if}
		<div class="sp-results">
			<section class="sp-section">
				<header class="sp-section-head">
					<h3>No transfers</h3>
					<span>{freeTransfers} free transfer{freeTransfers === 1 ? '' : 's'} available</span>
				</header>
				{@render planRow({ transfers: [], squadIds, twxp: baseTwxp, delta: 0, hits: 0, net: 0, proven: true }, 'base', 0, 'No transfers')}
			</section>

			{#each sections as sec}
				<section class="sp-section">
					<header class="sp-section-head">
						<h3>{sec.depth} transfer{sec.depth > 1 ? 's' : ''}</h3>
						<span>{hitLabel(sec.depth)} · {(sec.ms / 1000).toFixed(1)} s</span>
					</header>
					{#if sec.plans.length === 0}
						<p class="sp-empty">
							{#if showNoGain}No legal {sec.depth}-transfer plan.{:else}No {sec.depth}-transfer plan where every transfer adds points. Tick “Show plans with a transfer that adds nothing” to see them anyway.{/if}
						</p>
					{:else}
						{#each (sec.plans.some((p) => p.alts) ? sec.plans.map((p) => ({ plan: p, slotIn: p.slotIn ?? null, alts: p.alts ?? [] })) : groupPlans(sec.plans)) as g, i}
							{@render planRow(g.plan, `d${sec.depth}`, i + 1, `${sec.depth} transfer${sec.depth > 1 ? 's' : ''} · option ${i + 1}`, g.slotIn, g.alts)}
						{/each}
					{/if}
				</section>
			{/each}

			{#if wildcardPlans}
				<section class="sp-section">
					<header class="sp-section-head">
						<h3>Wildcard</h3>
						<span>no hits</span>
					</header>
					{#if wildcardPlans.length === 0}
						<p class="sp-empty">No wildcard squad found.</p>
					{:else}
						{#each wildcardPlans as plan, i}
							{@render planRow(plan, 'wc', i + 1, `Wildcard · option ${i + 1}`)}
						{/each}
					{/if}
				</section>
			{/if}

			{#if running}
				<div class="sp-pending"><span class="sp-spinner" aria-hidden="true"></span>{stage || 'Working'}…</div>
			{:else if totalMs !== null}
				<p class="sp-foot">
					{nothingFound ? 'Nothing beats keeping your team.' : ''}
					Finished in {(totalMs / 1000).toFixed(1)} s. Net is the change in time-weighted points after hits; the smaller figure is the squad's total.
				</p>
			{/if}
		</div>
	{/if}
	{/if}
</div>

<style>
	.sp { display: flex; flex-direction: column; gap: 10px; }
	.sp-card {
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		border-radius: 10px;
		padding: 12px 14px;
	}
	.sp-note {
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-text-1);
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		border-radius: 8px;
		padding: 8px 12px;
	}
	.sp-note--warn { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.08); }
	.sp-note--bad { border-color: rgba(239, 68, 68, 0.45); background: var(--color-fall-bg); }

	/* Confirm selling prices */
	.sp-confirm { border-color: rgba(245, 158, 11, 0.45); }
	.sp-confirm-title { font-size: 13px; font-weight: 600; color: var(--color-text-0); }
	.sp-confirm-text { font-size: 12px; color: var(--color-text-2); margin: 3px 0 10px; line-height: 1.45; }
	.sp-confirm-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 0; }
	.sp-confirm-name { font-size: 13px; color: var(--color-text-0); }

	/* Controls */
	.sp-controls { display: flex; flex-direction: column; gap: 12px; }
	.sp-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
	.sp-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-2); }
	.sp-seg {
		display: flex;
		background: var(--color-surface-0);
		border: 1px solid var(--color-surface-4);
		border-radius: 8px;
		padding: 2px;
		gap: 2px;
	}
	.sp-seg-btn {
		flex: 1;
		padding: 6px 4px;
		border-radius: 6px;
		font-size: 12px;
		color: var(--color-text-2);
		white-space: nowrap;
		transition: background 0.12s, color 0.12s;
	}
	.sp-seg-btn:hover { color: var(--color-text-0); }
	.sp-seg-btn.on { background: var(--color-accent); color: #fff; }
	.sp-grid { display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 8px; }
	.sp-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	.sp-mode {
		display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
		padding: 9px 12px; border-radius: 10px; text-align: left;
		background: var(--color-surface-2); border: 1px solid var(--color-surface-4);
		transition: border-color 0.12s, background 0.12s;
	}
	.sp-mode strong { font-size: 13px; color: var(--color-text-0); }
	.sp-mode span { font-size: 11px; color: var(--color-text-2); }
	.sp-mode:hover { background: var(--color-surface-3); }
	.sp-mode.on { border-color: var(--color-accent); background: var(--color-accent-glow); }
	.sp-shared { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.sp-select {
		width: 100%;
		padding: 7px 8px;
		border-radius: 8px;
		background: var(--color-surface-0);
		border: 1px solid var(--color-surface-4);
		color: var(--color-text-0);
		font-size: 12px;
	}
	.sp-select:focus { outline: none; border-color: var(--color-accent); }
	.sp-toggles { display: flex; flex-direction: column; gap: 7px; }
	.sp-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--color-text-1); cursor: pointer; line-height: 1.4; }
	.sp-check input { margin-top: 2px; accent-color: var(--color-accent); }
	.sp-check strong { color: var(--color-text-0); font-weight: 600; }
	.sp-run {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-top: 10px;
		border-top: 1px solid var(--color-surface-4);
	}
	.sp-run-info { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-2); min-width: 0; }
	.sp-btn {
		padding: 8px 16px;
		border-radius: 8px;
		background: var(--color-accent);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		transition: background 0.12s, opacity 0.12s;
	}
	.sp-btn:hover:not(:disabled) { background: var(--color-accent-light); }
	.sp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.sp-btn--ghost { background: transparent; border: 1px solid var(--color-surface-4); color: var(--color-text-1); }
	.sp-btn--ghost:hover:not(:disabled) { background: var(--color-surface-3); }
	.sp-spinner {
		width: 12px; height: 12px; flex-shrink: 0;
		border-radius: 50%;
		border: 2px solid var(--color-surface-4);
		border-top-color: var(--color-accent-light);
		animation: sp-spin 0.8s linear infinite;
	}
	@keyframes sp-spin { to { transform: rotate(360deg); } }

	/* Results */
	.sp-results { display: flex; flex-direction: column; gap: 14px; }
	.sp-section { display: flex; flex-direction: column; gap: 4px; }
	.sp-section-head { display: flex; align-items: baseline; justify-content: space-between; padding: 0 2px 2px; }
	.sp-section-head h3 { font-family: var(--font-display); font-weight: 700; font-size: 15px; color: var(--color-text-0); }
	.sp-section-head span { font-size: 11px; color: var(--color-text-2); }
	.sp-empty { font-size: 12px; color: var(--color-text-2); padding: 10px 12px; background: var(--color-surface-2); border-radius: 8px; line-height: 1.45; }
	.sp-row {
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		border-radius: 8px;
		overflow: hidden;
		transition: border-color 0.12s;
	}
	.sp-row.is-previewed { border-color: rgba(129, 140, 248, 0.7); }
	.sp-row-head {
		width: 100%;
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) auto 14px;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		text-align: left;
	}
	.sp-row-head:hover { background: var(--color-surface-3); }
	.sp-rank { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-3); text-align: right; }
	.sp-moves { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	.sp-move { display: flex; align-items: center; gap: 6px; font-size: 13px; min-width: 0; }
	.sp-out { color: var(--color-fall); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.sp-in { color: var(--color-rise); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
	.sp-arrow { color: var(--color-text-3); flex-shrink: 0; }
	.sp-keep { font-size: 13px; color: var(--color-text-1); }
	.sp-score { display: flex; flex-direction: column; align-items: flex-end; }
	.sp-net { font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--color-text-1); }
	.sp-net.pos { color: var(--color-rise); }
	.sp-net.neg { color: var(--color-fall); }
	.sp-sub { font-family: var(--font-mono); font-size: 10px; color: var(--color-text-2); }
	.sp-chev { color: var(--color-text-3); transition: transform 0.15s; }
	.is-open .sp-chev { transform: rotate(180deg); }
	.sp-unproven { font-size: 11px; color: var(--color-warning); padding: 0 12px 8px 40px; }

	/* Line-up */
	.sp-lineup { border-top: 1px solid var(--color-surface-4); padding: 10px 12px 12px; background: rgba(8, 13, 25, 0.35); }
	.sp-week { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
	.sp-week-btn {
		width: 28px; height: 28px; border-radius: 7px;
		display: grid; place-items: center;
		color: var(--color-text-1);
		border: 1px solid var(--color-surface-4);
	}
	.sp-week-btn:hover:not(:disabled) { background: var(--color-surface-3); }
	.sp-week-btn:disabled { opacity: 0.3; }
	.sp-week-label { display: flex; flex-direction: column; align-items: center; }
	.sp-week-gw { font-size: 13px; font-weight: 600; color: var(--color-text-0); }
	.sp-week-meta { font-size: 11px; color: var(--color-text-2); font-family: var(--font-mono); }
	.sp-xi { display: flex; flex-direction: column; }
	.sp-xi-row {
		display: grid;
		grid-template-columns: 30px 16px minmax(0, 1fr) auto 44px;
		align-items: center;
		gap: 8px;
		padding: 4px 4px;
		font-size: 12px;
		border-radius: 5px;
	}
	.sp-xi-row + .sp-xi-row { border-top: 1px solid rgba(36, 48, 84, 0.5); }
	.sp-xi-row.is-new .sp-xi-name { color: var(--color-rise); font-weight: 600; }
	.sp-pos { font-size: 9px; font-weight: 600; letter-spacing: 0.04em; color: var(--color-text-2); }
	.sp-badge { width: 16px; height: 16px; }
	.sp-xi-name { color: var(--color-text-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.sp-cap {
		width: 16px; height: 16px; border-radius: 50%;
		background: var(--color-text-0); color: var(--color-surface-0);
		font-size: 9px; font-weight: 700; line-height: 16px; text-align: center;
	}
	.sp-xi-pts { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-1); text-align: right; grid-column: 5; }
	.sp-bench { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
	.sp-bench-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-2); margin-right: 2px; }
	.sp-bench-item {
		display: inline-flex; align-items: center; gap: 5px;
		font-size: 11px; color: var(--color-text-1);
		padding: 3px 8px; border-radius: 999px;
		background: var(--color-surface-3);
	}
	.sp-bench-item.is-new { color: var(--color-rise); }
	.sp-bench-n { font-family: var(--font-mono); font-size: 9px; color: var(--color-text-3); }
	.sp-bench-pts { font-family: var(--font-mono); font-size: 10px; color: var(--color-text-2); }
	.sp-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
	.sp-use {
		padding: 6px 12px; border-radius: 7px;
		background: var(--color-accent-glow); color: var(--color-accent-light);
		border: 1px solid rgba(129, 140, 248, 0.4);
		font-size: 12px; font-weight: 600; white-space: nowrap;
	}
	.sp-use:hover { background: rgba(99, 102, 241, 0.25); }
	.sp-actions-note { font-size: 11px; color: var(--color-text-2); line-height: 1.35; }
	.sp-or {
		font-size: 10px;
		color: var(--color-text-2);
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--color-surface-3);
		white-space: nowrap;
	}
	.sp-alts { font-size: 11px; color: var(--color-text-2); line-height: 1.45; padding: 8px 12px 0; border-top: 1px solid var(--color-surface-4); }
	.sp-show-pitch {
		display: none;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-accent-light);
	}
	@media (max-width: 1023px) {
		.sp-show-pitch { display: inline-flex; }
	}
	.sp-pending { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-2); padding: 8px 4px; }
	.sp-foot { font-size: 11px; color: var(--color-text-2); line-height: 1.5; padding: 0 2px; }
</style>
