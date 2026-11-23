/**
 * FPL transfer solver.
 *
 * Finds the provably best transfer plan for the same problem the brute-force
 * optimiser solves (fpl_project/optimizer_app.py): transfers made now, squad
 * then held over the horizon, and each week scored by its best legal XI with
 * the top starter captained, weighted by the per-week decay. Instead of
 * scoring every possible squad it hands the problem to HiGHS, a mixed-integer
 * programming solver, which proves its answer optimal.
 *
 * Self-contained so the same file runs in Node (tests, benchmarks) and the
 * browser (FPL Sorted). The HiGHS instance is passed in, so the caller decides
 * how it's loaded.
 */

// ─── Rules ──────────────────────────────────────────────────────────────────

/** Game rules the solver uses. Built from FPL's live settings plus RULE_CONSTANTS. */
export interface FplRules {
	squadSize: number;                 // game_settings.squad_squadsize
	startingXi: number;                // game_settings.squad_squadplay
	clubLimit: number;                 // game_settings.squad_team_limit
	maxBankedFreeTransfers: number;    // 1 + game_settings.max_extra_free_transfers
	sellOnFee: number;                 // game_settings.transfers_sell_on_fee (share of profit you keep)
	positions: Record<number, { squad: number; minPlay: number; maxPlay: number; name: string }>;
	hitCost: number;                   // RULE_CONSTANTS
	captainMultiplier: number;         // RULE_CONSTANTS
}

/**
 * Rules FPL's data feed doesn't publish. Sourced from the official 2026/27
 * rules: "every additional transfer costs four points" (premierleague.com,
 * Aug 2026); the captain scores double. Update here if FPL changes them.
 */
export const RULE_CONSTANTS = { hitCost: 4, captainMultiplier: 2 } as const;

/**
 * The live settings this solver was built and tested against (2026/27).
 * checkRuleChanges() compares FPL's current feed with these so a rule change
 * is flagged rather than silently mis-modelled.
 */
export const TESTED_SETTINGS: Record<string, unknown> = {
	squad_squadsize: 15,
	squad_squadplay: 11,
	squad_team_limit: 3,
	squad_total_spend: 1000,
	max_extra_free_transfers: 4,
	transfers_sell_on_fee: 0.5,
	transfers_cap: 20,
	element_sell_at_purchase_price: false,
	sys_vice_captain_enabled: true,
	squad_special_min: null,
	squad_special_max: null,
	element_types: '1:2/1-1,2:5/3-5,3:5/2-5,4:3/1-3',
	chips: '3xc:1-19,3xc:20-38,bboost:1-19,bboost:20-38,freehit:2-19,freehit:20-38,wildcard:2-19,wildcard:20-38'
};

type Bootstrap = {
	game_settings: Record<string, any>;
	element_types: { id: number; squad_select: number; squad_min_play: number; squad_max_play: number; singular_name_short: string }[];
	chips?: { name: string; start_event: number; stop_event: number }[];
};

function settingsFingerprint(bs: Bootstrap): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(TESTED_SETTINGS)) {
		if (k in bs.game_settings) out[k] = bs.game_settings[k];
	}
	out.element_types = bs.element_types
		.map((e) => `${e.id}:${e.squad_select}/${e.squad_min_play}-${e.squad_max_play}`)
		.join(',');
	out.chips = (bs.chips ?? [])
		.map((c) => `${c.name}:${c.start_event}-${c.stop_event}`)
		.sort()
		.join(',');
	return out;
}

/** Differences between FPL's live settings and the ones this solver was tested with. */
export function checkRuleChanges(bs: Bootstrap): { setting: string; tested: unknown; now: unknown }[] {
	const now = settingsFingerprint(bs);
	const changes: { setting: string; tested: unknown; now: unknown }[] = [];
	for (const [k, tested] of Object.entries(TESTED_SETTINGS)) {
		if (JSON.stringify(now[k] ?? null) !== JSON.stringify(tested)) changes.push({ setting: k, tested, now: now[k] ?? null });
	}
	return changes;
}

export function rulesFromBootstrap(bs: Bootstrap): FplRules {
	const g = bs.game_settings;
	const positions: FplRules['positions'] = {};
	for (const e of bs.element_types) {
		positions[e.id] = { squad: e.squad_select, minPlay: e.squad_min_play, maxPlay: e.squad_max_play, name: e.singular_name_short };
	}
	return {
		squadSize: g.squad_squadsize,
		startingXi: g.squad_squadplay,
		clubLimit: g.squad_team_limit,
		maxBankedFreeTransfers: 1 + g.max_extra_free_transfers,
		sellOnFee: g.transfers_sell_on_fee,
		positions,
		hitCost: RULE_CONSTANTS.hitCost,
		captainMultiplier: RULE_CONSTANTS.captainMultiplier
	};
}

