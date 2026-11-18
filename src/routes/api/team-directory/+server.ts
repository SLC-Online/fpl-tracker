import { json } from '@sveltejs/kit';
import { getEntry, getLeagueStandingsPage } from '$lib/server/fpl-api';
import type { RequestHandler } from './$types';

/**
 * Searchable directory of FPL teams, for name search on the Transfer Planner.
 *
 * FPL has no "search teams by name" endpoint. What it does expose is each
 * team's leagues and each league's standings (team name, manager name, ID).
 * So given some "seed" teams (the user's saved + recently viewed teams), we
 * list everyone in those teams' private mini-leagues. That makes friends and
 * rivals findable by name; a stranger in none of those leagues is not.
 *
 * Public/system leagues (Overall, country, etc.) and big private leagues are
 * skipped — they run to thousands or millions of teams.
 *
 *   GET ?seeds=403851,9919536
 *   → { teams: [{ id, team, manager, leagues: [name] }], leagues: [...], skipped: [...] }
 */

const MAX_SEEDS = 12;
const MAX_LEAGUES = 25;
const MAX_LEAGUE_SIZE = 1000; // 20 pages of 50
const MAX_PAGES = MAX_LEAGUE_SIZE / 50;
const TTL_MS = 6 * 60 * 60 * 1000;

type Member = { id: number; team: string; manager: string };
type LeagueInfo = { id: number; name: string; size: number | null };

// Per-instance cache of league members. Serverless instances are short-lived,
// so this is a bonus on top of the CDN cache set on the response.
const leagueCache = new Map<number, { at: number; members: Member[] }>();

async function leagueMembers(leagueId: number, size: number | null): Promise<Member[]> {
	const hit = leagueCache.get(leagueId);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.members;

	const members: Member[] = [];
	const add = (res: Awaited<ReturnType<typeof getLeagueStandingsPage>>) => {
		for (const r of res.standings.results) {
			members.push({ id: r.entry, team: r.entry_name, manager: r.player_name });
		}
	};

	if (size != null) {
		// Size is known, so fetch every page in parallel rather than walking them.
		const pages = Array.from({ length: Math.min(Math.max(1, Math.ceil(size / 50)), MAX_PAGES) }, (_, i) => i + 1);
		const results = await mapLimit(pages, 6, (p) => getLeagueStandingsPage(leagueId, p));
		if (results.some((r) => r.status === 'rejected')) throw new Error(`league ${leagueId}: page fetch failed`);
		for (const r of results) if (r.status === 'fulfilled') add(r.value);
		// rank_count can lag a growing league; if the last page says there's more, keep walking.
		const last = results[results.length - 1];
		let page = pages.length;
		let more = last.status === 'fulfilled' && last.value.standings.has_next;
		while (more && page < MAX_PAGES) {
			const res = await getLeagueStandingsPage(leagueId, ++page);
			add(res);
			more = res.standings.has_next;
		}
	} else {
		for (let page = 1; page <= MAX_PAGES; page++) {
			const res = await getLeagueStandingsPage(leagueId, page);
			add(res);
			if (!res.standings.has_next) break;
		}
	}
	leagueCache.set(leagueId, { at: Date.now(), members });
	return members;
}

/** Run async jobs with a concurrency limit (be polite to FPL). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
	const out: PromiseSettledResult<R>[] = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			try {
				out[i] = { status: 'fulfilled', value: await fn(items[i]) };
			} catch (reason) {
				out[i] = { status: 'rejected', reason };
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

export const GET: RequestHandler = async ({ url }) => {
	const seeds = [...new Set(
		(url.searchParams.get('seeds') || '')
			.split(',')
			.map((s) => parseInt(s, 10))
			.filter((n) => Number.isInteger(n) && n > 0)
	)].slice(0, MAX_SEEDS);

	if (seeds.length === 0) {
		return json({ teams: [], leagues: [], skipped: [] });
	}

	const entries = await mapLimit(seeds, 4, (id) => getEntry(id));

	const teams = new Map<number, Member & { leagues: string[] }>();
	const leagues = new Map<number, LeagueInfo>();
	const skipped = new Map<number, LeagueInfo>();

	for (const r of entries) {
		if (r.status !== 'fulfilled') continue;
		const e = r.value;
		// Always include the seed team itself, even if it's in no mini-league.
		teams.set(e.id, {
			id: e.id,
			team: e.name,
			manager: `${e.player_first_name} ${e.player_last_name}`,
			leagues: []
		});
		for (const l of e.leagues?.classic ?? []) {
			if (l.league_type !== 'x') continue;
			const info = { id: l.id, name: l.name, size: l.rank_count };
			if (l.rank_count != null && l.rank_count > MAX_LEAGUE_SIZE) skipped.set(l.id, info);
			else if (leagues.size < MAX_LEAGUES) leagues.set(l.id, info);
		}
	}

	const leagueList = [...leagues.values()];
	const results = await mapLimit(leagueList, 3, (l) => leagueMembers(l.id, l.size));

	results.forEach((r, i) => {
		if (r.status !== 'fulfilled') return;
		const leagueName = leagueList[i].name;
		for (const m of r.value) {
			const t = teams.get(m.id);
			if (t) {
				if (!t.leagues.includes(leagueName)) t.leagues.push(leagueName);
			} else {
				teams.set(m.id, { ...m, leagues: [leagueName] });
			}
		}
	});

	return json(
		{
			teams: [...teams.values()],
			leagues: leagueList.map((l, i) => ({ ...l, ok: results[i].status === 'fulfilled' })),
			skipped: [...skipped.values()]
		},
		{ headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=21600' } }
	);
};
