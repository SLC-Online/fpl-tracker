/**
 * Free transfers going into the next gameweek, replayed from a manager's
 * season history. Rules, checked against FPL's own hit charges for real
 * managers (scripts/prices/ft_rule_check.mjs):
 *  - no transfers in a team's first gameweek; one free transfer the week after;
 *  - each normal week: unused free transfers roll over, plus one, up to the cap (5);
 *  - a Wildcard or Free Hit week keeps the banked free transfers but adds none.
 */
export function freeTransfersAfter(
	history: { event: number; event_transfers: number }[],
	chips: { name: string; event: number }[],
	nextGw: number,
	cap = 5
): number {
	const chipAt = new Map(chips.map((c) => [c.event, c.name]));
	let ft: number | null = null;
	for (const h of [...history].sort((a, b) => a.event - b.event)) {
		if (h.event >= nextGw) break;
		if (ft === null) { ft = 1; continue; }   // first gameweek played
		const chip = chipAt.get(h.event);
		if (chip === 'wildcard' || chip === 'freehit') continue;
		ft = Math.min(cap, Math.max(0, ft - h.event_transfers) + 1);
	}
	return ft ?? 0;
}
