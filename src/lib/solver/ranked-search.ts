/**
 * Ranked transfer search: the N best plans at each transfer count, exactly
 * as the brute force ranks them, without scoring every squad.
 *
 * It is the brute force's search (every set of players sold, every set of
 * replacements) with branch-and-bound pruning. A squad's score can only go up
 * if a player is swapped for one at least as good in every week (the best XI
 * and captain are chosen from what's there). So for any partly chosen set of
 * buys, filling the open slots with "virtual" players who score the best
 * remaining projection in every week gives an upper limit for everything in
 * that branch. If that limit can't beat the current Nth best, the branch is
 * skipped. Nothing that could make the list is ever skipped, so the result is
 * identical to the full search.
 */

import { squadTwxp, type FplRules, type SolverPlayer } from './fpl-solver.ts';

export interface RankedRequest {
	players: SolverPlayer[];
	squadIds: number[];
	bank: number;
	freeTransfers: number;
	weights: number[];
	rules: FplRules;
	maxTransfers: number;
	topN: number;
}

export interface RankedPlan {
	transfers: { out: number; in: number }[];
	squadIds: number[];
	twxp: number;
	delta: number;
	hits: number;
	net: number;
	/** brute-force enumeration order, for breaking exact ties the same way */
	seq?: number;
}

export interface RankedResult {
	baseTwxp: number;
	/** byDepth[d] = best plans with exactly d transfers, best first */
	byDepth: RankedPlan[][];
	stats: { leaves: number; bounds: number; ms: number };
}

type Virtual = { id: number; pos: number; team: number; cost: number; proj: Float64Array; hasProj: true };

function* combinations<T>(arr: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
	if (acc.length === k) { yield acc; return; }
	for (let i = start; i <= arr.length - (k - acc.length); i++) yield* combinations(arr, k, i + 1, [...acc, arr[i]]);
}

