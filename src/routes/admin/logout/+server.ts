import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/admin-auth';
import type { RequestHandler } from './$types';

/** Sign out: POST only (SvelteKit's built-in CSRF check covers form posts). */
export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	throw redirect(303, '/');
};
