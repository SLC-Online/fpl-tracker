import { supabaseAdmin } from '$lib/supabase-server';
import type { PageServerLoad } from './$types';

/**
 * Data observability page.
 *
 * For each projection source, shows what data has been captured:
 *  - which "snapshots" (uploaded_for_gw versions) exist
 *  - how many players / rows in each
 *  - when it was last captured (created_at)
 *  - the range of gameweeks projected
 *
 * Also surfaces the price-snapshot history (snapshots table) so you can see
 * how frequently player data is being captured.
 *
 * Optional query params:
 *   ?source=<id>&gw=<uploaded_for_gw>  → drill into a specific snapshot's rows
 */
export const load: PageServerLoad = async ({ url }) => {
	// --- 1. All projection sources ---
	const { data: sources } = await supabaseAdmin
		.from('projection_sources')
		.select('id, source_name, description, weight, active, created_at')
		.order('id');

	const sourceList = sources || [];

	// --- 2. Per-source snapshot summary ---
	// Group projection_inputs by (source_id, uploaded_for_gw): count rows,
	// distinct players, gameweek range, latest created_at.
	// PostgREST can't GROUP BY, so we pull the lightweight columns and aggregate here.
	const summaries: Record<number, any[]> = {};
	for (const src of sourceList) {
		const bySnapshot = new Map<number, {
			uploaded_for_gw: number;
			rows: number;
			players: Set<number>;
			gwMin: number;
			gwMax: number;
			latest: string | null;
		}>();

		// Page through this source's rows (could be thousands)
		let offset = 0;
		const PAGE = 1000;
		while (true) {
			const { data: rows } = await supabaseAdmin
				.from('projection_inputs')
				.select('uploaded_for_gw, gameweek, element_id, created_at')
				.eq('source_id', src.id)
				.eq('season', '2026-27')
				.range(offset, offset + PAGE - 1);

			if (!rows || rows.length === 0) break;

			for (const r of rows) {
				let s = bySnapshot.get(r.uploaded_for_gw);
				if (!s) {
					s = {
						uploaded_for_gw: r.uploaded_for_gw,
						rows: 0,
						players: new Set(),
						gwMin: r.gameweek,
						gwMax: r.gameweek,
						latest: r.created_at,
					};
					bySnapshot.set(r.uploaded_for_gw, s);
				}
				s.rows++;
				s.players.add(r.element_id);
				if (r.gameweek < s.gwMin) s.gwMin = r.gameweek;
				if (r.gameweek > s.gwMax) s.gwMax = r.gameweek;
				if (r.created_at && (!s.latest || r.created_at > s.latest)) s.latest = r.created_at;
			}

			if (rows.length < PAGE) break;
			offset += PAGE;
		}

		summaries[src.id] = [...bySnapshot.values()]
			.map(s => ({
				uploaded_for_gw: s.uploaded_for_gw,
				rows: s.rows,
				players: s.players.size,
				gwMin: s.gwMin,
				gwMax: s.gwMax,
				latest: s.latest,
			}))
			.sort((a, b) => b.uploaded_for_gw - a.uploaded_for_gw);
	}

	// --- 3. Price snapshot history (how often player data is captured) ---
	const { data: recentSnapshots } = await supabaseAdmin
		.from('snapshots')
		.select('snapshot_id, timestamp, source, players_count')
		.order('snapshot_id', { ascending: false })
		.limit(50);

	const { count: totalSnapshots } = await supabaseAdmin
		.from('snapshots')
		.select('*', { count: 'exact', head: true });

	// --- 4. Drill-down: specific snapshot's rows (if requested) ---
	let drillDown: any = null;
	const drillSource = url.searchParams.get('source');
	const drillGw = url.searchParams.get('gw');
	if (drillSource && drillGw) {
		const sourceId = parseInt(drillSource);
		const uploadedForGw = parseInt(drillGw);

		// Get the rows for this snapshot, joined to player names
		const rows: any[] = [];
		let offset = 0;
		const PAGE = 1000;
		while (true) {
			const { data: batch } = await supabaseAdmin
				.from('projection_inputs')
				.select(`element_id, gameweek, expected_points, meta, created_at,
					players!inner(web_name, element_type, teams!inner(short_name))`)
				.eq('source_id', sourceId)
				.eq('uploaded_for_gw', uploadedForGw)
				.eq('season', '2026-27')
				.order('element_id')
				.range(offset, offset + PAGE - 1);
			if (!batch || batch.length === 0) break;
			rows.push(...batch);
			if (batch.length < PAGE) break;
			offset += PAGE;
		}

		// Pivot: one entry per player, with a map of gameweek -> points
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
					created_at: r.created_at,
				};
				byPlayer.set(r.element_id, entry);
			}
			entry.gws[r.gameweek] = r.expected_points;
		}

		const source = sourceList.find(s => s.id === sourceId);
		const gwCols = [...new Set(rows.map(r => r.gameweek))].sort((a, b) => a - b);
		drillDown = {
			source_name: source?.source_name || `#${sourceId}`,
			uploaded_for_gw: uploadedForGw,
			gwCols,
			players: [...byPlayer.values()].sort((a, b) => {
				// sort by first gw's points desc
				const firstGw = gwCols[0];
				return (b.gws[firstGw] || 0) - (a.gws[firstGw] || 0);
			}),
		};
	}

	return {
		sources: sourceList,
		summaries,
		recentSnapshots: recentSnapshots || [],
		totalSnapshots: totalSnapshots || 0,
		drillDown,
	};
};
