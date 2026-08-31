/**
 * VFM — Value For Money.
 *
 * A single definitive "value" score per player, presented in the UI as "VFM".
 * This is an abstraction layer, mirroring how expected points work: multiple
 * inputs may feed in over time and get blended into one final number.
 *
 * Currently the only input is the Transfer Algorithm's internal value figure
 * (stored as `bcv` on projection meta). Do NOT surface that source name in the
 * UI — the user-facing concept is always "VFM".
 *
 * To add more inputs later, change computeVFM to blend them; every table that
 * displays VFM reads through this function, so nothing downstream needs to change.
 */

export interface VFMInputs {
	bcv?: number | null;
	// future inputs go here, e.g. ownershipValue, priceTrend, ...
}

/**
 * Compute the final VFM score from available inputs.
 * Returns null when no input is available.
 */
export function computeVFM(inputs: VFMInputs): number | null {
	// Currently: passthrough of the single available input.
	if (inputs.bcv == null) return null;
	return inputs.bcv;
}

/** Convenience: compute VFM directly from a player-like object carrying `bcv`. */
export function playerVFM(player: { bcv?: number | null } | null | undefined): number | null {
	if (!player) return null;
	return computeVFM({ bcv: player.bcv });
}

/** Format a VFM value for display (2 decimals), or a dash when unavailable. */
export function formatVFM(v: number | null | undefined): string {
	return v == null ? '—' : v.toFixed(2);
}
