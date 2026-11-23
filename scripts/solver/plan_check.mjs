// evaluatePlan vs the solver's scoring, and free-transfer rollover, on live data
// saved from the site (/tmp/sq.json = /api/squad?id=403851, /tmp/players.json = /api/players?q=).
import { readFileSync } from 'node:fs';
import { evaluatePlan } from '../../src/lib/plan.ts';
import { rankedSearch } from '../../src/lib/solver/ranked-search.ts';
const sq = JSON.parse(readFileSync('/tmp/sq.json', 'utf8')), all = JSON.parse(readFileSync('/tmp/players.json', 'utf8'));
const gws = [...new Set(all.flatMap((p) => p.projections.map((x) => x.gw)))].sort((a, b) => a - b).slice(0, 8);
const byId = new Map(all.map((p) => [p.element_id, p]));
const toSquad = (p, sell) => ({ element_id: p.element_id, web_name: p.web_name, element_type: p.element_type, team_code: p.team_code, team_short: p.team_short, current_price: p.now_cost, purchase_price: p.now_cost, selling_price: sell ?? p.now_cost, projections: p.projections });
const base = sq.squad.map((s) => toSquad(byId.get(s.element_id), s.selling_price));
const ctx = { base, teamOf: (id) => byId.get(id)?.team_id, bank: sq.bank, freeTransfers: sq.free_transfers, realFreeTransfers: sq.free_transfers, gws, decay: 0.85 };
let fails = 0; const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// 1. Solver plans applied now, auto line-ups: same TWxP as the solver.
const players = all.map((p) => { const m = new Map(p.projections.map((x) => [x.gw, x.pts])); return { id: p.element_id, pos: p.element_type, team: p.team_id, cost: p.now_cost, sell: sq.squad.find((s) => s.element_id === p.element_id)?.selling_price, proj: Float64Array.from(gws.map((g) => m.get(g) ?? 0)), hasProj: p.projections.length > 0 }; });
const rules = { squadSize: 15, startingXi: 11, clubLimit: 3, positions: { 1: { squad: 2, minPlay: 1, maxPlay: 1 }, 2: { squad: 5, minPlay: 3, maxPlay: 5 }, 3: { squad: 5, minPlay: 2, maxPlay: 5 }, 4: { squad: 3, minPlay: 1, maxPlay: 3 } }, hitCost: 4, captainMultiplier: 2 };
const rs = rankedSearch({ players, squadIds: base.map((p) => p.element_id), bank: sq.bank, freeTransfers: sq.free_transfers, weights: gws.map((_, i) => 0.85 ** i), rules, maxTransfers: 3, topN: 3 });
const none = evaluatePlan(ctx, { transfers: [], lineups: {} });
check(Math.abs(none.twxp - rs.baseTwxp) < 1e-9, `no transfers: ${none.twxp} vs solver ${rs.baseTwxp}`);
for (const d of [1, 2, 3]) for (const p of rs.byDepth[d]) {
	const r = evaluatePlan(ctx, { transfers: p.transfers.map((t) => ({ gw: gws[0], out: base.find((b) => b.element_id === t.out), in: toSquad(byId.get(t.in)) })), lineups: {} });
	check(Math.abs(r.twxp - p.twxp) < 1e-9 && r.hits === p.hits && r.problems.length === 0, `${d}-transfer plan: twxp ${r.twxp.toFixed(6)} vs ${p.twxp.toFixed(6)}, hits ${r.hits} vs ${p.hits}`);
}

// 2. Free transfers: 2 FT now; none used in GW${gws[0]} -> 3 next week; 4 used then -> one hit.
const [a, b, c, d] = base.filter((p) => p.element_type === 2).slice(0, 4);
const cheap = all.filter((p) => p.element_type === 2 && p.now_cost <= 40 && !base.some((x) => x.element_id === p.element_id)).slice(0, 4).map((p) => toSquad(p));
const r2 = evaluatePlan(ctx, { transfers: [a, b, c, d].map((o, i) => ({ gw: gws[1], out: o, in: cheap[i] })), lineups: {} });
check(r2.weeks[0].freeTransfers === 2 && r2.weeks[1].freeTransfers === 3 && r2.weeks[1].hits === 4 && r2.weeks[2].freeTransfers === 1, `rollover: FT ${r2.weeks.slice(0, 3).map((w) => w.freeTransfers).join(' → ')}, GW${gws[1]} hits ${r2.weeks[1].hits}`);
const r3 = evaluatePlan({ ...ctx, freeTransfers: 5 }, { transfers: [], lineups: {} });
check(r3.weeks[1].freeTransfers === 5, `banked limit: 5 FT stays 5 (got ${r3.weeks[1].freeTransfers})`);

// 3. Hand-picked line-up: bench the top scorer in week 1; points drop by exactly his contribution.
const w = none.weeks[1];
const order = w.squad.map((p) => p.element_id);
const benchSame = w.squad.findIndex((p, i) => i >= 11 && p.element_type === w.squad[1].element_type);
if (benchSame > 0) {
	[order[1], order[benchSame]] = [order[benchSame], order[1]];
	const r4 = evaluatePlan(ctx, { transfers: [], lineups: { [gws[1]]: order } });
	const pts = (p) => p.projections.find((x) => x.gw === gws[1])?.pts ?? 0;
	const starters = order.slice(0, 11).map((id) => base.find((x) => x.element_id === id));
	const cap = starters.reduce((m, p) => (pts(p) > pts(m) ? p : m), starters[0]);
	const want = starters.reduce((s, p) => s + pts(p), 0) + pts(cap);
	check(Math.abs(r4.weeks[1].points - want) < 1e-9 && r4.weeks[1].manualLineup, `manual line-up GW${gws[1]}: ${r4.weeks[1].points.toFixed(2)} vs ${want.toFixed(2)} (auto ${w.points.toFixed(2)})`);
}
console.log(fails ? `${fails} failed` : 'All passed');
