/**
 * Transfer Engine — core logic for squad evaluation and transfer comparison.
 * Input-source agnostic: works with whatever projections are in the system.
 */

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
 * For each GW, picks the optimal 11 (respecting position constraints).
 */
export function calculateSquadTWxP(squad: SquadPlayer[]): number {
	if (!squad || squad.length === 0) return 0;

	// Get all GWs
	const allGws = new Set<number>();
	for (const p of squad) {
		for (const proj of p.projections || []) {
			allGws.add(proj.gw);
		}
	}
	const gws = [...allGws].sort((a, b) => a - b).slice(0, 8);

	let total = 0;
	for (let i = 0; i < gws.length; i++) {
		const gw = gws[i];
		const playerPts = squad.map(p => ({
			element_id: p.element_id,
			element_type: p.element_type,
			pts: (p.projections || []).find(pr => pr.gw === gw)?.pts || 0,
		}));

		const best11 = pickOptimal11(playerPts);
		const gwTotal = best11.reduce((s, p) => s + p.pts, 0);
		total += gwTotal * Math.pow(DECAY, i);
	}
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
 * Pick optimal 11 from 15 players respecting FPL position constraints.
 * 1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD, total = 11
 */
function pickOptimal11(players: { element_id: number; element_type: number; pts: number }[]) {
	const gk = players.filter(p => p.element_type === 1).sort((a, b) => b.pts - a.pts);
	const def = players.filter(p => p.element_type === 2).sort((a, b) => b.pts - a.pts);
	const mid = players.filter(p => p.element_type === 3).sort((a, b) => b.pts - a.pts);
	const fwd = players.filter(p => p.element_type === 4).sort((a, b) => b.pts - a.pts);

	// Minimum: 1 GK, 3 DEF, 2 MID, 1 FWD = 7
	const team = [
		...gk.slice(0, 1),
		...def.slice(0, 3),
		...mid.slice(0, 2),
		...fwd.slice(0, 1),
	];

	// Fill remaining 4 from best available (respecting maxes)
	const remaining = [
		...def.slice(3, 5),
		...mid.slice(2, 5),
		...fwd.slice(1, 3),
	].sort((a, b) => b.pts - a.pts);

	team.push(...remaining.slice(0, 4));
	return team.slice(0, 11);
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
