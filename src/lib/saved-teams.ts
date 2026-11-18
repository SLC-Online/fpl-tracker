/**
 * Saved and recently viewed FPL teams, kept in this browser's localStorage.
 *
 * Nothing is stored server-side: saved teams live on this device/browser only
 * and disappear if site data is cleared.
 */

export type TeamRef = { id: number; team: string; manager: string };

const SAVED_KEY = 'fpl.savedTeams.v1';
const RECENT_KEY = 'fpl.recentTeams.v1';
const RECENT_MAX = 6;

function read(key: string): TeamRef[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const v = JSON.parse(localStorage.getItem(key) || '[]');
		return Array.isArray(v) ? v.filter((t) => t && Number.isInteger(t.id)) : [];
	} catch {
		return [];
	}
}

function write(key: string, teams: TeamRef[]) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify(teams));
	} catch {
		/* storage full or disabled — saving is best-effort */
	}
}

export const getSaved = () => read(SAVED_KEY);
export const getRecent = () => read(RECENT_KEY);

export function isSaved(id: number): boolean {
	return getSaved().some((t) => t.id === id);
}

/** Save, or remove if already saved. Returns the new saved list. */
export function toggleSaved(team: TeamRef): TeamRef[] {
	const saved = getSaved();
	const next = saved.some((t) => t.id === team.id)
		? saved.filter((t) => t.id !== team.id)
		: [...saved, team];
	write(SAVED_KEY, next);
	return next;
}

export function removeSaved(id: number): TeamRef[] {
	const next = getSaved().filter((t) => t.id !== id);
	write(SAVED_KEY, next);
	return next;
}

/** Record a team as just viewed; also refreshes its name if it's saved (names change). */
export function pushRecent(team: TeamRef): TeamRef[] {
	const next = [team, ...getRecent().filter((t) => t.id !== team.id)].slice(0, RECENT_MAX);
	write(RECENT_KEY, next);
	const saved = getSaved();
	if (saved.some((t) => t.id === team.id)) {
		write(SAVED_KEY, saved.map((t) => (t.id === team.id ? team : t)));
	}
	return next;
}

/** Accent/case-insensitive form for matching ("Øyvind" ~ "oyvind"). */
export function fold(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ø/gi, 'o')
		.replace(/æ/gi, 'ae')
		.replace(/ß/g, 'ss')
		.toLowerCase();
}
