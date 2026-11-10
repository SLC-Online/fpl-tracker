import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/supabase-server';
import type { RequestHandler } from './$types';

/**
 * Transfer Algorithm sync status + manual trigger.
 *
 * The Patreon import runs as a GitHub Actions workflow (scheduled, plus manual
 * dispatch) in the scraper repo. This endpoint lets the admin panel
 *   GET  → show when TA data was last captured and how the latest import run went
 *   POST → kick off that same workflow on demand (optionally forcing a re-import)
 *
 * Reading run status works with no credentials (the repo is public). Triggering
 * needs GITHUB_TOKEN: a fine-grained personal access token scoped to the scraper
 * repo with "Actions: Read and write".
 */

const REPO = 'SLC-Online/fpl-price-tracker';
const WORKFLOW = 'scrape_patreon.yml';
const API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;
const COOLDOWN_MS = 45_000;

function ghHeaders(withToken: boolean): Record<string, string> {
	const h: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'fpl-tracker-admin'
	};
	if (withToken && env.GITHUB_TOKEN) h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
	return h;
}

type Run = { status: string; conclusion: string | null; createdAt: string; event: string };

/** Latest workflow run, or null if GitHub can't be reached. */
async function latestRun(): Promise<Run | null> {
	const url = `${API}/runs?per_page=1`;
	try {
		// Prefer the token (higher rate limit); fall back to anonymous if it's
		// rejected so an expired token can't take the status display down.
		let res = await fetch(url, { headers: ghHeaders(true) });
		if ((res.status === 401 || res.status === 403) && env.GITHUB_TOKEN) {
			res = await fetch(url, { headers: ghHeaders(false) });
		}
		if (!res.ok) return null;
		const body = await res.json();
		const r = body.workflow_runs?.[0];
		if (!r) return null;
		return { status: r.status, conclusion: r.conclusion, createdAt: r.created_at, event: r.event };
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async () => {
	const { data: source } = await supabaseAdmin
		.from('projection_sources')
		.select('id')
		.eq('source_name', 'transfer_algorithm')
		.single();

	let capture = null;
	if (source) {
		const { data } = await supabaseAdmin
			.from('projection_captures')
			.select('captured_at, uploaded_for_gw, row_count, player_count')
			.eq('source_id', source.id)
			.order('captured_at', { ascending: false })
			.limit(1);
		capture = data?.[0] ?? null;
	}

	return json({
		capture,
		run: await latestRun(),
		canTrigger: Boolean(env.GITHUB_TOKEN)
	});
};

export const POST: RequestHandler = async ({ request }) => {
	if (!env.GITHUB_TOKEN) {
		return json(
			{ error: 'not_configured', message: 'Manual sync needs a GITHUB_TOKEN environment variable.' },
			{ status: 503 }
		);
	}

	const body = await request.json().catch(() => ({}));
	const force = body?.force === true;

	// Don't stack runs: refuse while one is in flight or just started.
	const run = await latestRun();
	if (run && run.status !== 'completed') {
		return json({ error: 'already_running', message: 'An import is already running.' }, { status: 409 });
	}
	if (run && Date.now() - new Date(run.createdAt).getTime() < COOLDOWN_MS) {
		return json({ error: 'cooldown', message: 'An import just ran — give it a moment.' }, { status: 429 });
	}

	const res = await fetch(`${API}/dispatches`, {
		method: 'POST',
		headers: { ...ghHeaders(true), 'Content-Type': 'application/json' },
		body: JSON.stringify({ ref: 'main', inputs: { force_reimport: force ? 'true' : 'false' } })
	});

	if (res.status !== 204) {
		const detail = await res.text().catch(() => '');
		console.error('workflow dispatch failed', res.status, detail.slice(0, 300));
		return json(
			{ error: 'dispatch_failed', message: `GitHub refused the request (${res.status}). Check the token's permissions.` },
			{ status: 502 }
		);
	}

	return json({ ok: true, triggeredAt: new Date().toISOString() });
};
