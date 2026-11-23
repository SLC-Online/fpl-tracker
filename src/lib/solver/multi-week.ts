/**
 * Multi-week transfer solver: plans transfers week by week across the
 * horizon, with free transfers rolling over, and chips.
 *
 * Same scoring as everything else: each week's best legal XI (or the Free
 * Hit squad's), captain doubled (tripled with Triple Captain), bench added
 * with Bench Boost, weighted by the per-week decay; minus hits.
 *
 * Rules modelled (FPL 2026/27; free-transfer rules checked against FPL's own
 * hit charges, see $lib/free-transfers):
 *  - unused free transfers roll over (+1 a week) to the cap;
 *  - Wildcard week: transfers free, banked free transfers kept, none added;
 *  - Free Hit week: any squad within the squad's selling value plus bank,
 *    for that week only; the real squad can't change that week; banked
 *    free transfers kept, none added;
 *  - one chip a week; each chip at most once in the horizon;
 *  - players you own sell at their selling price; anyone bought during the
 *    plan sells at what was paid (price changes aren't forecast).
 */
import type { FplRules, SolverPlayer } from './fpl-solver.ts';

type HighsLike = { solve(problem: string, options?: Record<string, unknown>): any };

export type ChipName = 'wildcard' | 'freehit' | 'bboost' | '3xc';
/** Which weeks (indices into the horizon) a chip may be played, and whether it must be. */
export interface ChipSpec { weeks: number[]; mustUse: boolean }

export interface MultiRequest {
	players: SolverPlayer[];            // proj[t] for t in the horizon
	squadIds: number[];
	bank: number;
	freeTransfers: number;              // going into week 0
	weights: number[];
	rules: FplRules;
	chips?: Partial<Record<ChipName, ChipSpec>>;
	maxTransfersPerWeek?: number;       // optional cap to keep plans sensible
	timeLimitSeconds?: number;
	/** Squad-week sets to rule out (for next-best alternatives): each entry is the full plan's buys. */
	excludePlans?: { t: number; id: number }[][];
}

export interface MultiWeek {
	t: number;
	transfers: { out: number; in: number }[];
	chip: ChipName | null;
	squad: number[];          // the squad that plays (Free Hit squad in a FH week)
	starters: number[];
	captain: number;
	bank: number;
	freeTransfers: number;    // going into the week
	hits: number;
}

export interface MultiResult {
	status: string;
	objective: number;        // decayed points minus hits
	gap: number | null;       // relative gap if stopped early
	weeks: MultiWeek[];
	buys: { t: number; id: number }[];
	timings: { buildMs: number; solveMs: number };
	modelSize: { variables: number; constraints: number };
}

const num = (v: number) => (Object.is(v, -0) ? '0' : String(v));

