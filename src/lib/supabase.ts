import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
	if (!_client) {
		_client = createClient(
			env.PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
			env.PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
		);
	}
	return _client;
}

// For convenience in existing code
export const supabase = new Proxy({} as SupabaseClient, {
	get(_target, prop) {
		return (getSupabase() as any)[prop];
	}
});
