import { json, error } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase-server';
import type { RequestHandler } from './$types';

/**
 * GET: Fetch unresolved matching issues
 * POST: Resolve a matching issue (set element_id for a csv_name+team)
 */

export const GET: RequestHandler = async () => {
	const { data: issues } = await supabaseAdmin
		.from('csv_name_mapping')
		.select('id, csv_name, csv_team, element_id, confidence, source, season, notes')
		.eq('source', 'unmatched')
		.is('element_id', null)
		.order('season', { ascending: false })
		.limit(50);

	return json(issues || []);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { id, element_id } = body;

	if (!id || !element_id) {
		throw error(400, 'id and element_id required');
	}

	const { error: dbError } = await supabaseAdmin
		.from('csv_name_mapping')
		.update({ element_id, source: 'manual', confidence: 1.0 })
		.eq('id', id);

	if (dbError) {
		throw error(500, dbError.message);
	}

	return json({ success: true });
};
