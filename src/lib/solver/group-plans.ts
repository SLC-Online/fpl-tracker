/**
 * Plans with the same score that differ only in who comes in for one player
 * (typically a bench swap that never plays) are shown as one row:
 * "Dubravka -> Steele, or 4 others".
 */
export interface GroupablePlan { transfers: { out: number; in: number }[]; net: number }
export type PlanGroup<P extends GroupablePlan> = { plan: P; slotIn: number | null; alts: number[] };

export function groupPlans<P extends GroupablePlan>(plans: P[]): PlanGroup<P>[] {
	const groups: PlanGroup<P>[] = [];
	const outsKey = (p: GroupablePlan) => p.transfers.map((t) => t.out).sort((a, b) => a - b).join(',');
	for (const p of plans) {
		const ins = new Set(p.transfers.map((t) => t.in));
		const g = groups.find((g) => {
			if (Math.abs(g.plan.net - p.net) > 1e-9 || outsKey(g.plan) !== outsKey(p)) return false;
			const gIns = new Set(g.plan.transfers.map((t) => t.in));
			const onlyP = [...ins].filter((x) => !gIns.has(x));
			const onlyG = [...gIns].filter((x) => !ins.has(x));
			if (onlyP.length !== 1 || onlyG.length !== 1) return false;
			return g.slotIn === null || g.slotIn === onlyG[0];
		});
		if (g) {
			const gIns = new Set(g.plan.transfers.map((t) => t.in));
			g.slotIn = [...gIns].find((id) => !ins.has(id))!;
			g.alts.push([...ins].find((id) => !gIns.has(id))!);
		} else groups.push({ plan: p, slotIn: null, alts: [] });
	}
	return groups;
}
