import { supabase } from '$lib/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Get latest snapshot id
	const { data: latestSnap } = await supabase
		.from('snapshots')
		.select('snapshot_id')
		.order('snapshot_id', { ascending: false })
		.limit(1)
		.single();

	if (!latestSnap) {
		return { players: [], teams: [] };
	}

	// Get ALL players with latest snapshot data (filter client-side for reactivity)
	const { data: players } = await supabase
		.from('player_snapshots')
		.select(`
			element_id, now_cost, total_points, event_points, form, points_per_game,
			selected_by_percent, price_change_percent, price_change_hourly_rate,
			transfers_in_event, transfers_out_event, ep_next, ep_this, status, news,
			minutes, goals_scored, assists, clean_sheets, expected_goals, expected_assists,
			players!inner(web_name, first_name, second_name, code, element_type, team_id, teams!inner(short_name, code, name))
		`)
		.eq('snapshot_id', latestSnap.snapshot_id);

	// Get teams for filter
	const { data: teams } = await supabase
		.from('teams')
		.select('team_id, short_name, name, code')
		.order('name');

	// Get CSV expected points data (latest gameweek)
	const { data: csvData } = await supabase
		.from('csv_imports')
		.select('element_id, bcv, projected_sum, gw1, gw2, gw3, gw4, gw5, gw6, gw7, gw8, ppg_longer_term')
		.order('gameweek', { ascending: false })
		.limit(700);

	// Build a lookup of CSV data by element_id
	const csvLookup: Record<number, any> = {};
	for (const row of csvData || []) {
		if (!csvLookup[row.element_id]) {
			csvLookup[row.element_id] = row;
		}
	}

	return {
		players: players || [],
		teams: teams || [],
		csvLookup
	};
};
