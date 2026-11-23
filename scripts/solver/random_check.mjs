// Randomised cross-check: HiGHS solver vs exhaustive search on many small
// instances cut from the frozen fixture (random squad, bank, free transfers
// and a random subset of the market), up to 3 transfers.
//
//   node scripts/solver/random_check.mjs [cases=40] [perPos=12] [seed=1]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import loadHighs from 'highs';
import { solve, squadTwxp } from '../../src/lib/solver/fpl-solver.ts';
import { rankedSearch, hasNoGainTransfer } from '../../src/lib/solver/ranked-search.ts';

const [cases = 40, perPos = 12, seed0 = 1] = process.argv.slice(2).map(Number);
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(path.resolve(here, '../../../fpl_project/bench/fixture_403851.json'), 'utf8'));
const gwIndex = new Map(fx.gws.map((g, i) => [g, i]));
const all = fx.players.map((p) => {
	const proj = new Float64Array(fx.gws.length);
	for (const [g, v] of p.proj) if (gwIndex.has(g)) proj[gwIndex.get(g)] = v;
	return { id: p.id, name: p.name, pos: p.pos, team: p.team, cost: p.cost, sell: p.cost, proj, hasProj: p.proj.length > 0 };
});

// Fixed rules (same as live 2026/27) so this runs offline.
const rules = {
	squadSize: 15, startingXi: 11, clubLimit: 3, maxBankedFreeTransfers: 5, sellOnFee: 0.5,
	positions: { 1: { squad: 2, minPlay: 1, maxPlay: 1, name: 'GKP' }, 2: { squad: 5, minPlay: 3, maxPlay: 5, name: 'DEF' }, 3: { squad: 5, minPlay: 2, maxPlay: 5, name: 'MID' }, 4: { squad: 3, minPlay: 1, maxPlay: 3, name: 'FWD' } },
	hitCost: 4, captainMultiplier: 2
};
const NEED = { 1: 2, 2: 5, 3: 5, 4: 3 };

let seed = seed0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function randomSquad() {
	const club = new Map(); const squad = [];
	for (const pos of [1, 2, 3, 4]) {
		for (const p of shuffle(all.filter((q) => q.pos === pos))) {
			if (squad.filter((q) => q.pos === pos).length === NEED[pos]) break;
			if ((club.get(p.team) ?? 0) >= 3) continue;
			club.set(p.team, (club.get(p.team) ?? 0) + 1); squad.push(p);
		}
	}
	return squad;
}

function* combinations(arr, k, start = 0, acc = []) {
	if (acc.length === k) { yield acc; return; }
	for (let i = start; i < arr.length; i++) yield* combinations(arr, k, i + 1, [...acc, arr[i]]);
}
function* product(lists, i = 0, acc = []) {
	if (i === lists.length) { yield acc; return; }
	for (const p of lists[i]) yield* product(lists, i + 1, [...acc, p]);
}

/** Best net for exactly `depth` transfers, or null if none is legal. */
function bruteBest(squad, market, bank, ft, weights, depth) {
	const base = squadTwxp(squad, weights);
	const cands = { 1: [], 2: [], 3: [], 4: [] };
	for (const p of market) cands[p.pos].push(p);
	const hit = Math.max(0, depth - ft) * 4;
	let best = null;
	const seen = new Map(), seenF = new Map();
	for (const outs of combinations(squad, depth)) {
		const budget = bank + outs.reduce((s, p) => s + p.sell, 0);
		const kept = squad.filter((p) => !outs.includes(p));
		const keptClub = new Map();
		for (const p of kept) keptClub.set(p.team, (keptClub.get(p.team) ?? 0) + 1);
		for (const ins of product(outs.map((o) => cands[o.pos]))) {
			if (new Set(ins.map((p) => p.id)).size !== depth) continue;
			if (ins.reduce((s, p) => s + p.cost, 0) > budget) continue;
			const cc = new Map(keptClub); let ok = true;
			for (const p of ins) { const n = (cc.get(p.team) ?? 0) + 1; cc.set(p.team, n); if (n > 3) { ok = false; break; } }
			if (!ok) continue;
			const net = squadTwxp(kept.concat(ins), weights) - base - hit;
			if (best === null || net > best) best = net;
			const k = ins.map((p) => p.id).sort((a, b) => a - b).join(',') + '|' + Number(net.toFixed(2));
			if (!seen.has(k) || net > seen.get(k)) seen.set(k, net);
			const tw = net + base + hit;
			const spent = ins.reduce((s, p) => s + p.cost, 0);
			if (!hasNoGainTransfer(kept, outs, ins, tw, budget, spent, weights, 3) && (!seenF.has(k) || net > seenF.get(k))) seenF.set(k, net);
		}
	}
	bruteBest.lastRanked = [...seen.values()].sort((a, b) => b - a);
	bruteBest.lastFiltered = [...seenF.values()].sort((a, b) => b - a);
	return best;
}

