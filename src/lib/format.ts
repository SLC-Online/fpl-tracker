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

/** Human-friendly "x ago" for a timestamp, relative to `now` (ms). */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string {
	if (!iso) return '—';
	const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
	if (s < 90) return 'just now';
	if (s < 5400) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	if (s < 172800) return 'yesterday';
	return `${Math.round(s / 86400)} days ago`;
}

/** Format an expected-points value to 2 decimals, or a dash when missing. */
export function formatPts(v: number | null | undefined): string {
	return v == null || Number.isNaN(v) ? '--' : v.toFixed(2);
}
