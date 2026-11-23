/**
 * A transfer plan across the horizon: transfers tied to the gameweek they're
 * made in, and optional hand-picked line-ups per week. evaluatePlan works out
 * each week's squad, bank, free transfers, hits, line-up and points.
 *
 * Scoring matches the solver: a week without a hand-picked line-up uses the
 * best legal XI with the top starter captained (bestXiDetail), weighted by
 * decay^week. So a plan of "these transfers now, auto line-ups" scores
 * exactly what the solver reported for it.
 */

import { bestXiDetail, type SolverPlayer } from './solver/fpl-solver.ts';
import type { SquadPlayer } from './transfer-engine.ts';

export interface PlanTransfer { gw: number; out: SquadPlayer; in: SquadPlayer }

export interface Plan {
	transfers: PlanTransfer[];
	/** Hand-picked order for a week: 15 ids, first 11 start. Only weeks the user changed. */
	lineups: Record<number, number[]>;
	/** Hand-picked captain for a week (must start that week). */
	captains?: Record<number, number>;
	/** Chip played in a week. */
	chips?: Record<number, ChipName>;
	/** The temporary squad for a Free Hit week (15 players). */
	freeHitSquads?: Record<number, SquadPlayer[]>;
}

export type ChipName = 'wildcard' | 'freehit' | 'bboost' | '3xc';
export const CHIP_LABEL: Record<ChipName, string> = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain' };

export interface PlanWeek {
	gw: number;
	squad: SquadPlayer[];          // starters (11) then bench (4)
	captain: number | null;
	manualLineup: boolean;
	manualCaptain: boolean;
	chip: ChipName | null;
	points: number;                // this week, captain included
	freeTransfers: number;         // available going into the week
	transfersMade: number;
	hits: number;                  // points deducted this week
	bank: number;                  // after this week's transfers
	problems: string[];            // over budget, club limit, invalid line-up
}

export interface PlanResult {
	weeks: PlanWeek[];
	twxp: number;                  // decayed points, before hits
	hits: number;
	problems: string[];
}

export interface PlanContext {
	base: SquadPlayer[];
	teamOf: (id: number) => number | undefined;   // club id, for the 3-per-club limit
	bank: number;
	freeTransfers: number;         // going into the first week (15 = wildcard / free hit)
	realFreeTransfers: number;     // the manager's actual free transfers (after a wildcard week)
	gws: number[];
	decay: number;
	maxFreeTransfers?: number;     // banked limit (FPL: 5)
	clubLimit?: number;            // FPL: 3
	hitCost?: number;              // FPL: 4
}

const VALID = (d: number, m: number, f: number, g: number) => g === 1 && d >= 3 && d <= 5 && m >= 2 && m <= 5 && f >= 1 && f <= 3;

export function formationOk(starters: SquadPlayer[]): boolean {
	const c = [0, 0, 0, 0, 0];
	for (const p of starters) c[p.element_type]++;
	return starters.length === 11 && VALID(c[2], c[3], c[4], c[1]);
}

export function solverPlayer(p: SquadPlayer, gws: number[]): SolverPlayer {
	const m = new Map((p.projections || []).map((x) => [x.gw, x.pts]));
	return { id: p.element_id, pos: p.element_type, team: 0, cost: p.current_price, proj: gws.map((g) => m.get(g) ?? 0), hasProj: true };
}

