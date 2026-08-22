import { supabase } from '$lib/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { data: priceChanges } = await supabase
		.from('price_changes')
		.select(`
			id, element_id, old_cost, new_cost, change, detected_at,
			transfers_in_event, transfers_out_event, selected_by_percent,
			price_change_percent, price_change_hourly_rate,
			players!inner(web_name, code, element_type, teams!inner(short_name, code))
		`)
		.order('detected_at', { ascending: false })
		.limit(100);

	return { priceChanges: priceChanges || [] };
};
