// Ranked search vs the brute force's top-20 lists on the frozen fixture,
// then timings at 3 and 4 transfers.
//   node scripts/solver/rank_check.mjs [maxDepth=3]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rankedSearch } from '../../src/lib/solver/ranked-search.ts';

const maxDepth = Number(process.argv[2] ?? 3);
const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.resolve(here, '../../../fpl_project/bench');
const fx = JSON.parse(readFileSync(path.join(bench, 'fixture_403851.json'), 'utf8'));
const ref = JSON.parse(readFileSync(path.join(bench, 'result_py.json'), 'utf8'));
const gi = new Map(fx.gws.map((g, i) => [g, i]));
const players = fx.players.map((p) => { const proj = new Float64Array(fx.gws.length); for (const [g, v] of p.proj) if (gi.has(g)) proj[gi.get(g)] = v; return { ...p, proj, hasProj: p.proj.length > 0 }; });
const byId = new Map(players.map((p) => [p.id, p]));
const rules = { squadSize: 15, startingXi: 11, clubLimit: 3, maxBankedFreeTransfers: 5, sellOnFee: 0.5, positions: { 1: { squad: 2, minPlay: 1, maxPlay: 1 }, 2: { squad: 5, minPlay: 3, maxPlay: 5 }, 3: { squad: 5, minPlay: 2, maxPlay: 5 }, 4: { squad: 3, minPlay: 1, maxPlay: 3 } }, hitCost: 4, captainMultiplier: 2 };
const req = { players, squadIds: fx.squad_ids, bank: fx.bank, freeTransfers: fx.free_transfers, weights: fx.weights, rules, topN: 20 };
const name = (id) => byId.get(id).name;
const key = (moves) => moves.map(([o, i]) => `${o}>${i}`).sort().join(',');

let fails = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };

const r2 = rankedSearch({ ...req, maxTransfers: 2 });
console.log(`Depth 1–2 ranked search: ${(r2.stats.ms / 1000).toFixed(2)}s, ${r2.stats.leaves} squads scored, ${r2.stats.bounds} bounds (brute force scores 1,549,062)`);
check(r2.baseTwxp === ref.base, `base ${r2.baseTwxp}`);
for (const d of [1, 2]) {
	const want = ref.ranked.filter((m) => m.depth === d), got = r2.byDepth[d];
	check(got.length === want.length, `depth ${d}: ${got.length} plans`);
	check(got.every((p, k) => Math.abs(p.net - want[k].net) < 1e-9 && Math.abs(p.twxp - want[k].twxp) < 1e-9), `depth ${d}: every net and twxp equals the brute force, in order`);
	const same = got.filter((p, k) => key(p.transfers.map((t) => [t.out, t.in])) === key(want[k].moves)).length;
	check(same === want.length, `depth ${d}: ${same}/${want.length} identical transfers at the same rank`);
}
for (let d = 3; d <= maxDepth; d++) {
	const r = rankedSearch({ ...req, maxTransfers: d });
	console.log(`\nUp to ${d} transfers: ${(r.stats.ms / 1000).toFixed(1)}s, ${r.stats.leaves} squads scored`);
	r.byDepth[d].slice(0, 5).forEach((p, k) => console.log(`  ${k + 1}. net ${p.net.toFixed(2)}  ${p.transfers.map((t) => `${name(t.out)} → ${name(t.in)}`).join(', ')}`));
}
console.log(fails ? `\n${fails} failed` : '\nAll checks passed.');
process.exit(fails ? 1 : 0);
