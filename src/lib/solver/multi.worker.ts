/// <reference lib="webworker" />
/**
 * Solves one multi-week plan (one chip schedule) off the main thread. The
 * page runs several of these at once, one per CPU core, each on a different
 * chip schedule. While HiGHS works it posts progress: the best plan found so
 * far and the most any plan could still score (its proven bound).
 */
import { solveMultiWeek, type MultiRequest, type MultiResult } from './multi-week';

export type MultiIn = { type: 'solve'; id: string; req: MultiRequest };
export type MultiOut =
	| { type: 'progress'; id: string; best: number | null; bound: number | null; seconds: number }
	| { type: 'result'; id: string; result: MultiResult; bound: number | null }
	| { type: 'error'; id: string; message: string };

const post = (m: MultiOut) => (self as unknown as Worker).postMessage(m);

let current = '';
let lastBound: number | null = null;
let started = 0;
let lastPost = 0;

// HiGHS's progress lines: "... <expl>% <best bound> <best solution> <gap>% ..."
const PROGRESS = /(\d+\.\d+)%\s+(\S+)\s+(\S+)\s+(?:\S+%|Large)/;
function onLog(line: string) {
	const m = PROGRESS.exec(line);
	if (m) {
		const bound = Number(m[2]);
		const best = Number(m[3]);
		lastBound = Number.isFinite(bound) ? bound : lastBound;
		const now = performance.now();
		if (now - lastPost > 400) {
			lastPost = now;
			post({ type: 'progress', id: current, best: Number.isFinite(best) ? best : null, bound: lastBound, seconds: (now - started) / 1000 });
		}
	}
	const d = /Dual bound\s+(\S+)/.exec(line);
	if (d && Number.isFinite(Number(d[1]))) lastBound = Number(d[1]);
}

let highsPromise: Promise<any> | null = null;
function getHighs() {
	if (!highsPromise) {
		highsPromise = (async () => {
			const [{ default: loadHighs }, { default: wasmUrl }] = await Promise.all([import('highs'), import('highs/runtime?url')]);
			return loadHighs({ locateFile: () => wasmUrl, print: onLog, printErr: () => {} });
		})();
	}
	return highsPromise;
}

self.onmessage = async (ev: MessageEvent<MultiIn>) => {
	const m = ev.data;
	if (m.type !== 'solve') return;
	current = m.id;
	lastBound = null;
	started = performance.now();
	try {
		const highs = await getHighs();
		const req: MultiRequest = { ...m.req, players: m.req.players.map((p) => ({ ...p, proj: Float64Array.from(p.proj as ArrayLike<number>) })) };
		// output_flag on so progress lines reach onLog
		const result = solveMultiWeek(highs, req, { output_flag: true, log_to_console: true });
		post({ type: 'result', id: m.id, result, bound: result.status === 'Optimal' ? result.objective : lastBound });
	} catch (e: any) {
		post({ type: 'error', id: m.id, message: e?.message ?? String(e) });
	}
};
