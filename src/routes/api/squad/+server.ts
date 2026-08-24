import { json, error } from '@sveltejs/kit';
import { getEntry, getEventPicks, getTransfers, calculateSellingPrice } from '$lib/server/fpl-api';
import { supabaseAdmin } from '$lib/supabase-server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const managerId = parseInt(url.searchParams.get('id') || '');
	if (isNaN(managerId)) {
		throw error(400, 'Manager ID required');
	}

	try {
		// 1. Get manager info
		const entry = await getEntry(managerId);

		// 2. Get current event (which GW are we in)
		const { data: currentEvent } = await supabaseAdmin
			.from('events')
			.select('event_id')
			.eq('is_current', true)
			.limit(1)
			.single();

		const currentGw = currentEvent?.event_id || 1;

		// 3. Get their picks for the current/latest GW
		let picks;
		try {
			picks = await getEventPicks(managerId, currentGw);
		} catch {
			// GW might not have started yet, try previous
			if (currentGw > 1) {
				picks = await getEventPicks(managerId, currentGw - 1);
			} else {
				throw error(404, 'No squad data available yet');
			}
		}

		// 4. Get all transfers this season
		const transfers = await getTransfers(managerId);

		// 5. Get player data from our DB for the squad
		const elementIds = picks.picks.map(p => p.element);
		const { data: players } = await supabaseAdmin
			.from('players')
			.select('element_id, web_name, first_name, second_name, code, element_type, team_id, teams!inner(short_name, code, name)')
			.in('element_id', elementIds);

		// 6. Get current prices from latest snapshot
		const { data: latestSnap } = await supabaseAdmin
			.from('snapshots')
			.select('snapshot_id')
			.order('snapshot_id', { ascending: false })
			.limit(1)
			.single();

		const { data: currentPrices } = await supabaseAdmin
			.from('player_snapshots')
			.select('element_id, now_cost, cost_change_start')
			.eq('snapshot_id', latestSnap?.snapshot_id || 0)
			.in('element_id', elementIds);

		const priceMap = new Map<number, { now_cost: number; cost_change_start: number }>();
		for (const p of currentPrices || []) {
			priceMap.set(p.element_id, p);
		}

		// 7. Reconstruct purchase prices
		// Build a map of element_id → purchase_price from transfer history
		const purchasePriceMap = new Map<number, number>();

		// For transfers IN: the element_in_cost is the purchase price
		for (const t of transfers) {
			purchasePriceMap.set(t.element_in, t.element_in_cost);
		}

		// For players NOT in transfer history: they were in the GW1 squad
		// Their purchase price = starting price = current_price - cost_change_start
		for (const pick of picks.picks) {
			if (!purchasePriceMap.has(pick.element)) {
				const priceData = priceMap.get(pick.element);
				if (priceData) {
					purchasePriceMap.set(pick.element, priceData.now_cost - priceData.cost_change_start);
				}
			}
		}

		// 8. Get projections for these players (use latest upload only, skip played GWs)
		const { data: nextEvent } = await supabaseAdmin
			.from('events')
			.select('event_id')
			.eq('is_next', true)
			.limit(1)
			.single();

		const nextGw = nextEvent?.event_id || 2;

		// Get the latest uploaded_for_gw
		const { data: latestUpload } = await supabaseAdmin
			.from('projection_inputs')
			.select('uploaded_for_gw')
			.order('uploaded_for_gw', { ascending: false })
			.limit(1)
			.single();

		const latestUploadGw = latestUpload?.uploaded_for_gw || 1;

		const { data: projections } = await supabaseAdmin
			.from('projection_inputs')
			.select('element_id, gameweek, expected_points, meta')
			.in('element_id', elementIds)
			.eq('uploaded_for_gw', latestUploadGw)
			.gte('gameweek', nextGw)
			.lte('gameweek', nextGw + 7)
			.order('gameweek');

		// Group projections by element_id
		const projectionMap = new Map<number, { gw: number; pts: number }[]>();
		for (const proj of projections || []) {
			if (!projectionMap.has(proj.element_id)) {
				projectionMap.set(proj.element_id, []);
			}
			projectionMap.get(proj.element_id)!.push({ gw: proj.gameweek, pts: proj.expected_points });
		}

		// 9. Build the response
		const playerMap = new Map();
		for (const p of players || []) {
			const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
			playerMap.set(p.element_id, { ...p, teams: team });
		}

		const squad = picks.picks.map(pick => {
			const player = playerMap.get(pick.element);
			const priceData = priceMap.get(pick.element);
			const purchasePrice = purchasePriceMap.get(pick.element) || priceData?.now_cost || 0;
			const currentPrice = priceData?.now_cost || 0;
			const sellingPrice = calculateSellingPrice(purchasePrice, currentPrice);
			const playerProjections = projectionMap.get(pick.element) || [];

			return {
				element_id: pick.element,
				position: pick.position,       // 1-11 = starting, 12-15 = bench
				is_captain: pick.is_captain,
				is_vice_captain: pick.is_vice_captain,
				multiplier: pick.multiplier,
				// Player info
				web_name: player?.web_name || '???',
				first_name: player?.first_name || '',
				second_name: player?.second_name || '',
				code: player?.code || 0,
				element_type: player?.element_type || pick.element_type,
				team_id: player?.team_id || 0,
				team_short: player?.teams?.short_name || '',
				team_code: player?.teams?.code || 0,
				team_name: player?.teams?.name || '',
				// Prices
				current_price: currentPrice,
				purchase_price: purchasePrice,
				selling_price: sellingPrice,
				// Projections
				projections: playerProjections,
			};
		});

		return json({
			manager: {
				id: entry.id,
				name: `${entry.player_first_name} ${entry.player_last_name}`,
				team_name: entry.name,
				overall_points: entry.summary_overall_points,
				overall_rank: entry.summary_overall_rank,
			},
			squad,
			bank: picks.entry_history.bank,
			squad_value: picks.entry_history.value,
			total_points: picks.entry_history.total_points,
			gameweek: picks.entry_history.event,
			transfers_made: transfers.length,
			active_chip: picks.active_chip,
		});
	} catch (e: any) {
		if (e.status) throw e;  // Re-throw SvelteKit errors
		console.error('Squad load error:', e);
		throw error(500, `Failed to load squad: ${e.message}`);
	}
};
