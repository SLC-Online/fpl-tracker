// HiGHS log for the multi-week model (live data), to see where solve time goes.
import { readFileSync } from 'node:fs';
import loadHighs from 'highs';
import { buildMultiModel } from '../../src/lib/solver/multi-week.ts';
const [T = 8, opts = '{}'] = [Number(process.argv[2] ?? 8), process.argv[3] ?? '{}'];
const sq = JSON.parse(readFileSync('/tmp/sq.json', 'utf8')), all = JSON.parse(readFileSync('/tmp/players.json', 'utf8'));
const gws = [...new Set(all.flatMap((p) => p.projections.map((x) => x.gw)))].sort((a, b) => a - b).slice(0, T);
const sell = new Map(sq.squad.map((p) => [p.element_id, p.selling_price]));
const players = all.map((p) => { const m = new Map(p.projections.map((x) => [x.gw, x.pts])); return { id: p.element_id, pos: p.element_type, team: p.team_id, cost: p.now_cost, sell: sell.get(p.element_id), proj: Float64Array.from(gws.map((g) => m.get(g) ?? 0)), hasProj: p.projections.length > 0 }; });
const rules = { squadSize: 15, startingXi: 11, clubLimit: 3, maxBankedFreeTransfers: 5, positions: { 1: { squad: 2, minPlay: 1, maxPlay: 1 }, 2: { squad: 5, minPlay: 3, maxPlay: 5 }, 3: { squad: 5, minPlay: 2, maxPlay: 5 }, 4: { squad: 3, minPlay: 1, maxPlay: 3 } }, hitCost: 4, captainMultiplier: 2 };
const maxPer = process.argv[4] ? Number(process.argv[4]) : undefined;
const { lp } = buildMultiModel({ players, squadIds: sq.squad.map((p) => p.element_id), bank: sq.bank, freeTransfers: sq.free_transfers, weights: gws.map((_, i) => 0.85 ** i), rules, maxTransfersPerWeek: maxPer });
const t0 = performance.now(); const highs = await loadHighs({ print: (s) => console.log(((performance.now() - t0) / 1000).toFixed(1) + 's ' + s), printErr: (s) => console.log('E ' + s) });
const t = performance.now();
const r = highs.solve(lp, { output_flag: true, log_to_console: true, mip_rel_gap: 0, mip_abs_gap: 1e-9, time_limit: 400, ...JSON.parse(opts) });
console.log('TOTAL', ((performance.now() - t) / 1000).toFixed(1), r.Status, r.ObjectiveValue);
