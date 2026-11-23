/**
 * Purchase prices for a manager's squad, rebuilt from public FPL data.
 *
 * FPL only shows purchase/selling prices to the logged-in owner. Everyone
 * else's can be rebuilt exactly by replaying the season:
 *
 *  1. The first squad (picks for started_event) was bought at the price on
 *     the day it was picked. Prices never change before the GW1 deadline, so
 *     for anyone who joined pre-season that's the start price. For late
 *     joiners it's the price at their joined_time, from our price history.
 *  2. Each transfer (oldest first) records the exact price paid
 *     (element_in_cost) and received (element_out_cost).
 *  3. Free Hit weeks are skipped: the squad and bank revert afterwards.
 *
 * Every step is checked against FPL's own figures, so a wrong answer can't
 * pass silently:
 *  - the replayed squad must equal the squad FPL shows;
 *  - for every past sale, FPL's element_out_cost must equal the selling
 *    price our purchase price predicts;
 *  - the replayed bank must equal FPL's bank at the end of every gameweek.
 */

export interface PriceTransfer {
	element_in: number;
	element_in_cost: number;
	element_out: number;
	element_out_cost: number;
	event: number;
	time: string;
}

export interface ReplayInput {
	startedEvent: number;
	joinedTime: string;
	firstDeadline: string;            // GW1 deadline (prices are fixed before it)
	firstPicks: number[];             // squad at started_event
	currentPicks: number[];           // squad FPL shows now
	currentEvent: number;             // the gameweek currentPicks belong to
	transfers: PriceTransfer[];       // any order
	chips: { name: string; event: number }[];
	bankByEvent: Map<number, number>; // entry history: bank at each GW
	startedDeadline: string;          // deadline of started_event (late joiners' squads are priced before it)
	/** Market price of a player at a moment; null if our history can't say for sure. */
	priceAt: (id: number, time: string) => number | null;
	/** Every price a player had at some point in [from, to]. */
	pricesBetween: (id: number, from: string, to: string) => number[];
	sellOnFee?: number;               // FPL game_settings.transfers_sell_on_fee (0.5)
	currentPrices?: Map<number, number>; // now_cost, to settle cases where only the purchase price is unclear
}

export interface ReplayResult {
	purchase: Map<number, number>;
	squad: number[];
	bank: number;
	/** true only if every check passed */
	verified: boolean;
	/** late joiners: how the first squad's prices were pinned down */
	firstSquad?: { ambiguousPlayers: number; combinationsTried: number; matches: number };
	/**
	 * Players whose purchase price public data can't pin down, though every
	 * possibility gives the same selling price today (so selling prices are
	 * still exact). Empty in the normal case.
	 */
	purchaseUncertain?: number[];
	/** Players whose selling price itself is uncertain: the user must confirm. */
	sellingUncertain?: { id: number; options: number[] }[];
	problems: string[];
	checks: { sales: number; banks: number };
}

export function sellingPrice(purchase: number, current: number, sellOnFee = 0.5): number {
	if (current <= purchase) return current;
	return purchase + Math.floor((current - purchase) * sellOnFee);
}

