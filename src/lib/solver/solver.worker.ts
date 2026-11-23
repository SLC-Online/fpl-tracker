/// <reference lib="webworker" />
/**
 * Runs the transfer search off the main thread so the page never freezes.
 *
 * Up to 3 transfers: the exact ranked search (same answers as the brute
 * force). 4-5 transfers and the wildcard: HiGHS proves the best plan, then
 * re-solves with each found squad ruled out to get the next best, in order.
 * Results are posted as each part finishes.
 */
import { rankedSearch, hasNoGainTransfer, type RankedPlan } from './ranked-search';
import { solve, squadTwxp, type FplRules, type SolverPlayer } from './fpl-solver';

export interface WorkerPlayer { id: number; pos: number; team: number; cost: number; sell?: number; proj: number[]; hasProj: boolean }

export interface RunRequest {
	type: 'run';
	players: WorkerPlayer[];
	squadIds: number[];
	bank: number;
	freeTransfers: number;
	weights: number[];
	rules: FplRules;
	maxTransfers: number;   // 0-5
	topN: number;
	wildcard: boolean;
	hideNoGain: boolean;
}

export interface WorkerPlan extends RankedPlan { proven: boolean }

export type WorkerMessage =
	| { type: 'calibration'; msPerUnit: number }
	| { type: 'stage'; label: string }
	| { type: 'depth'; depth: number; plans: WorkerPlan[]; ms: number }
	| { type: 'wildcard'; plans: WorkerPlan[]; ms: number }
	| { type: 'done'; ms: number }
	| { type: 'error'; message: string };

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

let highsPromise: Promise<any> | null = null;
async function getHighs() {
	if (!highsPromise) {
		highsPromise = (async () => {
			const [{ default: loadHighs }, { default: wasmUrl }] = await Promise.all([
				import('highs'),
				import('highs/runtime?url')
			]);
			return loadHighs({ locateFile: () => wasmUrl });
		})();
	}
	return highsPromise;
}

/** A fixed piece of work (scoring 20,000 squads) to gauge this device's speed. */
function calibrate(players: SolverPlayer[], squadIds: number[], weights: number[]) {
	const byId = new Map(players.map((p) => [p.id, p]));
	const squad = squadIds.map((id) => byId.get(id)!);
	const t = performance.now();
	let sink = 0;
	for (let i = 0; i < 20000; i++) sink += squadTwxp(squad, weights);
	if (sink === -1) console.log(sink);
	return (performance.now() - t) / 20000;
}

const key = (p: RankedPlan) => p.transfers.map((t) => t.in).sort((a, b) => a - b).join(',') + '|' + String(Number(p.net.toFixed(2)));

function mipRanked(highs: any, req: RunRequest, players: SolverPlayer[], transfers: { exactly: number } | 'wildcard'): WorkerPlan[] {
	const byId = new Map(players.map((p) => [p.id, p]));
	const owned = new Set(req.squadIds);
	const plans: WorkerPlan[] = [];
	const seen = new Set<string>();
	const exclude: number[][] = [];
	const maxSolves = req.topN * 4 + 4;
	for (let k = 0; k < maxSolves && plans.length < req.topN; k++) {
		const r = solve(highs, {
			players, squadIds: req.squadIds, bank: req.bank, freeTransfers: req.freeTransfers,
			weights: req.weights, rules: req.rules, transfers, exclude, timeLimitSeconds: 120
		});
		if (r.squadIds.length !== req.rules.squadSize) break;
		exclude.push(r.squadIds);
		const plan: WorkerPlan = {
			transfers: r.transfers, squadIds: r.squadIds, twxp: r.twxp, delta: r.delta,
			hits: r.hits, net: r.net, proven: r.status === 'Optimal'
		};
		if (transfers !== 'wildcard') {
			const outs = r.transfers.map((t) => byId.get(t.out)!);
			const ins = r.squadIds.filter((id) => !owned.has(id)).map((id) => byId.get(id)!);
			const kept = req.squadIds.filter((id) => r.squadIds.includes(id)).map((id) => byId.get(id)!);
			const budget = req.bank + outs.reduce((s, p) => s + (p.sell ?? p.cost), 0);
			const spent = ins.reduce((s, p) => s + p.cost, 0);
			if (req.hideNoGain && hasNoGainTransfer(kept, outs, ins, r.twxp, budget, spent, req.weights, req.rules.clubLimit)) continue;
			// Same incoming players and the same score count once, as in the ranked search.
			if (seen.has(key(plan))) continue;
			seen.add(key(plan));
		}
		plans.push(plan);
		if (r.status !== 'Optimal') break; // time limit: what we have is unproven
	}
	return plans;
}

self.onmessage = async (ev: MessageEvent<RunRequest>) => {
	const req = ev.data;
	if (req.type !== 'run') return;
	const t0 = performance.now();
	try {
		const players: SolverPlayer[] = req.players.map((p) => ({ ...p, proj: Float64Array.from(p.proj) }));
		post({ type: 'calibration', msPerUnit: calibrate(players, req.squadIds, req.weights) });

		const ranked = Math.min(3, req.maxTransfers);
		if (ranked >= 1) {
			post({ type: 'stage', label: ranked === 3 ? 'Searching 1–3 transfers' : `Searching 1–${ranked} transfers` });
			let tDepth = performance.now();
			rankedSearch({
				players, squadIds: req.squadIds, bank: req.bank, freeTransfers: req.freeTransfers,
				weights: req.weights, rules: req.rules, maxTransfers: ranked, topN: req.topN,
				// With no-gain plans shown, equal-score swaps of one player join
				// one row instead of filling the list.
				groupTies: !req.hideNoGain,
				hideNoGain: req.hideNoGain,
				onDepth: (depth, plans) => {
					post({ type: 'depth', depth, plans: plans.map((p) => ({ ...p, proven: true })), ms: performance.now() - tDepth });
					tDepth = performance.now();
				}
			});
		}
		if (req.maxTransfers > 3 || req.wildcard) {
			post({ type: 'stage', label: 'Loading the solver' });
			const highs = await getHighs();
			for (let d = 4; d <= req.maxTransfers; d++) {
				post({ type: 'stage', label: `Solving ${d} transfers` });
				const t = performance.now();
				post({ type: 'depth', depth: d, plans: mipRanked(highs, req, players, { exactly: d }), ms: performance.now() - t });
			}
			if (req.wildcard) {
				post({ type: 'stage', label: 'Solving the wildcard' });
				const t = performance.now();
				post({ type: 'wildcard', plans: mipRanked(highs, req, players, 'wildcard'), ms: performance.now() - t });
			}
		}
		post({ type: 'done', ms: performance.now() - t0 });
	} catch (e: any) {
		post({ type: 'error', message: e?.message ?? String(e) });
	}
};
