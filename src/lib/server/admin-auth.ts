/**
 * Admin sign-in: one password (ADMIN_PASSWORD, set in Vercel) and a signed,
 * HttpOnly session cookie. No user accounts.
 *
 * The cookie holds an expiry time plus an HMAC of it, keyed from the password,
 * so it can't be forged, and changing the password signs everyone out.
 * If ADMIN_PASSWORD isn't set, admin stays locked (fails closed).
 * Uses Web Crypto, so it runs on any runtime without extra dependencies.
 */
import { env } from '$env/dynamic/private';

export const SESSION_COOKIE = 'fpls_admin';
export const SESSION_DAYS = 30;

/** Paths that need an admin session. Everything else stays public. */
export function isProtectedPath(pathname: string): boolean {
	if (pathname === '/admin/login') return false;
	return (
		pathname === '/admin' || pathname.startsWith('/admin/') ||
		pathname.startsWith('/api/import') ||
		pathname.startsWith('/api/matching-issues') ||
		pathname.startsWith('/api/ta-sync')
	);
}

export function adminConfigured(): boolean {
	return Boolean(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 12);
}

const enc = new TextEncoder();

async function hmac(key: string, message: string): Promise<Uint8Array> {
	const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time comparison: compare fixed-length digests so neither content nor length leaks. */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const [da, db] = await Promise.all([hmac('cmp', a), hmac('cmp', b)]);
	let diff = 0;
	for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
	return diff === 0;
}

async function sign(payload: string): Promise<string> {
	return b64url(await hmac(`fpl-sorted-admin-session:${env.ADMIN_PASSWORD ?? ''}`, payload));
}

export async function passwordMatches(attempt: string): Promise<boolean> {
	if (!adminConfigured()) return false;
	return safeEqual(attempt, env.ADMIN_PASSWORD!);
}

export async function createSessionToken(now = Date.now()): Promise<string> {
	const payload = `v1.${now + SESSION_DAYS * 86_400_000}`;
	return `${payload}.${await sign(payload)}`;
}

export async function sessionIsValid(token: string | undefined, now = Date.now()): Promise<boolean> {
	if (!token || !adminConfigured()) return false;
	const i = token.lastIndexOf('.');
	if (i < 0) return false;
	const payload = token.slice(0, i);
	const [version, exp] = payload.split('.');
	if (version !== 'v1' || !/^\d+$/.test(exp ?? '') || Number(exp) < now) return false;
	return safeEqual(token.slice(i + 1), await sign(payload));
}

/** Only allow redirects back into the admin area (no open redirects). */
export function safeNext(next: string | null): string {
	return next && /^\/admin(\/[\w\-/?=&.%]*)?$/.test(next) && !next.startsWith('/admin/login') ? next : '/admin';
}

// --- Slow down password guessing -------------------------------------------
// Per server instance (serverless instances are short-lived, so this is a speed
// bump on top of a long password, not a hard guarantee).
const failures = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export function isLockedOut(ip: string, now = Date.now()): boolean {
	const f = failures.get(ip);
	if (!f) return false;
	if (now - f.first > WINDOW_MS) {
		failures.delete(ip);
		return false;
	}
	return f.count >= MAX_FAILURES;
}

export function recordFailure(ip: string, now = Date.now()): void {
	const f = failures.get(ip);
	if (!f || now - f.first > WINDOW_MS) failures.set(ip, { count: 1, first: now });
	else f.count++;
}

export function clearFailures(ip: string): void {
	failures.delete(ip);
}
