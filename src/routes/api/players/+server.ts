import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase-server';
import type { RequestHandler } from './$types';

/**
 * Search players for the transfer picker.
 * GET /api/players?q=salah&pos=3&max_price=130
 */
export const GET: RequestHandler = async ({ url }) => {
	const search = url.searchParams.get('q') || '';
	const position = url.searchParams.get('pos') || '';
	const maxPrice = parseInt(url.searchParams.get('max_price') || '0');
	const excludeIds = (url.searchParams.get('exclude') || '').split(',').filter(Boolean).map(Number);

	// Get latest snapshot
	const { data: latestSnap } = await supabaseAdmin
		.from('snapshots')
		.select('snapshot_id')
		.order('snapshot_id', { ascending: false })
		.limit(1)
		.single();

	if (!latestSnap) return json([]);

	// Query players with current prices
	let query = supabaseAdmin
		.from('player_snapshots')
		.select(`
			element_id, now_cost, form, total_points, points_per_game,
			selected_by_percent, ep_next, ep_this, status, news,
			transfers_in_event, transfers_out_event,
			expected_goals, expected_assists, expected_goal_involvements,
			minutes, goals_scored, assists, clean_sheets,
			players!inner(web_name, first_name, second_name, code, element_type, team_id,
				teams!inner(short_name, code, name))
		`)
		.eq('snapshot_id', latestSnap.snapshot_id);

	if (maxPrice > 0) {
		query = query.lte('now_cost', maxPrice);
	}

	if (search) {
		// Search across web_name, first_name, second_name
		// Also try without common prefixes like "M." to handle "Sangare" matching "M.Sangaré"
		const cleanSearch = search.replace(/^[A-Z]\.\s*/, '');
		query = query.or(
			`web_name.ilike.%${search}%,first_name.ilike.%${search}%,second_name.ilike.%${search}%,web_name.ilike.%${cleanSearch}%,second_name.ilike.%${cleanSearch}%`,
			{ referencedTable: 'players' }
		);
	}

	if (position) {
		query = query.eq('players.element_type', parseInt(position));
	}

	const limit = search ? 50 : 700;  // Load all when no search filter
	const { data: players } = await query.order('total_points', { ascending: false }).limit(limit);

	if (!players) return json([]);

	// Get projections for these players
	const elementIds = players.map((p: any) => p.element_id);

	// Get current/next GW info
	const { data: nextEvent } = await supabaseAdmin
		.from('events')
		.select('event_id')
		.eq('is_next', true)
		.limit(1)
		.single();
	const nextGw = nextEvent?.event_id || 2;

	// Get latest upload from final projections
	const { data: latestUpload } = await supabaseAdmin
		.from('final_projections')
		.select('uploaded_for_gw')
		.order('uploaded_for_gw', { ascending: false })
		.limit(1)
		.single();
	const latestUploadGw = latestUpload?.uploaded_for_gw || 1;

	// Fetch final projections (definitive numbers) in batches
	const projMap = new Map<number, { gw: number; pts: number }[]>();

	const BATCH_SIZE = 80;
	for (let i = 0; i < elementIds.length; i += BATCH_SIZE) {
		const batch = elementIds.slice(i, i + BATCH_SIZE);
		const { data: projBatch } = await supabaseAdmin
			.from('final_projections')
			.select('element_id, gameweek, expected_points')
			.in('element_id', batch)
			.eq('uploaded_for_gw', latestUploadGw)
			.gte('gameweek', nextGw)
			.lte('gameweek', nextGw + 7)
			.order('gameweek')
			.limit(1000);

		for (const proj of projBatch || []) {
			if (!projMap.has(proj.element_id)) projMap.set(proj.element_id, []);
			projMap.get(proj.element_id)!.push({ gw: proj.gameweek, pts: proj.expected_points });
		}
	}

	// Get BCV from final projections meta
	const { data: metaData } = await supabaseAdmin
		.from('final_projections')
		.select('element_id, meta')
		.eq('uploaded_for_gw', latestUploadGw)
		.eq('gameweek', nextGw)
		.limit(1000);

	const bcvMap = new Map<number, number>();
	for (const m of metaData || []) {
		if (!bcvMap.has(m.element_id) && m.meta?.bcv != null) {
			bcvMap.set(m.element_id, m.meta.bcv);
		}
	}

	const result = players
		.filter((p: any) => !excludeIds.includes(p.element_id))
		.map((p: any) => {
			const player = Array.isArray(p.players) ? p.players[0] : p.players;
			const team = player?.teams ? (Array.isArray(player.teams) ? player.teams[0] : player.teams) : {};
			return {
				element_id: p.element_id,
				web_name: player.web_name,
				first_name: player.first_name,
				second_name: player.second_name,
				code: player.code,
				element_type: player.element_type,
				team_id: player.team_id,
				team_short: team.short_name,
				team_code: team.code,
				team_name: team.name,
				now_cost: p.now_cost,
				form: p.form,
				total_points: p.total_points,
				points_per_game: p.points_per_game,
				selected_by_percent: p.selected_by_percent,
				ep_next: p.ep_next,
				ep_this: p.ep_this,
				status: p.status,
				news: p.news,
				transfers_in_event: p.transfers_in_event,
				transfers_out_event: p.transfers_out_event,
				expected_goals: p.expected_goals,
				expected_assists: p.expected_assists,
				expected_goal_involvements: p.expected_goal_involvements,
				minutes: p.minutes,
				goals_scored: p.goals_scored,
				assists: p.assists,
				clean_sheets: p.clean_sheets,
				projections: projMap.get(p.element_id) || [],
				bcv: bcvMap.get(p.element_id) ?? null,
			};
		});

	return json(result);
};
