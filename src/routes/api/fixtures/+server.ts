import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase-server';
import type { RequestHandler } from './$types';

/**
 * Fixtures for a range of gameweeks, with club short names.
 * GET /api/fixtures?from=12&to=19
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const from = parseInt(url.searchParams.get('from') || '1');
	const to = parseInt(url.searchParams.get('to') || String(from + 7));
	const [{ data: fixtures, error: fe }, { data: teams, error: te }] = await Promise.all([
		supabaseAdmin
			.from('fixtures')
			.select('event, team_h, team_a, team_h_difficulty, team_a_difficulty, kickoff_time')
			.gte('event', from)
			.lte('event', to)
			.order('kickoff_time'),
		supabaseAdmin.from('teams').select('team_id, short_name')
	]);
	if (fe || te) return json({ error: (fe || te)!.message }, { status: 500 });
	setHeaders({ 'cache-control': 'public, max-age=600' });
	return json({
		teams: Object.fromEntries((teams ?? []).map((t) => [t.team_id, t.short_name])),
		fixtures: fixtures ?? []
	});
};
