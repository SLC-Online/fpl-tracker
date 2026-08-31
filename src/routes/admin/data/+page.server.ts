import { supabaseAdmin } from '$lib/supabase-server';
import type { PageServerLoad } from './$types';

/**
 * Data observability page.
 *
 * Every scrape/import is stored as a timestamped CAPTURE (deduplicated — a new
 * capture is only created when the data actually changed). This page lets you:
 *   - see every source and all its captures over time
 *   - drill into any single capture to see the exact numbers it recorded
 *   - see the hourly price/player snapshot history
 *
 * Query params:
 *   ?capture=<id>   → drill into one capture's per-player rows
 */
export const load: PageServerLoad = async ({ url }) => {
	// --- All projection sources ---
	const { data: sources } = await supabaseAdmin
		.from('projection_sources')
		.select('id, source_name, description, weight, active, created_at')
		.order('id');
	const sourceList = sources || [];

	// --- Drill-down into a single capture ---
	const captureParam = url.searchParams.get('capture');
	if (captureParam) {
		const captureId = parseInt(captureParam);

		const { data: capture } = await supabaseAdmin
			.from('projection_captures')
			.select('id, source_id, season, uploaded_for_gw, captured_at, content_hash, row_count, player_count, meta')
			.eq('id', captureId)
			.single();

		let drillDown: any = null;
		if (capture) {
			// Pull all rows for this capture, joined to player info
			const rows: any[] = [];
			let offset = 0;
			const PAGE = 1000;
			while (true) {
				const { data: batch } = await supabaseAdmin
					.from('projection_inputs')
					.select(`element_id, gameweek, expected_points, meta,
						players!inner(web_name, element_type, teams!inner(short_name))`)
					.eq('capture_id', captureId)
					.range(offset, offset + PAGE - 1);
				if (!batch || batch.length === 0) break;
				rows.push(...batch);
				if (batch.length < PAGE) break;
				offset += PAGE;
			}

			const byPlayer = new Map<number, any>();
			for (const r of rows) {
				const player = Array.isArray(r.players) ? r.players[0] : r.players;
				const team = player?.teams ? (Array.isArray(player.teams) ? player.teams[0] : player.teams) : {};
				let entry = byPlayer.get(r.element_id);
				if (!entry) {
					entry = {
						element_id: r.element_id,
						web_name: player?.web_name || `#${r.element_id}`,
						team_short: team?.short_name || '',
						element_type: player?.element_type || 0,
						gws: {} as Record<number, number>,
					};
					byPlayer.set(r.element_id, entry);
				}
				entry.gws[r.gameweek] = r.expected_points;
			}

			const source = sourceList.find(s => s.id === capture.source_id);
			const gwCols = [...new Set(rows.map(r => r.gameweek))].sort((a, b) => a - b);
			drillDown = {
				capture,
				source_name: source?.source_name || `#${capture.source_id}`,
				gwCols,
				players: [...byPlayer.values()].sort((a, b) => {
					const firstGw = gwCols[0];
					return (b.gws[firstGw] || 0) - (a.gws[firstGw] || 0);
				}),
			};
		}

		return { sources: sourceList, drillDown, capturesBySource: {}, recentSnapshots: [], totalSnapshots: 0 };
	}

	// --- Overview: all captures per source ---
	const capturesBySource: Record<number, any[]> = {};
	for (const src of sourceList) {
		const { data: caps } = await supabaseAdmin
			.from('projection_captures')
			.select('id, uploaded_for_gw, captured_at, row_count, player_count, meta')
			.eq('source_id', src.id)
			.order('captured_at', { ascending: false })
			.limit(200);
		capturesBySource[src.id] = caps || [];
	}

	// --- Price / player snapshot history ---
	const { data: recentSnapshots } = await supabaseAdmin
		.from('snapshots')
		.select('snapshot_id, timestamp, source, players_count')
		.order('snapshot_id', { ascending: false })
		.limit(50);

	const { count: totalSnapshots } = await supabaseAdmin
		.from('snapshots')
		.select('*', { count: 'exact', head: true });

	return {
		sources: sourceList,
		capturesBySource,
		recentSnapshots: recentSnapshots || [],
		totalSnapshots: totalSnapshots || 0,
		drillDown: null,
	};
};
