/**
 * Transfer Engine — core logic for squad evaluation and transfer comparison.
 * Input-source agnostic: works with whatever projections are in the system.
 */

import { bestXiPoints } from './solver/fpl-solver';

export const DECAY = 0.85;
export const BCV_THRESHOLD = 0.10;  // Minimum BCV gain to justify a transfer

export interface SquadPlayer {
	element_id: number;
	web_name: string;
	element_type: number;  // 1=GK, 2=DEF, 3=MID, 4=FWD
	team_code: number;
	team_short: string;
	current_price: number;
	purchase_price: number;
	selling_price: number;
	projections: { gw: number; pts: number }[];
	bcv?: number | null;
}

export interface TransferOption {
	id: string;
	name: string;
	transfers: { out: SquadPlayer; in: SquadPlayer }[];
	resultSquad: SquadPlayer[];
	bank: number;
	twxp: number;
	twxpDelta: number;  // vs base squad
	cost: number;       // transfer point cost (4 pts per extra transfer)
	netGain: number;    // twxp gain minus cost
}

/**
 * Calculate Time-Weighted Expected Points for a squad.
 * For each GW: the best legal XI, with the top starter captained (double
 * points), weighted by DECAY per week. Uses the solver's own scoring
 * (bestXiPoints) so the page and the optimiser always agree.
 */
export function calculateSquadTWxP(squad: SquadPlayer[], gwList?: number[]): number {
	if (!squad || squad.length === 0) return 0;

	let gws = gwList;
	if (!gws) {
		const allGws = new Set<number>();
		for (const p of squad) for (const proj of p.projections || []) allGws.add(proj.gw);
		gws = [...allGws].sort((a, b) => a - b).slice(0, 8);
	}

	const players = squad.map((p) => {
		const byGw = new Map((p.projections || []).map((pr) => [pr.gw, pr.pts]));
		return { pos: p.element_type, proj: gws!.map((g) => byGw.get(g) ?? 0) };
	});
	let total = 0;
	for (let i = 0; i < gws.length; i++) total += bestXiPoints(players as any, i) * Math.pow(DECAY, i);
	return total;
}

/**
 * Calculate TWxP for a single player
 */
export function calculatePlayerTWxP(projections: { gw: number; pts: number }[]): number {
	if (!projections || projections.length === 0) return 0;
	const sorted = [...projections].sort((a, b) => a.gw - b.gw);
	return sorted.reduce((sum, p, i) => sum + p.pts * Math.pow(DECAY, i), 0);
}

/**
 * Apply transfers to a squad and return the new squad + bank.
 */
export function applyTransfers(
	baseSquad: SquadPlayer[],
	baseBank: number,
	transfers: { out: SquadPlayer; in: SquadPlayer }[]
): { squad: SquadPlayer[]; bank: number } {
	let squad = [...baseSquad];
	let bank = baseBank;

	for (const t of transfers) {
		// Find the outgoing player's index and replace them in-place
		const idx = squad.findIndex(p => p.element_id === t.out.element_id);
		bank += t.out.selling_price;
		bank -= t.in.current_price;

		const inPlayer: SquadPlayer = {
			...t.in,
			purchase_price: t.in.current_price,
			selling_price: t.in.current_price,
		};

		if (idx !== -1) {
			// Replace at same position (preserves starting XI / bench slot)
			squad[idx] = inPlayer;
		} else {
			// Fallback: player not found (shouldn't happen), append
			squad.push(inPlayer);
		}
	}

	return { squad, bank };
}

/**
 * Swap two players in a squad (substitution: starting XI ↔ bench).
 */
export function swapPlayers(
	squad: SquadPlayer[],
	playerA: number,
	playerB: number
): SquadPlayer[] {
	const result = [...squad];
	const idxA = result.findIndex(p => p.element_id === playerA);
	const idxB = result.findIndex(p => p.element_id === playerB);
	if (idxA !== -1 && idxB !== -1) {
		[result[idxA], result[idxB]] = [result[idxB], result[idxA]];
	}
	return result;
}

/**
 * Calculate the transfer cost in points.
 * First free transfer is free, subsequent ones cost 4 pts each.
 */
export function transferPointsCost(numTransfers: number, freeTransfers: number = 1): number {
	const paidTransfers = Math.max(0, numTransfers - freeTransfers);
	return paidTransfers * 4;
}

/**
 * Determine whether a transfer is worth making.
 * Uses value threshold internally and TWxP improvement vs the 4-point hit cost.
 */
export function isTransferWorthIt(
	option: TransferOption,
	freeTransfers: number = 1
): { worth: boolean; reason: string; confidence: number } {
	const ptsCost = transferPointsCost(option.transfers.length, freeTransfers);
	const netPointsGain = option.twxpDelta - ptsCost;

	// Internal value-based threshold check
	const avgBcvGain = option.transfers.reduce((sum, t) => {
		const bcvIn = t.in.bcv ?? 0;
		const bcvOut = t.out.bcv ?? 0;
		return sum + (bcvIn - bcvOut);
	}, 0) / option.transfers.length;

	if (Math.abs(netPointsGain) < 0.05) {
		return {
			worth: false,
			reason: ptsCost > 0 ? `No net gain after ${ptsCost}-point hit` : 'No meaningful difference',
			confidence: 0.5,
		};
	}

	if (netPointsGain < 0) {
		return {
			worth: false,
			reason: ptsCost > 0
				? `−${Math.abs(netPointsGain).toFixed(1)} pts after ${ptsCost}-point hit`
				: `−${Math.abs(netPointsGain).toFixed(1)} pts vs current player`,
			confidence: 0.8,
		};
	}

	if (avgBcvGain < BCV_THRESHOLD && netPointsGain < 4) {
		return {
			worth: false,
			reason: `Marginal gain — not worth the disruption`,
			confidence: 0.6,
		};
	}

	if (netPointsGain >= 4 || avgBcvGain >= BCV_THRESHOLD * 2) {
		return {
			worth: true,
			reason: `+${netPointsGain.toFixed(1)} pts${ptsCost > 0 ? ` (after ${ptsCost}-point hit)` : ''}`,
			confidence: 0.85,
		};
	}

	return {
		worth: true,
		reason: `+${netPointsGain.toFixed(1)} pts${ptsCost > 0 ? ` (after ${ptsCost}-point hit)` : ''}`,
		confidence: 0.5,
	};
}
