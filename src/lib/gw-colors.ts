/**
 * Shared GW cell colour grading.
 * 
 * Takes a ratio (0-1) representing where a player's expected points sit
 * relative to all players for that gameweek (0 = worst, 1 = best).
 * Returns a background colour string.
 * 
 * Used by: Players page, My Team page, Player profile, transfer panel.
 * Change here → updates everywhere.
 */
export function gwCellColorFromRatio(ratio: number): string {
	if (ratio >= 0.9) return 'rgba(22, 163, 74, 0.55)';       // Deep green
	if (ratio >= 0.8) return 'rgba(22, 163, 74, 0.4)';        // Rich green
	if (ratio >= 0.7) return 'rgba(34, 197, 94, 0.3)';        // Medium green
	if (ratio >= 0.6) return 'rgba(74, 222, 128, 0.2)';       // Light green
	if (ratio >= 0.5) return 'rgba(134, 239, 172, 0.12)';     // Pale green
	if (ratio >= 0.4) return 'rgba(253, 224, 71, 0.1)';       // Pale yellow
	if (ratio >= 0.3) return 'rgba(255, 255, 255, 0.03)';     // Neutral
	if (ratio >= 0.2) return 'rgba(251, 191, 36, 0.08)';      // Pale amber
	if (ratio >= 0.1) return 'rgba(251, 146, 60, 0.12)';      // Orange
	return 'rgba(239, 68, 68, 0.15)';                          // Red
}

/**
 * Convenience: given points and a min/max range, compute the ratio and return the colour.
 */
export function gwCellColor(pts: number, min: number, max: number): string {
	const range = max - min || 1;
	const ratio = (pts - min) / range;
	return gwCellColorFromRatio(Math.max(0, Math.min(1, ratio)));
}
