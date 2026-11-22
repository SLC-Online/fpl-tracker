import { fail, redirect } from '@sveltejs/kit';
import {
	adminConfigured, clearFailures, createSessionToken, isLockedOut, passwordMatches,
	recordFailure, safeNext, sessionIsValid, SESSION_COOKIE, SESSION_DAYS
} from '$lib/server/admin-auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	if (await sessionIsValid(cookies.get(SESSION_COOKIE))) throw redirect(303, safeNext(url.searchParams.get('next')));
	return { configured: adminConfigured() };
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		if (!adminConfigured()) return fail(503, { error: 'not_configured' });

		const ip = getClientAddress();
		if (isLockedOut(ip)) return fail(429, { error: 'locked' });

		const form = await request.formData();
		const password = String(form.get('password') ?? '');

		if (!(await passwordMatches(password))) {
			recordFailure(ip);
			await new Promise((r) => setTimeout(r, 700));   // slow down guessing
			return fail(401, { error: 'wrong' });
		}

		clearFailures(ip);
		cookies.set(SESSION_COOKIE, await createSessionToken(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: SESSION_DAYS * 86_400
		});
		throw redirect(303, safeNext(url.searchParams.get('next')));
	}
};
