import { supabase } from '$lib/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const search = url.searchParams.get('q') || '';
	const team = url.searchParams.get('team') || '';
	const position = url.searchParams.get('pos') || '';
	const sort = url.searchParams.get('sort') || 'total_points';
	const order = url.searchParams.get('order') || 'desc';

	// Get latest snapshot id
	const { data: latestSnap } = await supabase
		.from('snapshots')
		.select('snapshot_id')
		.order('snapshot_id', { ascending: false })
		.limit(1)
		.single();

	if (!latestSnap) {
		return { players: [], teams: [], filters: { search, team, position, sort, order } };
	}

	// Build query
	let query = supabase
		.from('player_snapshots')
		.select(`
			element_id, now_cost, total_points, event_points, form, points_per_game,
			selected_by_percent, price_change_percent, price_change_hourly_rate,
			transfers_in_event, transfers_out_event, ep_next, status, news,
			players!inner(web_name, first_name, second_name, code, element_type, team_id, teams!inner(short_name, code, name))
		`)
		.eq('snapshot_id', latestSnap.snapshot_id);

	// Filters
	if (search) {
		query = query.ilike('players.web_name', `%${search}%`);
	}
	if (position) {
		query = query.eq('players.element_type', parseInt(position));
	}

	// Sort
	const validSorts = ['total_points', 'now_cost', 'form', 'selected_by_percent', 'price_change_percent', 'transfers_in_event', 'ep_next'];
	const sortCol = validSorts.includes(sort) ? sort : 'total_points';
	query = query.order(sortCol, { ascending: order === 'asc' });

	query = query.limit(100);

	const { data: players } = await query;

	// Get teams for filter
	const { data: teams } = await supabase
		.from('teams')
		.select('team_id, short_name, name, code')
		.order('name');

	// Filter by team client-side (Supabase nested filtering is limited)
	let filtered = players || [];
	if (team) {
		filtered = filtered.filter((p: any) => {
			const t = Array.isArray(p.players) ? p.players[0] : p.players;
			const tm = t?.teams ? (Array.isArray(t.teams) ? t.teams[0] : t.teams) : {};
			return tm.short_name === team;
		});
	}

	return {
		players: filtered,
		teams: teams || [],
		filters: { search, team, position, sort, order }
	};
};