export function rankedSearch(req: RankedRequest): RankedResult {
	const t0 = performance.now();
	const { weights, rules } = req;
	const W = weights.length;
	const byId = new Map(req.players.map((p) => [p.id, p]));
	const current = req.squadIds.map((id) => byId.get(id)!);
	const base = squadTwxp(current, weights);
	const owned = new Set(req.squadIds);
	const R = Math.max(1, req.maxTransfers);

	// Candidates per position, best first (same order as the brute force).
	const cands: Record<number, SolverPlayer[]> = {};
	for (const pos of Object.keys(rules.positions).map(Number)) cands[pos] = [];
	for (const p of req.players) if (!owned.has(p.id) && p.hasProj) cands[p.pos].push(p);
	const tw = (p: SolverPlayer) => { let s = 0; for (let t = 0; t < W; t++) s += (p.proj[t] ?? 0) * weights[t]; return s; };
	for (const list of Object.values(cands)) { const m = new Map(list.map((p) => [p, tw(p)])); list.sort((a, b) => m.get(b)! - m.get(a)!); }

	// suffix[pos][i][r] = virtual player scoring, each week, the (r+1)th best
	// projection among cands[pos][i..]; minCost[pos][i] = cheapest from i on.
	let vid = -1;
	const suffix: Record<number, Virtual[][]> = {};
	const minCost: Record<number, number[]> = {};
	for (const [posS, list] of Object.entries(cands)) {
		const pos = Number(posS);
		const n = list.length;
		suffix[pos] = new Array(n + 1);
		minCost[pos] = new Array(n + 1).fill(Infinity);
		const top = Array.from({ length: R }, () => new Float64Array(W).fill(0));
		suffix[pos][n] = top.map((a) => ({ id: vid--, pos, team: -1, cost: 0, proj: a.slice(), hasProj: true }));
		for (let i = n - 1; i >= 0; i--) {
			for (let t = 0; t < W; t++) {
				let v = list[i].proj[t] ?? 0;
				for (let r = 0; r < R; r++) if (v > top[r][t]) { const tmp = top[r][t]; top[r][t] = v; v = tmp; }
			}
			suffix[pos][i] = top.map((a) => ({ id: vid--, pos, team: -1, cost: 0, proj: a.slice(), hasProj: true }));
			minCost[pos][i] = Math.min(list[i].cost, minCost[pos][i + 1]);
		}
	}

	const byDepth: RankedPlan[][] = [[{ transfers: [], squadIds: [...req.squadIds], twxp: base, delta: 0, hits: 0, net: 0 }]];
	let leaves = 0, bounds = 0;

	for (let depth = 1; depth <= req.maxTransfers; depth++) {
		const hits = Math.max(0, depth - req.freeTransfers) * rules.hitCost;
		const best: RankedPlan[] = [];
		const threshold = () => (best.length < req.topN ? -Infinity : best[best.length - 1].net);
		const record = (plan: RankedPlan) => {
			// Same as the brute force: plans with the same incoming players and the
			// same net (to 2dp), e.g. selling either of two unused bench players,
			// count once, keeping the first unless a later one is strictly better.
			const key = (p: RankedPlan) => p.transfers.map((t) => t.in).sort((a, b) => a - b).join(',') + '|' + String(Number(p.net.toFixed(2)));
			const k0 = key(plan);
			const dup = best.findIndex((b) => key(b) === k0);
			const before = (a: RankedPlan, b: RankedPlan) => a.net > b.net || (a.net === b.net && (a.delta > b.delta || (a.delta === b.delta && a.seq! < b.seq!)));
			if (dup >= 0) { if (plan.net > best[dup].net || (plan.net === best[dup].net && plan.seq! < best[dup].seq!)) best.splice(dup, 1); else return; }
			// Same order as the brute force: net, then delta (insertion order on ties).
			let k = best.length;
			while (k > 0 && before(plan, best[k - 1])) k--;
			best.splice(k, 0, plan);
			if (best.length > req.topN) best.pop();
		};

		const ordered = [...combinations(current, depth)];
		const rootBound = new Map<SolverPlayer[], number>();
		const outIndex = new Map(ordered.map((o, i) => [o, i]));
		const searchOne = (outs: SolverPlayer[], onlyBound: boolean): number => {
			let leafNo = 0;
			const budget = req.bank + outs.reduce((s, p) => s + (p.sell ?? p.cost), 0);
			const outSet = new Set(outs);
			const kept = current.filter((p) => !outSet.has(p));
			const keptClub = new Map<number, number>();
			for (const p of kept) keptClub.set(p.team, (keptClub.get(p.team) ?? 0) + 1);
			// Slots to fill, grouped by position.
			const need = new Map<number, number>();
			for (const p of outs) need.set(p.pos, (need.get(p.pos) ?? 0) + 1);
			const groups = [...need.entries()]; // [pos, count]

			const chosen: SolverPlayer[] = [];
			const club = new Map(keptClub);
			let spent = 0;

			// Upper bound for this branch: kept + chosen + a virtual player for each
			// open slot scoring, each week, the best projections among candidates
			// that slot could still afford. Swapping for someone at least as good
			// every week never lowers a squad's score, so nothing below can beat it.
			const virtual = (pos: number, from: number, count: number, maxCost: number, into: SolverPlayer[]) => {
				const list = cands[pos];
				const top = Array.from({ length: count }, () => new Float64Array(W));
				for (let i = from; i < list.length; i++) {
					if (list[i].cost > maxCost) continue;
					const pr = list[i].proj;
					for (let t = 0; t < W; t++) {
						let v = pr[t] ?? 0;
						for (let r = 0; r < count; r++) if (v > top[r][t]) { const tmp = top[r][t]; top[r][t] = v; v = tmp; }
					}
				}
				for (const a of top) into.push({ id: vid--, pos, team: -1, cost: 0, proj: a, hasProj: true });
			};
			const bound = (g: number, inGroup: number, from: number) => {
				const squad: SolverPlayer[] = kept.concat(chosen);
				const left = budget - spent - cheapestRest(g, inGroup, from);
				const [pos, cnt] = groups[g];
				if (cnt > inGroup) virtual(pos, from, cnt - inGroup, left + minCost[pos][from], squad);
				for (let h = g + 1; h < groups.length; h++) {
					const [p2, c2] = groups[h];
					virtual(p2, 0, c2, left + minCost[p2][0], squad);
				}
				bounds++;
				return squadTwxp(squad, weights) - base - hits;
			};
			const cheapestRest = (g: number, inGroup: number, from: number) => {
				const [pos, cnt] = groups[g];
				let c = cnt > inGroup ? (cnt - inGroup) * minCost[pos][from] : 0;
				for (let h = g + 1; h < groups.length; h++) c += groups[h][1] * minCost[groups[h][0]][0];
				return c;
			};

			const dfs = (g: number, inGroup: number, from: number) => {
				if (g === groups.length) {
					leaves++; leafNo++;
					const twxp = squadTwxp(kept.concat(chosen), weights);
					const net = twxp - base - hits;
					if (net < threshold()) return;
					const ins = [...chosen];
					// Pair outs and ins by position for display (same position, in order).
					const left = [...ins];
					const transfers = outs.map((o) => ({ out: o.id, in: left.splice(left.findIndex((i) => i.pos === o.pos), 1)[0].id }));
					record({ transfers, squadIds: kept.map((p) => p.id).concat(ins.map((p) => p.id)), twxp, delta: twxp - base, hits, net, seq: outIndex.get(outs)! * 1e9 + leafNo });
					return;
				}
				const [pos, cnt] = groups[g];
				if (inGroup === cnt) { dfs(g + 1, 0, 0); return; }
				if (spent + cheapestRest(g, inGroup, from) > budget) return;
				if (bound(g, inGroup, from) < threshold()) return;
				const list = cands[pos];
				for (let i = from; i <= list.length - (cnt - inGroup); i++) {
					const p = list[i];
					const n = (club.get(p.team) ?? 0) + 1;
					if (n > rules.clubLimit) continue;
					// Can't afford p plus the cheapest fill of the other open slots: skip p
					// (a later, lower-ranked candidate may be cheaper, so keep scanning).
					if (spent + p.cost + cheapestRest(g, inGroup + 1, i + 1) > budget) continue;
					club.set(p.team, n); chosen.push(p); spent += p.cost;
					dfs(g, inGroup + 1, i + 1);
					club.set(p.team, n - 1); chosen.pop(); spent -= p.cost;
				}
			};
			if (onlyBound) return groups.length ? bound(0, 0, 0) : -Infinity;
			dfs(0, 0, 0);
			return 0;
		};
		// Most promising sales first, so the bar for the top N rises quickly.
		for (const outs of ordered) rootBound.set(outs, searchOne(outs, true));
		ordered.sort((a, b) => rootBound.get(b)! - rootBound.get(a)!);
		for (const outs of ordered) {
			if (rootBound.get(outs)! < threshold()) break; // sorted, so none of the rest can make the list
			searchOne(outs, false);
		}
		byDepth.push(best);
	}
	return { baseTwxp: base, byDepth, stats: { leaves, bounds, ms: performance.now() - t0 } };
}
