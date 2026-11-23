import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * FPL's live game rules (squad shape, club limit, transfer settings, chips)
 * for the solver. Read from FPL each time so a rule change is picked up; the
 * solver compares them with the settings it was tested against.
 */
export const GET: RequestHandler = async ({ setHeaders }) => {
	const resp = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
		headers: { 'User-Agent': 'Mozilla/5.0 (FPL Sorted)' },
		signal: AbortSignal.timeout(8000)
	});
	if (!resp.ok) throw error(502, `FPL returned ${resp.status}`);
	const bs = await resp.json();
	setHeaders({ 'cache-control': 'public, max-age=600' });
	return json({
		game_settings: bs.game_settings,
		element_types: bs.element_types.map((e: any) => ({
			id: e.id, squad_select: e.squad_select, squad_min_play: e.squad_min_play,
			squad_max_play: e.squad_max_play, singular_name_short: e.singular_name_short
		})),
		chips: (bs.chips ?? []).map((c: any) => ({ name: c.name, start_event: c.start_event, stop_event: c.stop_event }))
	});
};
