// Checks replayPurchasePrices against FPL's own figures for real managers.
//   node scripts/prices/check_purchase_prices.mjs [randomCount=60] [ids...]
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (reads fpl_project/.env).

import { readFileSync } from 'node:fs';
import { replayPurchasePrices, makePriceAt } from '../../src/lib/purchase-prices.ts';

const env = Object.fromEntries(readFileSync(new URL('../../../fpl_project/.env', import.meta.url), 'utf8')
	.split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_KEY;
const sb = async (q) => (await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fpl(path) {
	for (let a = 0; a < 5; a++) {
		const r = await fetch(`https://fantasy.premierleague.com/api/${path}`, { headers: { 'User-Agent': UA } });
		if (r.status === 404) return null;
		if (r.ok) return r.json();
		await sleep(1000 * (a + 1));
	}
	throw new Error(`FPL ${path} failed`);
}

const [randomCount = 60, seedArg = 12345, ...fixed] = process.argv.slice(2).map(Number);
const bs = await fpl('bootstrap-static/');
const currentEvent = bs.events.find((e) => e.is_current).id;
const firstDeadline = bs.events[0].deadline_time;
const startPrice = new Map(bs.elements.map((e) => [e.id, e.now_cost - e.cost_change_start]));

const changes = [];
for (let off = 0; ; off += 1000) {
	const rows = await sb(`price_changes?select=element_id,change,snapshot_id&order=id.asc&offset=${off}&limit=1000`);
	changes.push(...rows); if (rows.length < 1000) break;
}
const snaps = [];
for (let off = 0; ; off += 1000) {
	const rows = await sb(`snapshots?select=snapshot_id,timestamp&order=snapshot_id.asc&offset=${off}&limit=1000`);
	snaps.push(...rows); if (rows.length < 1000) break;
}
// Snapshots saved without player rows (failed runs). Element 1 has been in every good snapshot.
const withRows = new Set((await sb('player_snapshots?select=snapshot_id&element_id=eq.1&limit=5000')).map((r) => r.snapshot_id));
for (const s of snaps) s.hasPrices = withRows.has(s.snapshot_id);
// Our history must account for every price move this season.
const net = new Map();
for (const c of changes) net.set(c.element_id, (net.get(c.element_id) ?? 0) + c.change);
const unexplained = bs.elements.filter((e) => (net.get(e.id) ?? 0) !== e.cost_change_start);
console.log(`Price history: ${changes.length} changes, ${snaps.length} snapshots since ${snaps[0].timestamp} (${snaps.filter((s) => !s.hasPrices).length} empty). Players whose start+changes ≠ now: ${unexplained.length}`);
for (const e of unexplained.slice(0, 5)) console.log(`  ${e.web_name}: FPL says ${e.cost_change_start}, history says ${net.get(e.id) ?? 0}`);
const { priceAt, pricesBetween } = makePriceAt(startPrice, changes, snaps);
const deadline = new Map(bs.events.map((e) => [e.id, e.deadline_time]));

// Sample: given ids, plus random ids across all entries (higher ids joined later).
let seed = seedArg;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ids = [...fixed];
while (ids.length < fixed.length + randomCount) ids.push(1 + Math.floor(rand() * bs.total_players));

const old = { managers: 0, wrongManagers: 0, wrongPlayers: 0, players: 0 };
const tally = { verified: 0, failed: 0, inactive: 0, lateJoiners: 0, freeHit: 0, sales: 0, banks: 0 };
for (const id of ids) {
	const entry = await fpl(`entry/${id}/`);
	if (!entry || !entry.started_event) { tally.inactive++; continue; }
	const hist = await fpl(`entry/${id}/history/`);
	const picksNow = await fpl(`entry/${id}/event/${currentEvent}/picks/`);
	if (!picksNow) { tally.inactive++; continue; }
	const first = entry.started_event === currentEvent ? picksNow : await fpl(`entry/${id}/event/${entry.started_event}/picks/`);
	const transfers = await fpl(`entry/${id}/transfers/`);
	const r = replayPurchasePrices({
		startedEvent: entry.started_event, joinedTime: entry.joined_time, firstDeadline,
		firstPicks: first.picks.map((p) => p.element), currentPicks: picksNow.picks.map((p) => p.element), currentEvent,
		transfers, chips: hist.chips, bankByEvent: new Map(hist.current.map((h) => [h.event, h.bank])), priceAt, pricesBetween, startedDeadline: deadline.get(entry.started_event), currentPrices: new Map(bs.elements.map((e) => [e.id, e.now_cost])),
		sellOnFee: bs.game_settings.transfers_sell_on_fee
	});
	const late = entry.started_event > 1 || entry.joined_time >= firstDeadline;
	const fh = hist.chips.some((c) => c.name === 'freehit');
	tally.lateJoiners += late; tally.freeHit += fh; tally.sales += r.checks.sales; tally.banks += r.checks.banks;
	if (late) console.log(`  late joiner ${id} (GW${entry.started_event}): ${r.verified ? 'verified' : 'NOT verified'}, ${r.firstSquad?.ambiguousPlayers ?? 0} first-squad players had more than one possible price, ${r.firstSquad?.matches} combination(s) fit FPL's bank${r.purchaseUncertain?.length ? `; purchase price unclear for ${r.purchaseUncertain.length} player(s) but selling price exact` : ''}${r.sellingUncertain?.length ? `; SELLING price unclear: ${JSON.stringify(r.sellingUncertain)}` : ''}`);
	if (r.verified) {
		// The method the site and Mac app use today: last-listed element_in_cost
		// (FPL lists newest first, so this is the OLDEST purchase), else start price.
		const oldBuy = new Map();
		for (const t of transfers) oldBuy.set(t.element_in, t.element_in_cost);
		const now = new Map(bs.elements.map((e) => [e.id, e.now_cost]));
		let wrong = 0;
		for (const pk of picksNow.picks) {
			const id = pk.element;
			const o = oldBuy.get(id) ?? startPrice.get(id);
			old.players++;
			const sellOld = o >= now.get(id) ? now.get(id) : o + Math.floor((now.get(id) - o) / 2);
			const sellNew = r.purchase.get(id) >= now.get(id) ? now.get(id) : r.purchase.get(id) + Math.floor((now.get(id) - r.purchase.get(id)) / 2);
			if (sellOld !== sellNew) wrong++;
		}
		old.managers++; if (wrong) old.wrongManagers++; old.wrongPlayers += wrong;
		if (fixed.includes(id)) console.log(`  ${id}: old method wrong for ${wrong} player(s)`);
	}
	if (r.verified) tally.verified++;
	else { tally.failed++; console.log(`✗ ${id} (started GW${entry.started_event}${late ? ', late' : ''}${fh ? ', FH' : ''}, ${transfers.length} transfers): ${r.problems.slice(0, 4).join(' | ')}`); }
	if (fixed.includes(id)) console.log(`  ${id}: ${r.verified ? 'verified' : 'NOT verified'}, ${r.checks.sales} sales + ${r.checks.banks} banks checked, purchase prices ${JSON.stringify([...r.purchase])}`);
	await sleep(150);
}
console.log(`\nOld method vs verified replay: wrong selling price for ${old.wrongPlayers} of ${old.players} players, in ${old.wrongManagers} of ${old.managers} squads.`);
console.log(`${tally.verified} verified, ${tally.failed} failed, ${tally.inactive} inactive/no team. Late joiners ${tally.lateJoiners}, Free Hit users ${tally.freeHit}. Checked ${tally.sales} past sales and ${tally.banks} gameweek banks against FPL.`);
