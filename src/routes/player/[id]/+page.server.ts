import { supabase } from '$lib/supabase';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const elementId = parseInt(params.id);

	if (isNaN(elementId)) {
		throw error(404, 'Player not found');
	}

	// Get player info
	const { data: player } = await supabase
		.from('players')
		.select('*, teams!inner(name, short_name, code)')
		.eq('element_id', elementId)
		.single();

	if (!player) {
		throw error(404, 'Player not found');
	}

	// Get timeline (all snapshots for this player)
	const { data: timeline } = await supabase
		.from('player_snapshots')
		.select(`
			snapshot_id, now_cost, transfers_in, transfers_out,
			transfers_in_event, transfers_out_event, selected_by_percent,
			price_change_percent, price_change_hourly_rate, price_change_projections,
			total_points, event_points, form, ep_next, ep_this, status, news,
			minutes, goals_scored, assists, clean_sheets,
			expected_goals, expected_assists, expected_goal_involvements,
			snapshots!inner(timestamp)
		`)
		.eq('element_id', elementId)
		.order('snapshot_id', { ascending: true });

	// Get price changes for this player
	const { data: priceChanges } = await supabase
		.from('price_changes')
		.select('*')
		.eq('element_id', elementId)
		.order('detected_at', { ascending: false });

	// Get latest CSV data if available
	const { data: csvData } = await supabase
		.from('csv_imports')
		.select('*')
		.eq('element_id', elementId)
		.order('gameweek', { ascending: false })
		.limit(1)
		.single();

	// Get next GW (for offset calculation)
	const { data: nextEvent } = await supabase
		.from('events')
		.select('event_id')
		.eq('is_next', true)
		.limit(1)
		.single();

	return {
		player,
		timeline: timeline || [],
		priceChanges: priceChanges || [],
		csvData,
		nextGw: nextEvent?.event_id || 2,
	};
};