export function replayPurchasePrices(inp: ReplayInput): ReplayResult {
	// Pre-season joiners: prices are fixed until the GW1 deadline, so the
	// first squad cost exactly the start prices.
	const preSeason = inp.startedEvent <= 1 && inp.joinedTime < inp.firstDeadline;
	if (preSeason) {
		const first = new Map<number, number | null>(inp.firstPicks.map((id) => [id, inp.priceAt(id, inp.firstDeadline)]));
		return replayFrom(inp, first);
	}

	// Late joiners: the squad was bought at whatever each player cost when it
	// was saved, some time between joining and the first deadline. List each
	// player's possible prices over that window, drop any that contradict what
	// FPL later paid out when he was sold, and keep only combinations that
	// leave exactly FPL's bank. Accept the answer only if one combination fits
	// and the full replay then passes every check.
	const fee = inp.sellOnFee ?? 0.5;
	const sorted = [...inp.transfers].sort((a, b) => a.time.localeCompare(b.time));
	const options = inp.firstPicks.map((id) => {
		let opts = inp.pricesBetween(id, inp.joinedTime, inp.startedDeadline);
		const firstSale = sorted.find((t) => t.element_out === id);
		const market = firstSale ? inp.priceAt(id, firstSale.time) : null;
		if (firstSale && market !== null) opts = opts.filter((p) => sellingPrice(p, market, fee) === firstSale.element_out_cost);
		return { id, opts };
	});
	const startNet = sorted.filter((t) => t.event === inp.startedEvent).reduce((s, t) => s + t.element_out_cost - t.element_in_cost, 0);
	const bankAtStart = inp.bankByEvent.get(inp.startedEvent);
	const ambiguousPlayers = options.filter((o) => o.opts.length > 1).length;
	if (bankAtStart === undefined || options.some((o) => o.opts.length === 0)) {
		const r = replayFrom(inp, new Map(options.map((o) => [o.id, o.opts.length === 1 ? o.opts[0] : null])));
		r.problems.unshift('could not price the first squad');
		return { ...r, verified: false, firstSquad: { ambiguousPlayers, combinationsTried: 0, matches: 0 } };
	}
	const target = 1000 - (bankAtStart - startNet);
	// Depth-first over combinations hitting the target spend; stop at 2 matches.
	const minRest: number[] = new Array(options.length + 1).fill(0);
	const maxRest: number[] = new Array(options.length + 1).fill(0);
	for (let i = options.length - 1; i >= 0; i--) {
		minRest[i] = minRest[i + 1] + Math.min(...options[i].opts);
		maxRest[i] = maxRest[i + 1] + Math.max(...options[i].opts);
	}
	const matches: number[][] = [];
	let tried = 0;
	const pick: number[] = [];
	const dfs = (i: number, spent: number) => {
		if (matches.length >= 64) return;
		if (spent + minRest[i] > target || spent + maxRest[i] < target) return;
		if (i === options.length) { tried++; matches.push([...pick]); return; }
		for (const p of options[i].opts) { pick.push(p); dfs(i + 1, spent + p); pick.pop(); }
	};
	dfs(0, 0);
	const firstSquad = { ambiguousPlayers, combinationsTried: tried, matches: matches.length };
	// Replay every combination that fits; keep those that pass every check.
	const passing = matches
		.map((m) => ({ m, r: replayFrom(inp, new Map(options.map((o, i) => [o.id, m[i]]))) }))
		.filter((x) => x.r.verified);
	if (passing.length === 1) return { ...passing[0].r, firstSquad };
	const unclear = options.filter((o) => o.opts.length > 1).map((o) => `${o.id} (${o.opts.join('/')})`).join(', ');
	if (passing.length === 0 || matches.length >= 64 || !inp.currentPrices) {
		const r = replayFrom(inp, new Map(options.map((o) => [o.id, o.opts.length === 1 ? o.opts[0] : null])));
		r.problems.unshift(passing.length ? `first-squad prices not unique: ${unclear}` : 'no combination of first-squad prices passes every check');
		return { ...r, verified: false, firstSquad };
	}
	// Several histories fit. Selling prices may still agree: that's all a
	// transfer decision needs.
	const base = passing[0].r;
	const purchaseUncertain: number[] = [];
	const sellingUncertain: { id: number; options: number[] }[] = [];
	for (const id of base.squad) {
		const buys = new Set(passing.map((x) => x.r.purchase.get(id)!));
		if (buys.size === 1) continue;
		const now = inp.currentPrices.get(id);
		const sells = new Set([...buys].map((b) => (now === undefined ? NaN : sellingPrice(b, now, fee))));
		if (sells.size === 1 && !sells.has(NaN)) purchaseUncertain.push(id);
		else sellingUncertain.push({ id, options: [...sells].sort((a, b) => a - b) });
	}
	const sameSquad = passing.every((x) => x.r.squad.length === base.squad.length && x.r.squad.every((id) => base.squad.includes(id)));
	if (!sameSquad) return { ...base, verified: false, problems: ['replays disagree on the squad', ...base.problems], firstSquad };
	return {
		...base,
		verified: sellingUncertain.length === 0,
		problems: sellingUncertain.length ? [`selling price unclear for ${sellingUncertain.map((u) => `${u.id} (${u.options.join('/')})`).join(', ')}`] : [],
		firstSquad,
		purchaseUncertain,
		sellingUncertain
	};
}

