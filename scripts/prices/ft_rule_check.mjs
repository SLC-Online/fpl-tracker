// Which free-transfer rule does FPL use around a Wildcard / Free Hit week?
//  H1: the chip week keeps banked FTs AND the usual +1 arrives for the next week.
//  H0: the chip week keeps banked FTs but no +1 is added.
// Simulates each manager's free transfers from GW2 under both, and checks the
// predicted hit cost against FPL's own event_transfers_cost for every week.
const UA = 'Mozilla/5.0 (Macintosh) Chrome/126';
const fpl = async (p) => { for (let a = 0; a < 4; a++) { const r = await fetch(`https://fantasy.premierleague.com/api/${p}`, { headers: { 'User-Agent': UA } }); if (r.status === 404) return null; if (r.ok) return r.json(); await new Promise((s) => setTimeout(s, 1000 * (a + 1))); } return null; };
const bs = await fpl('bootstrap-static/');
const n = Number(process.argv[2] ?? 300);
let seed = Number(process.argv[3] ?? 99);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const tally = { managers: 0, withChip: 0, weeks: 0, h1: 0, h0: 0, decisive: 0, h1Decisive: 0, h0Decisive: 0, bothWrong: 0 };
function simulate(hist, chips, plusOne) {
	const chipAt = new Map(chips.map((c) => [c.event, c.name]));
	let ft = null; const out = [];
	for (const h of hist) {
		// No transfers in a team's first gameweek; one free transfer the week after.
		if (ft === null) { ft = 1; out.push({ ev: h.event, predicted: 0, actual: h.event_transfers_cost }); continue; }
		const chip = chipAt.get(h.event);
		const free = chip === 'wildcard' || chip === 'freehit';
		const predicted = free ? 0 : Math.max(0, h.event_transfers - ft) * 4;
		out.push({ ev: h.event, predicted, actual: h.event_transfers_cost, chip });
		if (free) ft = plusOne ? Math.min(5, ft + 1) : ft;
		else ft = Math.min(5, Math.max(0, ft - h.event_transfers) + 1);
	}
	return out;
}
for (let i = 0; i < n; i++) {
	const id = 1 + Math.floor(rand() * bs.total_players);
	const entry = await fpl(`entry/${id}/`);
	if (!entry || !entry.started_event) continue;
	const late = entry.started_event > 1;
	if (process.argv[4] === 'late' ? !late : late) continue;
	const h = await fpl(`entry/${id}/history/`);
	if (!h) continue;
	tally.managers++;
	if (process.argv[4] !== 'late' && !h.chips.some((c) => c.name === 'wildcard' || c.name === 'freehit')) continue;
	tally.withChip++;
	const a = simulate(h.current, h.chips, true), b = simulate(h.current, h.chips, false);
	a.forEach((w, k) => {
		tally.weeks++;
		const ok1 = w.predicted === w.actual, ok0 = b[k].predicted === b[k].actual;
		tally.h1 += ok1; tally.h0 += ok0;
		if (ok1 !== ok0) { tally.decisive++; ok1 ? tally.h1Decisive++ : tally.h0Decisive++; }
		if (!ok1 && !ok0) tally.bothWrong++;
	});
	await new Promise((s) => setTimeout(s, 120));
}
console.log(JSON.stringify(tally));
