import { json, error } from '@sveltejs/kit';
import { getEntry, getEventPicks, getTransfers, getHistory, calculateSellingPrice, getLivePrices } from '$lib/server/fpl-api';
import { supabaseAdmin } from '$lib/supabase-server';
import { getPriceHistory } from '$lib/server/price-history';
import { replayPurchasePrices } from '$lib/purchase-prices';
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
		// During a Free Hit, FPL shows the temporary squad. Plan from the real
		// one, which comes back afterwards: the squad from the week before.
		const shownPicks = picks;
		if (picks.active_chip === 'freehit' && picks.entry_history.event > 1) {
			picks = await getEventPicks(managerId, picks.entry_history.event - 1);
		}

		// 4. Get all transfers this season + chip history (for accurate FT calc)
		const transfers = await getTransfers(managerId);
		let chips: any[] = [];
		let historyCurrent: { event: number; bank: number }[] = [];
		try {
			const history = await getHistory(managerId);
			chips = history.chips || [];
			historyCurrent = history.current || [];
		} catch {
			chips = [];
		}

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
		// Prefer FPL's live prices: snapshots can be hours old after price changes.
		const live = await getLivePrices();
		for (const id of elementIds) {
			const lp = live?.get(id);
			if (lp) priceMap.set(id, { now_cost: lp.now_cost, cost_change_start: lp.cost_change_start });
		}

		// 7. Purchase prices: replay the season (first squad, then every
		// transfer, skipping Free Hit weeks) and check the result against FPL's
		// own sale prices and banks. See $lib/purchase-prices.
		const purchasePriceMap = new Map<number, number>();
		let pricesVerified = false;
		let priceProblems: string[] = [];
		let sellingUncertain: { id: number; options: number[] }[] = [];
		try {
			const live = await getLivePrices();
			if (!live) throw new Error('FPL live prices unavailable');
			const startPrice = new Map<number, number>();
			const currentPrices = new Map<number, number>();
			for (const [id, lp] of live) { startPrice.set(id, lp.now_cost - lp.cost_change_start); currentPrices.set(id, lp.now_cost); }
			const { data: events } = await supabaseAdmin.from('events').select('event_id, deadline_time').order('event_id');
			const deadline = new Map((events ?? []).map((e: any) => [e.event_id, e.deadline_time as string]));
			const startedEvent: number = (entry as any).started_event ?? 1;
			const firstPicks = startedEvent === picks.entry_history.event ? picks : await getEventPicks(managerId, startedEvent);
			const history = await getPriceHistory(startPrice);
			const r = replayPurchasePrices({
				startedEvent,
				joinedTime: (entry as any).joined_time,
				firstDeadline: deadline.get(1)!,
				startedDeadline: deadline.get(startedEvent)!,
				firstPicks: firstPicks.picks.map((p) => p.element),
				currentPicks: picks.picks.map((p) => p.element),
				currentEvent: picks.entry_history.event,
				transfers,
				chips,
				bankByEvent: new Map(historyCurrent.map((h) => [h.event, h.bank])),
				priceAt: history.priceAt,
				pricesBetween: history.pricesBetween,
				currentPrices
			});
			for (const [id, p] of r.purchase) purchasePriceMap.set(id, p);
			pricesVerified = r.verified;
			priceProblems = r.problems;
			sellingUncertain = r.sellingUncertain ?? [];
		} catch (e: any) {
			priceProblems = [`could not rebuild purchase prices: ${e.message}`];
		}

		// 8. Get projections for these players (use latest upload only, skip played GWs)
		const { data: nextEvent } = await supabaseAdmin
			.from('events')
			.select('event_id')
			.eq('is_next', true)
			.limit(1)
			.single();

		const nextGw = nextEvent?.event_id || 2;

		// Get the latest uploaded_for_gw from final projections
		const { data: latestUpload } = await supabaseAdmin
			.from('final_projections')
			.select('uploaded_for_gw')
			.order('uploaded_for_gw', { ascending: false })
			.limit(1)
			.single();

		const latestUploadGw = latestUpload?.uploaded_for_gw || 1;

		const { data: projections } = await supabaseAdmin
			.from('final_projections')
			.select('element_id, gameweek, expected_points, meta')
			.in('element_id', elementIds)
			.eq('uploaded_for_gw', latestUploadGw)
			.gte('gameweek', nextGw)
			.lte('gameweek', nextGw + 7)
			.order('gameweek');

		// Group projections by element_id + capture bcv (VFM source) from meta
		const projectionMap = new Map<number, { gw: number; pts: number }[]>();
		const bcvMap = new Map<number, number>();
		for (const proj of projections || []) {
			if (!projectionMap.has(proj.element_id)) {
				projectionMap.set(proj.element_id, []);
			}
			projectionMap.get(proj.element_id)!.push({ gw: proj.gameweek, pts: proj.expected_points });
			// bcv lives on the meta of the next-GW row; take the first non-null we see
			let meta: any = (proj as any).meta;
			if (typeof meta === 'string') {
				try { meta = JSON.parse(meta); } catch { meta = null; }
			}
			if (!bcvMap.has(proj.element_id) && meta?.bcv != null) {
				bcvMap.set(proj.element_id, meta.bcv);
			}
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
			// Fallback if the replay couldn't run: the most recent purchase
			// (FPL lists transfers newest first), else the start price.
			const fallbackBuy = transfers.find((t) => t.element_in === pick.element)?.element_in_cost
				?? (priceData ? priceData.now_cost - priceData.cost_change_start : 0);
			const purchasePrice = purchasePriceMap.get(pick.element) ?? fallbackBuy;
			const uncertain = sellingUncertain.find((u) => u.id === pick.element);
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
				// Set when public data allows more than one selling price: the
				// user has to confirm which (FPL app > Transfers shows it).
				selling_options: uncertain?.options ?? null,
				// Projections + VFM (value-for-money, sourced from bcv)
				projections: playerProjections,
				bcv: bcvMap.get(pick.element) ?? null,
			};
		});

		// Compute available free transfers going INTO the next (planned) gameweek.
		// There is no transfer at GW1 (you just pick your initial squad), so free
		// transfers only start to exist from GW2. You get 1 free transfer at GW2,
		// then each subsequent gameweek you bank +1 (capped at 5), minus transfers
		// made that GW. Wildcard/Free-Hit gameweeks don't consume banked FTs.
		let freeTransfers = 1;
		try {
			const transfersByGw = new Map<number, number>();
			for (const t of transfers) {
				transfersByGw.set(t.event, (transfersByGw.get(t.event) || 0) + 1);
			}
			const chipByGw = new Map<number, string>();
			for (const c of chips) {
				if (c.name === 'wildcard' || c.name === 'freehit') {
					chipByGw.set(c.event, c.name);
				}
			}

			if (nextGw <= 2) {
				freeTransfers = 1;  // GW2 is the first week a free transfer exists
			} else {
				let ft = 1;  // the GW2 allowance
				// process completed gameweeks from GW2 up to the one before nextGw
				for (let gw = 2; gw < nextGw; gw++) {
					if (gw > 2) ft = Math.min(5, ft + 1);   // bank +1 at the start of each GW after GW2
					if (chipByGw.has(gw)) continue;          // WC/FH: transfers free, bank untouched
					const made = transfersByGw.get(gw) || 0;
					ft = Math.max(0, ft - made);
				}
				// bank the +1 for the upcoming (nextGw)
				ft = Math.min(5, ft + 1);
				freeTransfers = ft;
			}
		} catch {
			freeTransfers = 1;
		}

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
			total_points: shownPicks.entry_history.total_points,
			gameweek: shownPicks.entry_history.event,
			transfers_made: transfers.length,
			free_transfers: freeTransfers,
			active_chip: shownPicks.active_chip,
			// Purchase prices rebuilt and checked against FPL's own figures.
			prices_verified: pricesVerified,
			price_problems: priceProblems,
		});
	} catch (e: any) {
		if (e.status) throw e;  // Re-throw SvelteKit errors
		console.error('Squad load error:', e);
		throw error(500, `Failed to load squad: ${e.message}`);
	}
};
