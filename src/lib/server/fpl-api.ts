/**
 * FPL API client — fetches public data from the official Fantasy PL API.
 * All endpoints here are public (no auth required).
 */

const FPL_BASE = 'https://fantasy.premierleague.com/api';

export interface FplPick {
	element: number;
	position: number;
	multiplier: number;
	is_captain: boolean;
	is_vice_captain: boolean;
	element_type: number;
}

export interface FplEntryHistory {
	event: number;
	points: number;
	total_points: number;
	rank: number;
	overall_rank: number;
	bank: number;        // in tenths (e.g. 5 = £0.5m)
	value: number;       // in tenths (e.g. 1000 = £100.0m)
	event_transfers: number;
	event_transfers_cost: number;
	points_on_bench: number;
}

export interface FplTransfer {
	element_in: number;
	element_in_cost: number;    // price paid (tenths)
	element_out: number;
	element_out_cost: number;   // price received (tenths)
	entry: number;
	event: number;
	time: string;
}

export interface FplEntry {
	id: number;
	player_first_name: string;
	player_last_name: string;
	name: string;  // team name
	summary_overall_points: number;
	summary_overall_rank: number;
	last_deadline_bank: number;
	last_deadline_value: number;
	last_deadline_total_transfers: number;
}

export interface FplPicksResponse {
	active_chip: string | null;
	automatic_subs: any[];
	entry_history: FplEntryHistory;
	picks: FplPick[];
}

async function fplFetch<T>(path: string): Promise<T> {
	const resp = await fetch(`${FPL_BASE}/${path}`, { 
		headers: { 'User-Agent': 'FPL-Tracker/1.0' }
	});
	if (!resp.ok) {
		throw new Error(`FPL API ${path}: ${resp.status}`);
	}
	return resp.json() as Promise<T>;
}

/**
 * Get manager summary (team name, points, rank)
 */
export async function getEntry(managerId: number): Promise<FplEntry> {
	return fplFetch<FplEntry>(`entry/${managerId}/`);
}

/**
 * Get manager's squad picks for a specific gameweek
 */
export async function getEventPicks(managerId: number, event: number): Promise<FplPicksResponse> {
	return fplFetch<FplPicksResponse>(`entry/${managerId}/event/${event}/picks/`);
}

/**
 * Get all transfers made by a manager this season
 */
export async function getTransfers(managerId: number): Promise<FplTransfer[]> {
	return fplFetch<FplTransfer[]>(`entry/${managerId}/transfers/`);
}

/**
 * Get manager's season history (points per GW, chips used)
 */
export async function getHistory(managerId: number): Promise<{current: FplEntryHistory[], chips: any[], past: any[]}> {
	return fplFetch(`entry/${managerId}/history/`);
}

/**
 * Reconstruct purchase prices for the current squad.
 * 
 * Logic:
 * - GW1 squad: purchased at their GW1 start price (now_cost - cost_change_start)
 * - Players transferred in: element_in_cost from transfers endpoint
 * - Selling price: purchase_price + floor((current_price - purchase_price) / 2)
 *   (FPL gives you half the profit, rounded down)
 */
export function calculateSellingPrice(purchasePrice: number, currentPrice: number): number {
	if (currentPrice <= purchasePrice) {
		// Lost value or no change — selling price = current price
		return currentPrice;
	}
	// Profit: you get half, rounded down
	const profit = Math.floor((currentPrice - purchasePrice) / 2);
	return purchasePrice + profit;
}
