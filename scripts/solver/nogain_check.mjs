// The no-gain filter on the fixture: depth-3 lists with and without it.
import { readFileSync } from 'node:fs';
import { rankedSearch } from '../../src/lib/solver/ranked-search.ts';
const fx = JSON.parse(readFileSync(new URL('../../../fpl_project/bench/fixture_403851.json', import.meta.url), 'utf8'));
const gi = new Map(fx.gws.map((g, i) => [g, i]));
const players = fx.players.map((p) => { const proj = new Float64Array(fx.gws.length); for (const [g, v] of p.proj) if (gi.has(g)) proj[gi.get(g)] = v; return { ...p, proj, hasProj: p.proj.length > 0 }; });
const by = new Map(players.map((p) => [p.id, p.name]));
const rules = { squadSize: 15, startingXi: 11, clubLimit: 3, positions: { 1: { squad: 2, minPlay: 1, maxPlay: 1 }, 2: { squad: 5, minPlay: 3, maxPlay: 5 }, 3: { squad: 5, minPlay: 2, maxPlay: 5 }, 4: { squad: 3, minPlay: 1, maxPlay: 3 } }, hitCost: 4, captainMultiplier: 2 };
const base = { players, squadIds: fx.squad_ids, bank: fx.bank, freeTransfers: fx.free_transfers, weights: fx.weights, rules, maxTransfers: 3, topN: 8 };
for (const hide of [false, true]) {
	const t = performance.now();
	const r = rankedSearch({ ...base, hideNoGain: hide });
	console.log(`\nhideNoGain=${hide} (${((performance.now() - t) / 1000).toFixed(1)}s)`);
	for (const d of [1, 2, 3]) { console.log(` depth ${d}: ${r.byDepth[d].length} plans`); r.byDepth[d].slice(0, 4).forEach((p) => console.log(`   ${p.net.toFixed(2)} (squad ${p.twxp.toFixed(2)})  ${p.transfers.map((t) => by.get(t.out) + '→' + by.get(t.in)).join(', ')}`)); }
}

// Grouping of equal-score swaps inside the search: top 5 rows at depth 3.
for (const n of [5, 20]) {
	const t = performance.now();
	const g = rankedSearch({ ...base, topN: n, groupTies: true }).byDepth[3];
	console.log(`\ngroupTies top ${n}: ${((performance.now() - t) / 1000).toFixed(1)}s, ${g.length} rows`);
	for (const p of g.slice(0, 6)) console.log(`  ${p.net.toFixed(2)}  ${p.transfers.map((t) => by.get(t.out) + '→' + by.get(t.in)).join(', ')}${p.alts ? `  [or ${p.alts.length} others for ${by.get(p.slotIn)}]` : ''}`);
}