export function buildMultiModel(req: MultiRequest) {
	const { rules, weights } = req;
	const T = weights.length;
	const owned = new Set(req.squadIds);
	const pool = req.players.filter((p) => owned.has(p.id) || p.hasProj);
	const chips = req.chips ?? {};
	const chipWeeks = (c: ChipName) => new Set(chips[c]?.weeks ?? []);
	const WC = chipWeeks('wildcard'), FH = chipWeeks('freehit'), BB = chipWeeks('bboost'), TC = chipWeeks('3xc');
	const maxFt = rules.maxBankedFreeTransfers;
	const squadN = rules.squadSize;

	const rows: string[] = [];
	const binaries: string[] = [];
	const generals: string[] = [];
	const bounds: string[] = [];
	const free: string[] = [];
	const obj: string[] = [];
	let r = 0;
	const row = (expr: string) => rows.push(` r${r++}: ${expr.replace(/\+ -/g, '- ')}`);
	const terms = (xs: string[]) => (xs.length ? xs.join(' + ') : '0 zero');

	const X = (p: SolverPlayer, t: number) => `x${p.id}_${t}`;
	const O = (p: SolverPlayer, t: number) => `o${p.id}_${t}`;     // still holding the original purchase
	const N = (p: SolverPlayer, t: number) => `n${p.id}_${t}`;     // holding a purchase made in the plan
	const B = (p: SolverPlayer, t: number) => `b${p.id}_${t}`;
	const SO = (p: SolverPlayer, t: number) => `so${p.id}_${t}`;
	const SN = (p: SolverPlayer, t: number) => `sn${p.id}_${t}`;
	const Y = (p: SolverPlayer, t: number) => `y${p.id}_${t}`;
	const C = (p: SolverPlayer, t: number) => `c${p.id}_${t}`;
	const K = (p: SolverPlayer, t: number) => `k${p.id}_${t}`;     // triple-captain extra
	const E = (p: SolverPlayer, t: number) => `e${p.id}_${t}`;     // bench player counted (Bench Boost)
	const Z = (p: SolverPlayer, t: number) => `z${p.id}_${t}`;     // in the Free Hit squad

	for (let t = 0; t < T; t++) {
		const w = weights[t];
		for (const p of pool) {
			const isOwned = owned.has(p.id);
			binaries.push(X(p, t), N(p, t), B(p, t), SN(p, t), Y(p, t), C(p, t));
			if (isOwned) binaries.push(O(p, t), SO(p, t));
			// Holdings: x = original + new
			row(isOwned ? `${X(p, t)} - ${O(p, t)} - ${N(p, t)} = 0` : `${X(p, t)} - ${N(p, t)} = 0`);
			if (isOwned) row(t === 0 ? `${O(p, t)} + ${SO(p, t)} = 1` : `${O(p, t)} - ${O(p, t - 1)} + ${SO(p, t)} = 0`);
			row(t === 0 ? `${N(p, t)} - ${B(p, t)} + ${SN(p, t)} = 0` : `${N(p, t)} - ${N(p, t - 1)} - ${B(p, t)} + ${SN(p, t)} = 0`);
			// Can only sell a plan purchase made in an earlier week.
			row(t === 0 ? `${SN(p, t)} <= 0` : `${SN(p, t)} - ${N(p, t - 1)} <= 0`);
			// Line-up
			row(FH.has(t) ? `${Y(p, t)} - ${X(p, t)} - fh_${t} <= 0` : `${Y(p, t)} - ${X(p, t)} <= 0`);
			if (FH.has(t)) { binaries.push(Z(p, t)); row(`${Y(p, t)} - ${Z(p, t)} + fh_${t} <= 1`); row(`${Z(p, t)} - fh_${t} <= 0`); }
			row(`${C(p, t)} - ${Y(p, t)} <= 0`);
			const v = (p.proj[t] ?? 0) * w;
			if (v !== 0) { obj.push(`${num(v)} ${Y(p, t)}`); obj.push(`${num(v * (rules.captainMultiplier - 1))} ${C(p, t)}`); }
			if (TC.has(t)) {
				binaries.push(K(p, t));
				row(`${K(p, t)} - ${C(p, t)} <= 0`);
				row(`${K(p, t)} - tc_${t} <= 0`);
				if (v !== 0) obj.push(`${num(v)} ${K(p, t)}`);
			}
			if (BB.has(t)) {
				binaries.push(E(p, t));
				row(`${E(p, t)} - ${X(p, t)} <= 0`);
				row(`${E(p, t)} + ${Y(p, t)} <= 1`);
				row(`${E(p, t)} - bb_${t} <= 0`);
				if (v !== 0) obj.push(`${num(v)} ${E(p, t)}`);
			}
		}

		// Squad shape (the real squad, every week)
		row(`${terms(pool.map((p) => X(p, t)))} = ${squadN}`);
		for (const [pos, pr] of Object.entries(rules.positions)) {
			row(`${terms(pool.filter((p) => p.pos === +pos).map((p) => X(p, t)))} = ${pr.squad}`);
		}
		const clubs = new Map<number, SolverPlayer[]>();
		for (const p of pool) clubs.set(p.team, [...(clubs.get(p.team) ?? []), p]);
		for (const ps of clubs.values()) if (ps.length > rules.clubLimit) row(`${terms(ps.map((p) => X(p, t)))} <= ${rules.clubLimit}`);

		// Free Hit squad
		if (FH.has(t)) {
			row(`${terms(pool.map((p) => Z(p, t)))} - ${squadN} fh_${t} = 0`);
			for (const [pos, pr] of Object.entries(rules.positions)) {
				row(`${terms(pool.filter((p) => p.pos === +pos).map((p) => Z(p, t)))} - ${pr.squad} fh_${t} = 0`);
			}
			for (const ps of clubs.values()) if (ps.length > rules.clubLimit) row(`${terms(ps.map((p) => Z(p, t)))} <= ${rules.clubLimit}`);
			// Budget: the squad's selling value going into the week plus the bank.
			const value: string[] = [];
			let constant = 0;
			for (const p of pool) {
				if (t === 0) { if (owned.has(p.id)) constant += p.sell ?? p.cost; continue; }
				if (owned.has(p.id)) value.push(`${num(p.sell ?? p.cost)} ${O(p, t - 1)}`);
				value.push(`${num(p.cost)} ${N(p, t - 1)}`);
			}
			const bankPrev = t === 0 ? '' : ` - bank_${t - 1}`;
			const valueTerms = value.length ? ' - ' + value.join(' - ') : '';
			row(`${pool.map((p) => `${num(p.cost)} ${Z(p, t)}`).join(' + ')}${valueTerms}${bankPrev} <= ${num((t === 0 ? req.bank : 0) + constant)}`);
			// The real squad doesn't change in a Free Hit week.
			row(`${terms(pool.map((p) => B(p, t)))} + ${squadN} fh_${t} <= ${squadN}`);
		}

		// Starting XI
		row(`${terms(pool.map((p) => Y(p, t)))} = ${rules.startingXi}`);
		for (const [pos, pr] of Object.entries(rules.positions)) {
			const ys = terms(pool.filter((p) => p.pos === +pos).map((p) => Y(p, t)));
			row(`${ys} >= ${pr.minPlay}`);
			row(`${ys} <= ${pr.maxPlay}`);
		}
		row(`${terms(pool.map((p) => C(p, t)))} = 1`);

		// Bank: last week's, plus sales, minus purchases; never negative.
		const flows: string[] = [];
		for (const p of pool) {
			if (owned.has(p.id)) flows.push(`- ${num(p.sell ?? p.cost)} ${SO(p, t)}`);
			flows.push(`- ${num(p.cost)} ${SN(p, t)}`);
			flows.push(`+ ${num(p.cost)} ${B(p, t)}`);
		}
		row(`bank_${t} ${t === 0 ? '' : `- bank_${t - 1} `}${flows.join(' ')} = ${t === 0 ? num(req.bank) : 0}`.replace(/\s+/g, ' '));
		bounds.push(` bank_${t} >= 0`);

		// Transfers, free transfers and hits
		const nt = terms(pool.map((p) => B(p, t)));
		const chipT = [WC.has(t) ? `wc_${t}` : '', FH.has(t) ? `fh_${t}` : ''].filter(Boolean);
		generals.push(`ft_${t}`, `u_${t}`, `h_${t}`);
		bounds.push(` 0 <= ft_${t} <= ${maxFt}`, ` 0 <= u_${t} <= ${maxFt}`, ` 0 <= h_${t} <= ${squadN}`);
		if (t === 0) row(`ft_0 = ${Math.min(req.freeTransfers, maxFt)}`);
		row(`u_${t} - ft_${t} <= 0`);
		row(`u_${t} - ${pool.map((p) => B(p, t)).join(' - ')} <= 0`);
		// hits >= transfers - free ones used (a Wildcard makes them all free)
		row(`${nt} - u_${t} - h_${t}${chipT.map((c) => ` - ${squadN} ${c}`).join('')} <= 0`);
		// chip weeks use no free transfers (they're kept)
		if (chipT.length) row(`u_${t}${chipT.map((c) => ` + ${maxFt} ${c}`).join('')} <= ${maxFt}`);
		if (req.maxTransfersPerWeek !== undefined) {
			row(`${nt}${WC.has(t) ? ` - ${squadN} wc_${t}` : ''} <= ${req.maxTransfersPerWeek}`);
		}
		if (t + 1 < T) row(`ft_${t + 1} - ft_${t} + u_${t}${chipT.map((c) => ` + ${c}`).join('')} <= 1`);
		obj.push(`- ${num(rules.hitCost)} h_${t}`);

		// One chip a week
		const cw = [WC.has(t) && `wc_${t}`, FH.has(t) && `fh_${t}`, BB.has(t) && `bb_${t}`, TC.has(t) && `tc_${t}`].filter(Boolean) as string[];
		for (const c of cw) binaries.push(c);
		if (cw.length > 1) row(`${cw.join(' + ')} <= 1`);
	}
	// Each chip at most once (exactly once if it must be used)
	for (const [name, tag] of [['wildcard', 'wc'], ['freehit', 'fh'], ['bboost', 'bb'], ['3xc', 'tc']] as const) {
		const spec = chips[name];
		if (!spec || !spec.weeks.length) continue;
		row(`${spec.weeks.map((t) => `${tag}_${t}`).join(' + ')} ${spec.mustUse ? '=' : '<='} 1`);
	}
	// Ruled-out plans (for alternatives): not all of the same buys again.
	for (const plan of req.excludePlans ?? []) {
		if (!plan.length) { row(`${terms(pool.flatMap((p) => weights.map((_, t) => B(p, t))))} >= 1`); continue; }
		const byId = new Map(pool.map((p) => [p.id, p]));
		row(`${plan.map(({ t, id }) => B(byId.get(id)!, t)).join(' + ')} <= ${plan.length - 1}`);
	}

	const lp = [
		'Maximize',
		` obj: ${obj.join(' + ').replace(/\+ -/g, '- ')}`,
		'Subject To',
		...rows,
		' fixzero: zero = 0',
		'Bounds',
		...bounds,
		' zero = 0',
		'Generals',
		' ' + generals.join(' '),
		'Binaries',
		' ' + binaries.join(' '),
		'End'
	].join('\n');
	return { lp, variables: binaries.length + generals.length + T + 1, constraints: r, pool };
}

