/**
 * Shared display formatters.
 *
 * Projection expected-points are STORED at full 2-decimal precision in Supabase
 * (final_projections.expected_points), matching the source Transfer Algorithm
 * CSV. Display them to 2dp so e.g. 5.18 shows as "5.18", not "5.2".
 *
 * Note: this is only for POINTS. Prices (£m) are genuinely 1dp in FPL and keep
 * their own one-decimal formatting.
 */

/** Format an expected-points value to 2 decimals, or a dash when missing. */
export function formatPts(v: number | null | undefined): string {
	return v == null || Number.isNaN(v) ? '--' : v.toFixed(2);
}
