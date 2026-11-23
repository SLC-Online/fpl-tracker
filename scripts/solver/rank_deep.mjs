import { readFileSync } from 'node:fs';
import { rankedSearch } from '../../src/lib/solver/ranked-search.ts';
const fx = JSON.parse(readFileSync(new URL('../../../fpl_project/bench/fixture_403851.json', import.meta.url), 'utf8'));
const gi = new Map(fx.gws.map((g, i) => [g, i]));
const players = fx.players.map((p) => { const proj = new Float64Array(fx.gws.length); for (const [g, v] of p.proj) if (gi.has(g)) proj[gi.get(g)] = v; return { ...p, proj, hasProj: p.proj.length > 0 }; });
const rules = { squadSize: 15, startingXi: 11, clubLimit: 3, positions: { 1: { squad: 2, minPlay: 1, maxPlay: 1 }, 2: { squad: 5, minPlay: 3, maxPlay: 5 }, 3: { squad: 5, minPlay: 2, maxPlay: 5 }, 4: { squad: 3, minPlay: 1, maxPlay: 3 } }, hitCost: 4, captainMultiplier: 2 };
const d = Number(process.argv[2]), n = Number(process.argv[3] ?? 20);
const r = rankedSearch({ players, squadIds: fx.squad_ids, bank: fx.bank, freeTransfers: fx.free_transfers, weights: fx.weights, rules, maxTransfers: d, topN: n });
console.log(`up to ${d}, top ${n}: ${(r.stats.ms / 1000).toFixed(1)}s, ${r.stats.leaves} leaves, best ${r.byDepth[d][0]?.net.toFixed(4)}`);
