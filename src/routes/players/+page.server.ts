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

	// Get next GW info
	const { data: nextEvent } = await supabase
		.from('events')
		.select('event_id')
		.eq('is_next', true)
		.limit(1)
		.single();
	const nextGw = nextEvent?.event_id || 2;

	// Get the latest uploaded_for_gw from final projections
	const { data: latestUpload } = await supabase
		.from('final_projections')
		.select('uploaded_for_gw')
		.order('uploaded_for_gw', { ascending: false })
		.limit(1)
		.single();
	const latestUploadGw = latestUpload?.uploaded_for_gw || 1;

	// Fetch final projections (one row per player per GW — the definitive numbers)
	const elementIds = (players || []).map((p: any) => p.element_id);
	const projMap: Record<number, { gw: number; pts: number }[]> = {};

	const BATCH_SIZE = 80;
	for (let i = 0; i < elementIds.length; i += BATCH_SIZE) {
		const batch = elementIds.slice(i, i + BATCH_SIZE);
		const { data: projBatch } = await supabase
			.from('final_projections')
			.select('element_id, gameweek, expected_points')
			.in('element_id', batch)
			.eq('uploaded_for_gw', latestUploadGw)
			.gte('gameweek', nextGw)
			.lte('gameweek', nextGw + 7)
			.order('gameweek')
			.limit(1000);

		for (const proj of projBatch || []) {
			if (!projMap[proj.element_id]) projMap[proj.element_id] = [];
			projMap[proj.element_id].push({ gw: proj.gameweek, pts: proj.expected_points });
		}
	}

	// Also get CSV data (for the expanded row details / BCV which stays internal)
	const { data: csvData } = await supabase
		.from('csv_imports')
		.select('element_id, bcv, projected_sum, gw1, gw2, gw3, gw4, gw5, gw6, gw7, gw8, ppg_longer_term, gameweek')
		.order('gameweek', { ascending: false })
		.limit(700);

	const csvLookup: Record<number, any> = {};
	for (const row of csvData || []) {
		if (!csvLookup[row.element_id]) {
			csvLookup[row.element_id] = row;
		}
	}

	// Get current GW info
	const { data: currentEvent } = await supabase
		.from('events')
		.select('event_id, is_current, is_next, finished, deadline_time')
		.eq('is_current', true)
		.limit(1)
		.single();

	// csvGwOffset for backwards compat with expanded row view
	let csvGwOffset = 0;
	if (nextEvent && csvData && csvData.length > 0) {
		const csvGameweek = csvData[0]?.gameweek || 1;
		csvGwOffset = Math.max(0, nextGw - csvGameweek);
	}

	return {
		players: players || [],
		teams: teams || [],
		csvLookup,
		csvGwOffset,
		projMap,
		currentGw: currentEvent?.event_id || 1,
		nextGw,
	};
};
