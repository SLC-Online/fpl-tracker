import { json, type Handle } from '@sveltejs/kit';
import { isProtectedPath, sessionIsValid, SESSION_COOKIE } from '$lib/server/admin-auth';

/**
 * Gate the admin area: admin pages redirect to the sign-in page, admin API
 * endpoints answer 401. Public pages and APIs are untouched.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { pathname, search } = event.url;

	if (isProtectedPath(pathname) && !(await sessionIsValid(event.cookies.get(SESSION_COOKIE)))) {
		if (pathname.startsWith('/api/')) {
			return json({ error: 'unauthorised', message: 'Sign in to admin first.' }, { status: 401 });
		}
		return new Response(null, {
			status: 303,
			headers: { location: `/admin/login?next=${encodeURIComponent(pathname + search)}` }
		});
	}

	const response = await resolve(event);
	if (pathname.startsWith('/admin') || isProtectedPath(pathname)) {
		response.headers.set('X-Robots-Tag', 'noindex, nofollow');
		response.headers.set('Cache-Control', 'private, no-store');
	}
	return response;
};