export function evaluatePlan(ctx: PlanContext, plan: Plan): PlanResult {
	const maxFt = ctx.maxFreeTransfers ?? 5;
	const clubLimit = ctx.clubLimit ?? 3;
	const hitCost = ctx.hitCost ?? 4;
	let squad = [...ctx.base];
	let bank = ctx.bank;
	let ft = ctx.freeTransfers;
	const weeks: PlanWeek[] = [];
	let twxp = 0, hits = 0;
	const all: string[] = [];

	ctx.gws.forEach((gw, i) => {
		const problems: string[] = [];
		const chip = plan.chips?.[gw] ?? null;
		const made = plan.transfers.filter((t) => t.gw === gw);
		if (chip === 'freehit' && made.length) problems.push(`GW${gw}: no transfers to your real squad in a Free Hit week`);
		for (const t of made) {
			const idx = squad.findIndex((p) => p.element_id === t.out.element_id);
			if (idx === -1) { problems.push(`${t.out.web_name} isn't in the squad in GW${gw}`); continue; }
			if (squad.some((p) => p.element_id === t.in.element_id)) { problems.push(`${t.in.web_name} is already in the squad`); continue; }
			bank += squad[idx].selling_price - t.in.current_price;
			// Bought during the plan: sells later for what was paid (no price changes modelled).
			squad[idx] = { ...t.in, purchase_price: t.in.current_price, selling_price: t.in.current_price };
		}
		const unlimited = ft >= 15;
		const freeWeek = unlimited || chip === 'wildcard' || chip === 'freehit';
		const weekHits = freeWeek ? 0 : Math.max(0, made.length - ft) * hitCost;
		if (bank < 0) problems.push(`GW${gw}: £${(-bank / 10).toFixed(1)}m over budget`);
		const clubs = new Map<number, number>();
		for (const p of squad) { const c = ctx.teamOf(p.element_id); if (c !== undefined) clubs.set(c, (clubs.get(c) ?? 0) + 1); }
		if ([...clubs.values()].some((n) => n > clubLimit)) problems.push(`GW${gw}: more than ${clubLimit} players from one club`);

		// The squad that plays: the Free Hit squad in a Free Hit week.
		let plays = squad;
		if (chip === 'freehit') {
			const fhs = plan.freeHitSquads?.[gw];
			if (!fhs || fhs.length !== squad.length) problems.push(`GW${gw}: Free Hit squad not picked`);
			else {
				plays = fhs;
				const budget = bank + squad.reduce((s, p) => s + p.selling_price, 0);
				const cost = fhs.reduce((s, p) => s + p.current_price, 0);
				if (cost > budget) problems.push(`GW${gw}: Free Hit squad £${((cost - budget) / 10).toFixed(1)}m over budget`);
				const fc = new Map<number, number>();
				for (const p of fhs) { const c = ctx.teamOf(p.element_id); if (c !== undefined) fc.set(c, (fc.get(c) ?? 0) + 1); }
				if ([...fc.values()].some((n) => n > clubLimit)) problems.push(`GW${gw}: Free Hit squad has more than ${clubLimit} from one club`);
			}
		}
		// Line-up: the user's order if it still fits this week's squad, else the best XI.
		const byId = new Map(plays.map((p) => [p.element_id, p]));
		const wk = ctx.gws.indexOf(gw);
		const pts = (p: SquadPlayer) => (p.projections || []).find((x) => x.gw === gw)?.pts ?? 0;
		let ordered: SquadPlayer[] | null = null;
		const manual = plan.lineups[gw];
		if (manual && manual.length === plays.length && manual.every((id) => byId.has(id))) {
			const o = manual.map((id) => byId.get(id)!);
			if (formationOk(o.slice(0, 11))) ordered = o;
			else problems.push(`GW${gw}: hand-picked line-up isn't a legal formation; using the best XI`);
		}
		let captain: number | null = null;
		let points = 0;
		const manualLineupUsed = ordered !== null;
		if (!ordered) {
			const d = bestXiDetail(plays.map((p) => solverPlayer(p, ctx.gws)), wk);
			ordered = d ? [...d.starters, ...d.bench].map((id) => byId.get(id)!) : plays;
		}
		// Captain: the user's pick if he starts this week, else the top starter
		// (first in line-up order on a tie, as in bestXiDetail).
		const starters = ordered.slice(0, 11);
		let cap = starters[0];
		for (const s of starters) if (pts(s) > pts(cap)) cap = s;
		const wanted = plan.captains?.[gw];
		let manualCaptain = false;
		if (wanted !== undefined) {
			const pick = starters.find((p) => p.element_id === wanted);
			if (pick) { cap = pick; manualCaptain = true; }
			else problems.push(`GW${gw}: your captain isn't starting; captaining the top starter`);
		}
		captain = cap?.element_id ?? null;
		points = starters.reduce((s, p) => s + pts(p), 0) + (cap ? pts(cap) : 0);
		if (chip === '3xc' && cap) points += pts(cap);
		if (chip === 'bboost') points += ordered.slice(11).reduce((s, p) => s + pts(p), 0);

		weeks.push({ gw, squad: ordered, captain, manualLineup: manualLineupUsed, manualCaptain, chip, points, freeTransfers: unlimited ? Infinity : ft, transfersMade: made.length, hits: weekHits, bank, problems });
		twxp += points * Math.pow(ctx.decay, i);
		hits += weekHits;
		all.push(...problems);

		// Free transfers into next week: unused ones roll over (to the limit), plus
		// one. A Wildcard / Free Hit week keeps the banked ones but adds none
		// (checked against FPL's hit charges: scripts/prices/ft_rule_check.mjs).
		ft = unlimited ? ctx.realFreeTransfers
			: chip === 'wildcard' || chip === 'freehit' ? ft
			: Math.min(maxFt, Math.max(0, ft - made.length) + 1);
	});
	return { weeks, twxp, hits, problems: all };
}