export function solveMultiWeek(highs: HighsLike, req: MultiRequest): MultiResult {
	const t0 = performance.now();
	const { lp, variables, constraints, pool } = buildMultiModel(req);
	const t1 = performance.now();
	const res = highs.solve(lp, {
		output_flag: false,
		mip_rel_gap: 0,
		mip_abs_gap: 1e-9,
		...(req.timeLimitSeconds ? { time_limit: req.timeLimitSeconds } : {})
	});
	const t2 = performance.now();
	const T = req.weights.length;
	const col = (n: string) => res.Columns?.[n]?.Primal ?? 0;
	const on = (n: string) => col(n) > 0.5;
	const owned = new Set(req.squadIds);
	const weeks: MultiWeek[] = [];
	const buys: { t: number; id: number }[] = [];
	let prev = new Set(req.squadIds);
	for (let t = 0; t < T; t++) {
		const chip: ChipName | null = on(`wc_${t}`) ? 'wildcard' : on(`fh_${t}`) ? 'freehit' : on(`bb_${t}`) ? 'bboost' : on(`tc_${t}`) ? '3xc' : null;
		const squadNow = new Set(pool.filter((p) => on(`x${p.id}_${t}`)).map((p) => p.id));
		const ins = [...squadNow].filter((id) => !prev.has(id));
		const outs = [...prev].filter((id) => !squadNow.has(id));
		for (const id of ins) buys.push({ t, id });
		const byId = new Map(pool.map((p) => [p.id, p]));
		const left = [...ins];
		const transfers = outs.map((o) => {
			const k = left.findIndex((i) => byId.get(i)!.pos === byId.get(o)!.pos);
			return { out: o, in: k >= 0 ? left.splice(k, 1)[0] : NaN };
		});
		const plays = chip === 'freehit' ? pool.filter((p) => on(`z${p.id}_${t}`)).map((p) => p.id) : [...squadNow];
		weeks.push({
			t, transfers, chip,
			squad: plays,
			starters: pool.filter((p) => on(`y${p.id}_${t}`)).map((p) => p.id),
			captain: pool.find((p) => on(`c${p.id}_${t}`))?.id ?? NaN,
			bank: Math.round(col(`bank_${t}`)),
			freeTransfers: Math.round(col(`ft_${t}`)),
			hits: Math.round(col(`h_${t}`)) * req.rules.hitCost
		});
		prev = squadNow;
	}
	void owned;
	const gap = res.Status === 'Optimal' ? 0 : typeof res.MipGap === 'number' ? res.MipGap : null;
	return {
		status: res.Status,
		objective: res.ObjectiveValue,
		gap,
		weeks,
		buys,
		timings: { buildMs: t1 - t0, solveMs: t2 - t1 },
		modelSize: { variables, constraints }
	};
}
