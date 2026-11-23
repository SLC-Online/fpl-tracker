// Multi-week solver on live data (/tmp/sq.json, /tmp/players.json from the site):
// solve time, and the plan re-scored independently by $lib/plan must equal the objective.
import { readFileSync } from 'node:fs';
import loadHighs from 'highs';
import { solveMultiWeek } from '../../src/lib/solver/multi-week.ts';
import { evaluatePlan } from '../../src/lib/plan.ts';
const [weeksArg = '8', chipArg = '', limit = '600', maxPer = ''] = process.argv.slice(2);
const T = Number(weeksArg);
const sq = JSON.parse(readFileSync('/tmp/sq.json', 'utf8')), all = JSON.parse(readFileSync('/tmp/players.json', 'utf8'));
const gws = [...new Set(all.flatMap((p) => p.projections.map((x) => x.gw)))].sort((a, b) => a - b).slice(0, T);
const sell = new Map(sq.squad.map((p) => [p.element_id, p.selling_price]));
const players = all.map((p) => { const m = new Map(p.projections.map((x) => [x.gw, x.pts])); return { id: p.element_id, pos: p.element_type, team: p.team_id, cost: p.now_cost, sell: sell.get(p.element_id), proj: Float64Array.from(gws.map((g) => m.get(g) ?? 0)), hasProj: p.projections.length > 0 }; });
const rules = { squadSize: 15, startingXi: 11, clubLimit: 3, maxBankedFreeTransfers: 5, positions: { 1: { squad: 2, minPlay: 1, maxPlay: 1 }, 2: { squad: 5, minPlay: 3, maxPlay: 5 }, 3: { squad: 5, minPlay: 2, maxPlay: 5 }, 4: { squad: 3, minPlay: 1, maxPlay: 3 } }, hitCost: 4, captainMultiplier: 2 };
const chips = {};
// "bboost" = any week; "bboost@2" = fixed to week index 2
for (const c of chipArg.split(',').filter(Boolean)) {
	const [name, at] = c.split('@');
	chips[name] = at !== undefined ? { weeks: [Number(at)], mustUse: true } : { weeks: gws.map((_, i) => i), mustUse: false };
}
const weights = gws.map((_, i) => 0.85 ** i);
const highs = await loadHighs();
const r = solveMultiWeek(highs, { players, squadIds: sq.squad.map((p) => p.element_id), bank: sq.bank, freeTransfers: sq.free_transfers, weights, rules, chips, timeLimitSeconds: Number(limit), ...(maxPer ? { maxTransfersPerWeek: Number(maxPer) } : {}) });
const name = new Map(all.map((p) => [p.element_id, p.web_name]));
console.log(`${T} weeks, chips [${chipArg}]: ${r.status} in ${(r.timings.solveMs / 1000).toFixed(1)}s (${r.modelSize.variables} vars, ${r.modelSize.constraints} rows), objective ${r.objective.toFixed(4)}`);
for (const w of r.weeks) console.log(`  GW${gws[w.t]} FT ${w.freeTransfers} ${w.chip ?? ''} ${w.transfers.map((t) => name.get(t.out) + '→' + name.get(t.in)).join(', ') || '-'}${w.hits ? ` (−${w.hits})` : ''} bank ${w.bank} cap ${name.get(w.captain)}`);
// Independent re-score: $lib/plan with the solver's transfers, chips and Free Hit squad, auto line-ups.
{
	const byId = new Map(all.map((p) => [p.element_id, p]));
	const toSquad = (p, s) => ({ element_id: p.element_id, web_name: p.web_name, element_type: p.element_type, team_code: p.team_code, team_short: p.team_short, current_price: p.now_cost, purchase_price: p.now_cost, selling_price: s ?? p.now_cost, projections: p.projections });
	const base = sq.squad.map((s) => toSquad(byId.get(s.element_id), s.selling_price));
	const ctx = { base, teamOf: (id) => byId.get(id)?.team_id, bank: sq.bank, freeTransfers: sq.free_transfers, realFreeTransfers: sq.free_transfers, gws, decay: 0.85 };
	const transfers = r.weeks.flatMap((w) => w.transfers.map((t) => ({ gw: gws[w.t], out: null, outId: t.out, in: toSquad(byId.get(t.in)) })));
	// resolve outs against the squad at that week (a plan purchase may be sold later)
	const held = new Map(base.map((p) => [p.element_id, p]));
	for (const t of transfers) { t.out = held.get(t.outId); held.delete(t.outId); held.set(t.in.element_id, t.in); }
	const chipsByGw = Object.fromEntries(r.weeks.filter((w) => w.chip).map((w) => [gws[w.t], w.chip]));
	const fh = Object.fromEntries(r.weeks.filter((w) => w.chip === 'freehit').map((w) => [gws[w.t], w.squad.map((id) => toSquad(byId.get(id)))]));
	const e = evaluatePlan(ctx, { transfers, lineups: {}, chips: chipsByGw, freeHitSquads: fh });
	const base0 = evaluatePlan(ctx, { transfers: [], lineups: {} });
	if (e.problems.length) console.log('  problems:', e.problems.join(' | '));
console.log(`re-scored: TWxP ${e.twxp.toFixed(4)} − hits ${e.hits} = ${(e.twxp - e.hits).toFixed(4)} vs solver ${r.objective.toFixed(4)} → ${Math.abs(e.twxp - e.hits - r.objective) < 1e-6 ? 'MATCH' : 'DIFF'}; problems ${e.problems.length}; net vs no transfers ${(e.twxp - e.hits - base0.twxp).toFixed(2)}`);
}