/** FPL selling price: purchase price plus your share of any rise, rounded down to £0.1m. */
export function sellingPrice(purchase: number, current: number, rules: Pick<FplRules, 'sellOnFee'>): number {
	if (current <= purchase) return current;
	return purchase + Math.floor((current - purchase) * rules.sellOnFee);
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface SolverPlayer {
	id: number;
	pos: number;          // element_type
	team: number;
	cost: number;         // current price, tenths (buy price)
	sell?: number;        // selling price, tenths (owned players)
	proj: ArrayLike<number>;  // expected points per horizon week (0 if missing)
	hasProj: boolean;     // has any projection at all (same pool rule as the brute force)
}

export interface SolveRequest {
	players: SolverPlayer[];
	squadIds: number[];
	bank: number;             // tenths
	freeTransfers: number;
	weights: number[];        // per-week decay weights, e.g. 0.85^i
	rules: FplRules;
	/** exactly N transfers (for comparisons), at most N, or a wildcard (unlimited, no hits) */
	transfers: { exactly: number } | { atMost: number } | 'wildcard';
	timeLimitSeconds?: number;
}

export interface SolveResult {
	status: string;               // HiGHS model status ("Optimal" = proven best)
	squadIds: number[];
	transfers: { out: number; in: number }[];   // paired by position
	twxp: number;                 // exact re-score of the chosen squad
	baseTwxp: number;
	delta: number;
	hits: number;                 // points deducted
	net: number;
	solverObjective: number;      // HiGHS's own figure (should equal net + base within float noise)
	timings: { buildMs: number; solveMs: number };
	modelSize: { variables: number; constraints: number };
}

// ─── Exact scoring (identical to the brute force, for re-scoring) ──────────

const FORMATIONS: [number, number, number][] = [];
for (let d = 3; d < 6; d++) for (let m = 2; m < 6; m++) for (let f = 1; f < 4; f++) if (d + m + f === 10) FORMATIONS.push([d, m, f]);

/** Best legal XI for one week, captain doubled — same rules and tie-breaks as optimizer_app.best_xi_points. */
export function bestXiPoints(squad: SolverPlayer[], wk: number): number {
	const byPos: { v: number }[][] = [[], [], [], [], []];
	for (const p of squad) byPos[p.pos].push({ v: p.proj[wk] ?? 0 });
	for (let pos = 1; pos <= 4; pos++) byPos[pos].sort((a, b) => b.v - a.v);
	if (byPos[1].length === 0) return 0;
	let best: number | null = null;
	for (const [d, m, f] of FORMATIONS) {
		if (byPos[2].length < d || byPos[3].length < m || byPos[4].length < f) continue;
		const starters = [byPos[1][0], ...byPos[2].slice(0, d), ...byPos[3].slice(0, m), ...byPos[4].slice(0, f)];
		let total = 0;
		for (const s of starters) total += s.v;
		let cap = starters[0];
		for (const s of starters) if (s.v > cap.v) cap = s;
		total += cap.v;
		if (best === null || total > best) best = total;
	}
	return best ?? 0;
}

export function squadTwxp(squad: SolverPlayer[], weights: number[]): number {
	let total = 0;
	for (let i = 0; i < weights.length; i++) total += bestXiPoints(squad, i) * weights[i];
	return total;
}

// ─── Model ──────────────────────────────────────────────────────────────────

type HighsLike = { solve(problem: string, options?: Record<string, unknown>): any };

/** Number formatting for LP text: shortest exact round-trip of the double. */
const num = (v: number) => (Object.is(v, -0) ? '0' : String(v));

export function buildModel(req: SolveRequest): { lp: string; variables: number; constraints: number } {
	const { rules, weights } = req;
	const owned = new Set(req.squadIds);
	const pool = req.players.filter((p) => owned.has(p.id) || p.hasProj);
	const W = weights.length;
	const x = (p: SolverPlayer) => `x${p.id}`;
	const s = (p: SolverPlayer, t: number) => `s${p.id}_${t}`;
	const c = (p: SolverPlayer, t: number) => `c${p.id}_${t}`;
	const rows: string[] = [];
	let nRows = 0;
	const row = (name: string, expr: string) => { rows.push(` ${name}: ${expr}`); nRows++; };
	const sum = (terms: string[]) => (terms.length ? terms.join(' + ') : '0 x0dummy');

	// Objective: decayed points of each week's starters, plus the captain again
	// (captainMultiplier - 1), minus the hit for transfers beyond the free ones.
	const obj: string[] = [];
	for (const p of pool) {
		for (let t = 0; t < W; t++) {
			const v = (p.proj[t] ?? 0) * weights[t];
			if (v === 0) continue;
			obj.push(`${num(v)} ${s(p, t)}`);
			obj.push(`${num(v * (rules.captainMultiplier - 1))} ${c(p, t)}`);
		}
	}
	const wildcard = req.transfers === 'wildcard';
	if (!wildcard) obj.push(`- ${num(rules.hitCost)} hits`);

	// Squad shape
	row('squad', `${sum(pool.map(x))} = ${rules.squadSize}`);
	for (const [pos, r] of Object.entries(rules.positions)) {
		row(`pos${pos}`, `${sum(pool.filter((p) => p.pos === Number(pos)).map(x))} = ${r.squad}`);
	}
	const clubs = new Map<number, SolverPlayer[]>();
	for (const p of pool) clubs.set(p.team, [...(clubs.get(p.team) ?? []), p]);
	for (const [club, ps] of clubs) if (ps.length > rules.clubLimit) row(`club${club}`, `${sum(ps.map(x))} <= ${rules.clubLimit}`);

	// Budget: buys <= bank + selling price of whoever is sold.
	// Rearranged: sum(buy cost * x) + sum(sell * x for owned) <= bank + sum(sell for owned)
	const budget: string[] = [];
	let ownedSell = 0;
	for (const p of pool) {
		if (owned.has(p.id)) { budget.push(`${num(p.sell ?? p.cost)} ${x(p)}`); ownedSell += p.sell ?? p.cost; }
		else budget.push(`${num(p.cost)} ${x(p)}`);
	}
	row('budget', `${budget.join(' + ')} <= ${num(req.bank + ownedSell)}`);

	// Transfers = number of new players bought
	const bought = pool.filter((p) => !owned.has(p.id)).map(x);
	if (!wildcard) {
		if ('exactly' in req.transfers) row('ntransfers', `${sum(bought)} = ${req.transfers.exactly}`);
		else row('ntransfers', `${sum(bought)} <= ${req.transfers.atMost}`);
		// hits >= transfers - free transfers (hits >= 0 from bounds)
		row('hitcount', `${sum(bought)} - hits <= ${req.freeTransfers}`);
	}

	// Each week: 11 starters from the squad within formation limits, one captain who starts.
	for (let t = 0; t < W; t++) {
		row(`xi_${t}`, `${sum(pool.map((p) => s(p, t)))} = ${rules.startingXi}`);
		for (const [pos, r] of Object.entries(rules.positions)) {
			const terms = pool.filter((p) => p.pos === Number(pos)).map((p) => s(p, t));
			row(`pmin${pos}_${t}`, `${sum(terms)} >= ${r.minPlay}`);
			row(`pmax${pos}_${t}`, `${sum(terms)} <= ${r.maxPlay}`);
		}
		row(`cap_${t}`, `${sum(pool.map((p) => c(p, t)))} = 1`);
		for (const p of pool) {
			row(`sx${p.id}_${t}`, `${s(p, t)} - ${x(p)} <= 0`);
			row(`cs${p.id}_${t}`, `${c(p, t)} - ${s(p, t)} <= 0`);
		}
	}

	const binaries: string[] = [];
	for (const p of pool) {
		binaries.push(x(p));
		for (let t = 0; t < W; t++) binaries.push(s(p, t), c(p, t));
	}
	const lp = [
		'Maximize',
		` obj: ${obj.join(' + ').replace(/\+ -/g, '- ')}`,
		'Subject To',
		...rows,
		'Bounds',
		wildcard ? '' : ' 0 <= hits <= 1000',
		'Binaries',
		' ' + binaries.join(' '),
		wildcard ? '' : 'Generals\n hits',
		'End'
	].filter(Boolean).join('\n');
	return { lp, variables: binaries.length + (wildcard ? 0 : 1), constraints: nRows };
}

export function solve(highs: HighsLike, req: SolveRequest): SolveResult {
	const t0 = performance.now();
	const { lp, variables, constraints } = buildModel(req);
	const t1 = performance.now();
	const res = highs.solve(lp, {
		output_flag: false,
		mip_rel_gap: 0,      // don't stop "close enough": prove the actual best
		mip_abs_gap: 1e-9,
		...(req.timeLimitSeconds ? { time_limit: req.timeLimitSeconds } : {})
	});
	const t2 = performance.now();

	const byId = new Map(req.players.map((p) => [p.id, p]));
	const current = req.squadIds.map((id) => byId.get(id)!);
	const baseTwxp = squadTwxp(current, req.weights);
	const picked: number[] = [];
	if (res.Columns) {
		for (const [name, col] of Object.entries<any>(res.Columns)) {
			if (name.startsWith('x') && col.Primal > 0.5) picked.push(Number(name.slice(1)));
		}
	}
	const squad = picked.map((id) => byId.get(id)!);
	const owned = new Set(req.squadIds);
	const outs = req.squadIds.filter((id) => !picked.includes(id));
	const ins = picked.filter((id) => !owned.has(id));
	// Pair each sale with a purchase in the same position, for display.
	const transfers: { out: number; in: number }[] = [];
	const insLeft = [...ins];
	for (const o of outs) {
		const k = insLeft.findIndex((i) => byId.get(i)!.pos === byId.get(o)!.pos);
		transfers.push({ out: o, in: k >= 0 ? insLeft.splice(k, 1)[0] : NaN });
	}
	const twxp = squad.length === req.rules.squadSize ? squadTwxp(squad, req.weights) : NaN;
	const hits = req.transfers === 'wildcard' ? 0 : Math.max(0, ins.length - req.freeTransfers) * req.rules.hitCost;
	return {
		status: res.Status,
		squadIds: picked,
		transfers,
		twxp,
		baseTwxp,
		delta: twxp - baseTwxp,
		hits,
		net: twxp - baseTwxp - hits,
		solverObjective: res.ObjectiveValue,
		timings: { buildMs: t1 - t0, solveMs: t2 - t1 },
		modelSize: { variables, constraints }
	};
}
