// Checks the HiGHS solver against the brute-force reference on the frozen
// fixture, then times deeper searches the brute force can't reach.
//
//   node scripts/solver/bench_solver.mjs [--deep]
//
// Fixture and reference results live in fpl_project/bench (made by
// make_fixture.py and bench_py.py).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import loadHighs from 'highs';
import { rulesFromBootstrap, checkRuleChanges, solve, solveRanked } from '../../src/lib/solver/fpl-solver.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const benchDir = path.resolve(here, '../../../fpl_project/bench');
const fx = JSON.parse(readFileSync(path.join(benchDir, 'fixture_403851.json'), 'utf8'));
const ref = JSON.parse(readFileSync(path.join(benchDir, 'result_py.json'), 'utf8'));

const gwIndex = new Map(fx.gws.map((g, i) => [g, i]));
const players = fx.players.map((p) => {
	const proj = new Float64Array(fx.gws.length);
	for (const [g, v] of p.proj) if (gwIndex.has(g)) proj[gwIndex.get(g)] = v;
	return { id: p.id, name: p.name, pos: p.pos, team: p.team, cost: p.cost, sell: p.sell, proj, hasProj: p.proj.length > 0 };
});
const byId = new Map(players.map((p) => [p.id, p]));

const bs = await (await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
	headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) FPL Sorted solver test' }
})).json();
const changes = checkRuleChanges(bs);
console.log(changes.length ? `Rule changes since testing: ${JSON.stringify(changes)}` : 'FPL rules match the tested settings.');
const rules = rulesFromBootstrap(bs);

const highs = await loadHighs();
const base = { players, squadIds: fx.squad_ids, bank: fx.bank, freeTransfers: fx.free_transfers, weights: fx.weights, rules };

const name = (id) => byId.get(id)?.name ?? `#${id}`;
const show = (r) => r.transfers.map((t) => `${name(t.out)} → ${name(t.in)}`).join(', ') || '(no transfers)';
const key = (moves) => moves.map(([o, i]) => `${o}>${i}`).sort().join(',');

function run(label, transfers, extra = {}) {
	const r = solve(highs, { ...base, transfers, ...extra });
	console.log(`\n${label}: ${r.status} in ${(r.timings.solveMs / 1000).toFixed(2)}s (build ${r.timings.buildMs.toFixed(0)}ms, ${r.modelSize.variables} vars, ${r.modelSize.constraints} rows)`);
	console.log(`  ${show(r)}`);
	console.log(`  twxp ${r.twxp.toFixed(4)}  delta ${r.delta.toFixed(4)}  hits ${r.hits}  net ${r.net.toFixed(4)}  | solver objective - base - net = ${(r.solverObjective - r.baseTwxp - r.net).toExponential(2)}`);
	return r;
}

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

console.log(`Base TWxP ${squadBase()}  (reference ${ref.base})`);
function squadBase() { return solve(highs, { ...base, transfers: { exactly: 0 } }).baseTwxp; }

for (const depth of [1, 2]) {
	const r = run(`Exactly ${depth}`, { exactly: depth });
	const best = ref.ranked.filter((m) => m.depth === depth).sort((a, b) => b.net - a.net)[0];
	const moves = r.transfers.map((t) => [t.out, t.in]);
	check(key(moves) === key(best.moves), `same transfers as brute force (${best.moves.map(([o, i]) => `${name(o)} → ${name(i)}`).join(', ')})`);
	check(Math.abs(r.twxp - best.twxp) < 1e-9, `twxp ${r.twxp} vs ${best.twxp}`);
	check(Math.abs(r.net - best.net) < 1e-9, `net ${r.net} vs ${best.net}`);
}
const r2 = run('At most 2', { atMost: 2 });
const bestAny = ref.ranked.sort((a, b) => b.net - a.net)[0];
check(Math.abs(r2.net - bestAny.net) < 1e-9, `best of 0–2 transfers net ${r2.net} vs ${bestAny.net}`);

// Solver alternatives (re-solve excluding squads found): the brute force's top 5, in order.
const squadKey = (ids) => [...ids].sort((a, b) => a - b).join(',');
const refSquad = (moves) => {
	const outs = new Set(moves.map(([o]) => o));
	return squadKey([...fx.squad_ids.filter((id) => !outs.has(id)), ...moves.map(([, i]) => i)]);
};
for (const depth of [1, 2]) {
	const want = ref.ranked.filter((m) => m.depth === depth).slice(0, 5);
	const t = performance.now();
	const got = solveRanked(highs, { ...base, transfers: { exactly: depth } }, want.length);
	const secs = (performance.now() - t) / 1000;
	console.log(`\nTop ${want.length} at exactly ${depth}: ${secs.toFixed(2)}s (${(secs / got.length).toFixed(2)}s each)`);
	for (let k = 0; k < Math.min(5, got.length); k++) console.log(`  ${k + 1}. ${show(got[k])}  net ${got[k].net.toFixed(2)}`);
	check(got.length === want.length, `${got.length} results`);
	check(got.every((r, k) => Math.abs(r.net - want[k].net) < 1e-9), 'every net matches the brute force, in order');
	check(got.every((r, k) => squadKey(r.squadIds) === refSquad(want[k].moves) || Math.abs(r.net - want[k].net) < 1e-12), 'every plan matches the brute force (ties aside)');
	check(got.every((r) => r.status === 'Optimal'), 'all proven optimal');
}

if (process.argv.includes('--deep')) {
	for (const depth of [3, 4, 5]) run(`Exactly ${depth}`, { exactly: depth }, { timeLimitSeconds: 300 });
	run('At most 5', { atMost: 5 }, { timeLimitSeconds: 300 });
	run('Wildcard', 'wildcard', { timeLimitSeconds: 300 });
	for (const [label, transfers] of [['exactly 3', { exactly: 3 }], ['exactly 4', { exactly: 4 }], ['at most 5', { atMost: 5 }], ['wildcard', 'wildcard']]) {
		const t = performance.now();
		const got = solveRanked(highs, { ...base, transfers, timeLimitSeconds: 300 }, 10);
		const secs = (performance.now() - t) / 1000;
		console.log(`\nTop 10, ${label}: ${secs.toFixed(1)}s (${(secs / got.length).toFixed(2)}s each)`);
		got.forEach((r, k) => console.log(`  ${k + 1}. net ${r.net.toFixed(2)}  ${r.status}  ${show(r)}`));
		check(got.every((r, k) => k === 0 || r.net <= got[k - 1].net + 1e-9), 'nets never increase down the list');
	}
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
