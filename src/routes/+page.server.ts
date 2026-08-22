import { supabase } from '$lib/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Get latest snapshot info
	const { data: latestSnapshot } = await supabase
		.from('snapshots')
		.select('snapshot_id, timestamp, players_count')
		.order('snapshot_id', { ascending: false })
		.limit(1)
		.single();

	if (!latestSnapshot) {
		return { players: [], risers: [], fallers: [], snapshot: null, priceChanges: [] };
	}

	// Get top risers (highest price_change_percent)
	const { data: risers } = await supabase
		.from('player_snapshots')
		.select(`
			element_id, now_cost, price_change_percent, price_change_hourly_rate,
			transfers_in_event, transfers_out_event, selected_by_percent,
			players!inner(web_name, code, team_id, element_type, teams!inner(short_name, code))
		`)
		.eq('snapshot_id', latestSnapshot.snapshot_id)
		.not('price_change_percent', 'is', null)
		.order('price_change_percent', { ascending: false })
		.limit(15);

	// Get top fallers (most negative price_change_percent)
	const { data: fallers } = await supabase
		.from('player_snapshots')
		.select(`
			element_id, now_cost, price_change_percent, price_change_hourly_rate,
			transfers_in_event, transfers_out_event, selected_by_percent,
			players!inner(web_name, code, team_id, element_type, teams!inner(short_name, code))
		`)
		.eq('snapshot_id', latestSnapshot.snapshot_id)
		.not('price_change_percent', 'is', null)
		.order('price_change_percent', { ascending: true })
		.limit(15);

	// Get recent price changes
	const { data: priceChanges } = await supabase
		.from('price_changes')
		.select(`
			id, element_id, old_cost, new_cost, change, detected_at,
			transfers_in_event, transfers_out_event, selected_by_percent,
			players!inner(web_name, code, teams!inner(short_name, code))
		`)
		.order('detected_at', { ascending: false })
		.limit(20);

	return {
		snapshot: latestSnapshot,
		risers: risers || [],
		fallers: fallers || [],
		priceChanges: priceChanges || []
	};
};
