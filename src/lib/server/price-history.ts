/**
 * Season price history from our own scrapes, for rebuilding purchase prices
 * (see $lib/purchase-prices). Cached per server instance: it only changes
 * when the scraper logs a price change, at most hourly.
 */

import { supabaseAdmin } from '$lib/supabase-server';
import { makePriceAt } from '$lib/purchase-prices';

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; key: string; value: ReturnType<typeof makePriceAt> } | null = null;

async function all<T>(table: string, select: string, order: string, filter?: (q: any) => any): Promise<T[]> {
	const out: T[] = [];
	for (let from = 0; ; from += 1000) {
		let q = supabaseAdmin.from(table).select(select).order(order).range(from, from + 999);
		if (filter) q = filter(q);
		const { data, error } = await q;
		if (error) throw new Error(`${table}: ${error.message}`);
		out.push(...((data ?? []) as T[]));
		if (!data || data.length < 1000) return out;
	}
}

/**
 * startPrice: element id -> price at the start of the season
 * (now_cost - cost_change_start from FPL's live data).
 */
export async function getPriceHistory(startPrice: Map<number, number>) {
	// Start prices only change if FPL adds players, so they're part of the key.
	const key = `${startPrice.size}`;
	if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;
	const [changes, snapshots, withRows] = await Promise.all([
		all<{ element_id: number; change: number; snapshot_id: number }>('price_changes', 'element_id, change, snapshot_id', 'id'),
		all<{ snapshot_id: number; timestamp: string }>('snapshots', 'snapshot_id, timestamp', 'snapshot_id'),
		// Snapshots a failed scrape left without player rows don't count as a
		// "last known price". Element 1 is in every snapshot that has rows.
		all<{ snapshot_id: number }>('player_snapshots', 'snapshot_id', 'snapshot_id', (q) => q.eq('element_id', 1))
	]);
	const has = new Set(withRows.map((r) => r.snapshot_id));
	const value = makePriceAt(
		startPrice,
		changes,
		snapshots.map((s) => ({ ...s, hasPrices: has.has(s.snapshot_id) }))
	);
	cache = { at: Date.now(), key, value };
	return value;
}
