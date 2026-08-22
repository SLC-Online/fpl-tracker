import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
	if (!_client) {
		_client = createClient(
			publicEnv.PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
			env.SUPABASE_SERVICE_KEY || 'placeholder'
		);
	}
	return _client;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
	get(_target, prop) {
		return (getSupabaseAdmin() as any)[prop];
	}
});