const highs = await loadHighs();
let fails = 0, checks = 0;
const t0 = performance.now();
for (let n = 0; n < cases; n++) {
	const squad = randomSquad();
	const owned = new Set(squad.map((p) => p.id));
	// Owned players may have sold for less than current price.
	for (const p of squad) p.sell = p.cost - Math.floor(rand() * 4);
	const market = [];
	for (const pos of [1, 2, 3, 4]) market.push(...shuffle(all.filter((p) => p.pos === pos && !owned.has(p.id) && p.hasProj)).slice(0, perPos));
	const bank = Math.floor(rand() * 40);
	const ft = 1 + Math.floor(rand() * 5);
	const weights = fx.weights;
	const req = { players: [...squad, ...market], squadIds: squad.map((p) => p.id), bank, freeTransfers: ft, weights, rules };
	const bf = [0];
	const ranked = rankedSearch({ ...req, maxTransfers: 3, topN: 8 });
	const rankedF = rankedSearch({ ...req, maxTransfers: 3, topN: 8, hideNoGain: true });
	for (const d of [1, 2, 3]) {
		const want = bruteBest(squad, market, bank, ft, weights, d);
		bf.push(want);
		const wantList = bruteBest.lastRanked.slice(0, 8), gotList = ranked.byDepth[d].map((p) => p.net);
		checks++;
		if (wantList.length !== gotList.length || wantList.some((v, k) => Math.abs(v - gotList[k]) > 1e-9)) { fails++; console.log(`FAIL case ${n} ranked depth ${d}: brute ${wantList.map((v) => v.toFixed(3))} vs ranked ${gotList.map((v) => v.toFixed(3))}`); }
		const wantF = bruteBest.lastFiltered.slice(0, 8), gotF = rankedF.byDepth[d].map((p) => p.net);
		checks++;
		if (wantF.length !== gotF.length || wantF.some((v, k) => Math.abs(v - gotF[k]) > 1e-9)) { fails++; console.log(`FAIL case ${n} filtered depth ${d}: brute ${wantF.map((v) => v.toFixed(3))} vs ranked ${gotF.map((v) => v.toFixed(3))}`); }
		const r = solve(highs, { ...req, transfers: { exactly: d } });
		checks++;
		const ok = want === null ? r.status === 'Infeasible' : r.status === 'Optimal' && Math.abs(r.net - want) < 1e-9 && Math.abs(r.solverObjective - r.baseTwxp - r.net) < 1e-6;
		if (!ok) { fails++; console.log(`FAIL case ${n} depth ${d}: brute ${want}, solver ${r.status} ${r.net} (obj ${r.solverObjective - r.baseTwxp})`); }
	}
	const r = solve(highs, { ...req, transfers: { atMost: 3 } });
	const want = Math.max(...bf.filter((v) => v !== null));
	checks++;
	if (!(r.status === 'Optimal' && Math.abs(r.net - want) < 1e-9)) { fails++; console.log(`FAIL case ${n} atMost 3: brute ${want}, solver ${r.net}`); }
}
console.log(`${checks - fails}/${checks} checks matched across ${cases} random cases (${perPos} market players per position) in ${((performance.now() - t0) / 1000).toFixed(0)}s.`);
process.exit(fails ? 1 : 0);