function replayFrom(inp: ReplayInput, firstPrices: Map<number, number | null>): ReplayResult {
	const fee = inp.sellOnFee ?? 0.5;
	const problems: string[] = [];
	const checks = { sales: 0, banks: 0 };
	const purchase = new Map<number, number>();
	let firstSpend = 0;
	for (const id of inp.firstPicks) {
		const p = firstPrices.get(id) ?? null;
		if (p === null) problems.push(`no first-squad price for ${id}`);
		else { purchase.set(id, p); firstSpend += p; }
	}
	let bank = 1000 - firstSpend;
	const squad = new Set(inp.firstPicks);

	const freeHit = new Set(inp.chips.filter((c) => c.name === 'freehit').map((c) => c.event));
	const transfers = [...inp.transfers].sort((a, b) => a.time.localeCompare(b.time));
	const byEvent = new Map<number, PriceTransfer[]>();
	for (const t of transfers) byEvent.set(t.event, [...(byEvent.get(t.event) ?? []), t]);

	const checkBank = (ev: number) => {
		const fpl = inp.bankByEvent.get(ev);
		if (fpl === undefined) return;
		checks.banks++;
		if (fpl !== bank) problems.push(`GW${ev} bank: FPL ${fpl}, replay ${bank}`);
	};
	if (inp.startedEvent >= 1 && !byEvent.has(inp.startedEvent)) checkBank(inp.startedEvent);

	const lastEvent = Math.max(inp.currentEvent, ...transfers.map((t) => t.event), inp.startedEvent);
	for (let ev = inp.startedEvent; ev <= lastEvent; ev++) {
		const ts = byEvent.get(ev) ?? [];
		if (freeHit.has(ev)) {
			// Squad and bank revert after a Free Hit; FPL's bank for the FH week
			// itself is the temporary one, so only check the week after.
			continue;
		}
		for (const t of ts) {
			if (!squad.has(t.element_out)) { problems.push(`GW${ev}: sold ${t.element_out}, not in replayed squad`); continue; }
			const paid = purchase.get(t.element_out);
			const market = inp.priceAt(t.element_out, t.time);
			if (paid !== undefined && market !== null) {
				checks.sales++;
				const predicted = sellingPrice(paid, market, fee);
				if (predicted !== t.element_out_cost) problems.push(`GW${ev}: sold ${t.element_out} for ${t.element_out_cost}, predicted ${predicted} (paid ${paid}, market ${market})`);
			}
			squad.delete(t.element_out);
			purchase.delete(t.element_out);
			squad.add(t.element_in);
			purchase.set(t.element_in, t.element_in_cost);
			bank += t.element_out_cost - t.element_in_cost;
		}
		if (ev <= inp.currentEvent) checkBank(ev);
		if (ev === inp.currentEvent) {
			const want = new Set(inp.currentPicks);
			const missing = [...want].filter((id) => !squad.has(id));
			const extra = [...squad].filter((id) => !want.has(id));
			if (missing.length || extra.length) problems.push(`GW${ev} squad mismatch: FPL has ${missing.join(',') || '-'} that replay lacks; replay has ${extra.join(',') || '-'}`);
		}
	}

	// Transfers already published for a later gameweek are included.
	if (purchase.size !== 15) problems.push(`replayed squad has ${purchase.size} players`);
	return { purchase: new Map(purchase), squad: [...squad], bank, verified: problems.length === 0, problems, checks };
}

/**
 * Price lookup from our hourly snapshots. Each logged change happened
 * somewhere between the last snapshot that holds prices and the snapshot that
 * saw it. Price at T = start price + every change whose window closed by T.
 * If T falls inside a change's window we can't tell which side T was on, so
 * return null rather than guess.
 *
 * snapshots: every snapshot, with hasPrices false for runs that saved no
 * player rows (those don't open a window).
 */
export function makePriceAt(
	startPrice: Map<number, number>,
	changes: { element_id: number; change: number; snapshot_id: number }[],
	snapshots: { snapshot_id: number; timestamp: string; hasPrices: boolean }[]
) {
	const iso = (t: string) => new Date(t).toISOString();
	const sorted = [...snapshots].sort((a, b) => a.snapshot_id - b.snapshot_id);
	const window = new Map<number, { from: string; to: string }>();
	let lastWithPrices = '';
	for (const sn of sorted) {
		window.set(sn.snapshot_id, { from: lastWithPrices, to: iso(sn.timestamp) });
		if (sn.hasPrices) lastWithPrices = iso(sn.timestamp);
	}
	const byId = new Map<number, { change: number; from: string; to: string }[]>();
	for (const c of changes) {
		const w = window.get(c.snapshot_id);
		if (!w) continue;
		byId.set(c.element_id, [...(byId.get(c.element_id) ?? []), { change: c.change, ...w }]);
	}
	const pricesBetween = (id: number, from: string, to: string): number[] => {
		const f = iso(from), t = iso(to);
		const start = startPrice.get(id);
		if (start === undefined) return [];
		const opts = new Set<number>();
		let p = start;
		for (const c of [...(byId.get(id) ?? [])].sort((a, b) => a.to.localeCompare(b.to))) {
			if (c.to <= f) { p += c.change; continue; }   // settled before the interval
			if (c.from >= t) break;                       // starts after it
			opts.add(p); p += c.change; opts.add(p);      // may fall inside it
		}
		opts.add(p);
		return [...opts].sort((a, b) => a - b);
	};
	const priceAt = (id: number, time: string): number | null => {
		const t = iso(time);
		const start = startPrice.get(id);
		if (start === undefined) return null;
		let p = start;
		for (const c of byId.get(id) ?? []) {
			if (c.to <= t) p += c.change;
			else if (c.from < t) return null; // changed somewhere in (from, to]: can't tell
		}
		return p;
	};
	return { priceAt, pricesBetween };
}
