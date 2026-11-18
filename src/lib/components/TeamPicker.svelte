<script lang="ts">
	import { onMount } from 'svelte';
	import { getSaved, getRecent, toggleSaved, fold, type TeamRef } from '$lib/saved-teams';

	let { loading = false, onload }: { loading?: boolean; onload: (id: number) => void } = $props();

	type DirTeam = TeamRef & { leagues: string[] };

	const DIR_KEY = 'fpl.teamDirectory.v1';
	const DIR_TTL = 6 * 60 * 60 * 1000;

	let query = $state('');
	let saved: TeamRef[] = $state([]);
	let recent: TeamRef[] = $state([]);
	let directory: DirTeam[] = $state([]);
	let leagueCount = $state(0);
	let skippedCount = $state(0);
	let dirState: 'idle' | 'loading' | 'ready' | 'error' = $state('idle');
	let open = $state(false);
	let active = $state(0);

	const q = $derived(query.trim());
	const isId = $derived(/^\d+$/.test(q));
	const savedIds = $derived(new Set(saved.map((t) => t.id)));
	const recentOnly = $derived(recent.filter((t) => !savedIds.has(t.id)).slice(0, 4));
	const seedIds = $derived([...new Set([...saved, ...recent].map((t) => t.id))].sort((a, b) => a - b));
	const showPanel = $derived(open && !isId && q.length >= 2);

	const matches = $derived.by(() => {
		const fq = fold(q);
		if (fq.length < 2 || isId) return [] as DirTeam[];
		const pool = new Map<number, DirTeam>();
		for (const t of directory) pool.set(t.id, t);
		for (const t of [...saved, ...recent]) if (!pool.has(t.id)) pool.set(t.id, { ...t, leagues: [] });
		const recentIds = new Set(recent.map((t) => t.id));
		const scored: { t: DirTeam; s: number }[] = [];
		for (const t of pool.values()) {
			let s = Infinity;
			for (const f of [fold(t.team), fold(t.manager)]) {
				if (f.startsWith(fq)) s = Math.min(s, 0);
				else if (f.includes(' ' + fq)) s = Math.min(s, 1);
				else if (f.includes(fq)) s = Math.min(s, 2);
			}
			if (s === Infinity) continue;
			if (savedIds.has(t.id)) s -= 0.6;
			else if (recentIds.has(t.id)) s -= 0.3;
			scored.push({ t, s });
		}
		scored.sort((a, b) => a.s - b.s || a.t.team.localeCompare(b.t.team));
		return scored.slice(0, 8).map((x) => x.t);
	});

	/** Split text into [before, match, after] for highlighting, when it's safe to. */
	function parts(text: string): [string, string, string] {
		const f = fold(text);
		const fq = fold(q);
		const i = f.indexOf(fq);
		if (i < 0 || !fq || f.length !== text.length) return [text, '', ''];
		return [text.slice(0, i), text.slice(i, i + fq.length), text.slice(i + fq.length)];
	}

	async function loadDirectory() {
		if (seedIds.length === 0) {
			dirState = 'idle';
			return;
		}
		const key = seedIds.join(',');
		try {
			const c = JSON.parse(localStorage.getItem(DIR_KEY) || 'null');
			if (c && c.key === key && Date.now() - c.at < DIR_TTL) {
				directory = c.teams;
				leagueCount = c.leagues;
				skippedCount = c.skipped ?? 0;
				dirState = 'ready';
				return;
			}
		} catch {
			/* ignore a corrupt cache */
		}
		dirState = 'loading';
		try {
			const res = await fetch(`/api/team-directory?seeds=${key}`);
			if (!res.ok) throw new Error();
			const d = await res.json();
			directory = d.teams;
			leagueCount = d.leagues.filter((l: { ok: boolean }) => l.ok).length;
			skippedCount = d.skipped.length;
			dirState = 'ready';
			try {
				localStorage.setItem(DIR_KEY, JSON.stringify({ key, at: Date.now(), teams: d.teams, leagues: leagueCount, skipped: skippedCount }));
			} catch {
				/* too big to cache — fine, it's just slower next time */
			}
		} catch {
			dirState = 'error';
		}
	}

	function pick(t: TeamRef) {
		query = String(t.id);
		open = false;
		onload(t.id);
	}

	function submit() {
		if (loading) return;
		if (isId) {
			open = false;
			onload(parseInt(q, 10));
		} else if (matches[active]) {
			pick(matches[active]);
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		} else if (e.key === 'ArrowDown' && showPanel) {
			e.preventDefault();
			active = Math.min(active + 1, Math.max(matches.length - 1, 0));
		} else if (e.key === 'ArrowUp' && showPanel) {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	function star(t: TeamRef) {
		saved = toggleSaved({ id: t.id, team: t.team, manager: t.manager });
	}

	onMount(() => {
		saved = getSaved();
		recent = getRecent();
		loadDirectory();
		const close = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest('.tp-search')) open = false;
		};
		document.addEventListener('click', close);
		return () => document.removeEventListener('click', close);
	});
</script>

{#snippet starIcon(filled: boolean)}
	<svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
		stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
		<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
	</svg>
{/snippet}

{#snippet row(t: TeamRef, isSavedRow: boolean)}
	<div class="tp-row">
		<button class="tp-star" class:on={isSavedRow} onclick={() => star(t)}
			title={isSavedRow ? 'Remove from saved' : 'Save team'} aria-label={isSavedRow ? 'Remove from saved' : 'Save team'}>
			{@render starIcon(isSavedRow)}
		</button>
		<button class="tp-row-main" onclick={() => pick(t)} disabled={loading}>
			<span class="tp-row-text">
				<span class="tp-team">{t.team}</span>
				<span class="tp-mgr">{t.manager}</span>
			</span>
			<span class="tp-id">{t.id}</span>
		</button>
	</div>
{/snippet}

<div class="tp">
	<div class="tp-search">
		<div class="tp-input-group">
			<input
				type="text"
				placeholder="Team ID or name"
				bind:value={query}
				oninput={() => { open = true; active = 0; }}
				onfocus={() => (open = true)}
				onkeydown={onKey}
				class="tp-input"
				autocomplete="off"
				spellcheck="false"
				aria-label="Team ID, team name or manager name"
			/>
			<button onclick={submit} disabled={loading || (!isId && !matches.length)} class="tp-btn">
				{#if loading}
					<svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" /></svg>
				{:else}
					Load Squad
				{/if}
			</button>
		</div>

		{#if showPanel}
			<div class="tp-panel" role="listbox">
				{#if matches.length}
					{#each matches as t, i (t.id)}
						{@const tp = parts(t.team)}
						{@const mp = parts(t.manager)}
						<button class="tp-result" class:active={i === active} role="option" aria-selected={i === active}
							onmouseenter={() => (active = i)} onclick={() => pick(t)}>
							<span class="tp-row-text">
								<span class="tp-team">{tp[0]}<mark>{tp[1]}</mark>{tp[2]}</span>
								<span class="tp-mgr">{mp[0]}<mark>{mp[1]}</mark>{mp[2]}{#if t.leagues?.length}<span class="tp-league">·&nbsp;{t.leagues[0]}</span>{/if}</span>
							</span>
							<span class="tp-result-right">
								{#if savedIds.has(t.id)}<span class="tp-saved-dot">{@render starIcon(true)}</span>{/if}
								<span class="tp-id">{t.id}</span>
							</span>
						</button>
					{/each}
				{:else if seedIds.length === 0}
					<p class="tp-empty">Name search needs one team to start from. Load a team by ID, and anyone in its mini-leagues becomes searchable by name.</p>
				{:else if dirState === 'loading'}
					<p class="tp-empty">Loading your mini-leagues…</p>
				{:else}
					<p class="tp-empty">No team matching “{q}” in your mini-leagues.</p>
				{/if}
				{#if seedIds.length}
					<div class="tp-panel-foot">
						{#if dirState === 'ready' && leagueCount === 0}
							Your saved and recent teams aren’t in any mini-leagues, so only they can be found by name
						{:else if dirState === 'ready'}
							{directory.length.toLocaleString()} teams in {leagueCount} mini-league{leagueCount === 1 ? '' : 's'}{#if skippedCount}<span class="tp-league">· {skippedCount} large league{skippedCount === 1 ? '' : 's'} skipped</span>{/if}
						{:else if dirState === 'error'}
							Couldn’t load mini-leagues — searching saved and recent teams only
						{:else if dirState === 'loading'}
							Loading mini-leagues…
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if saved.length || recentOnly.length}
		<div class="tp-lists">
			{#if saved.length}
				<div class="tp-heading">Saved teams</div>
				{#each saved as t (t.id)}{@render row(t, true)}{/each}
			{/if}
			{#if recentOnly.length}
				<div class="tp-heading">Recent</div>
				{#each recentOnly as t (t.id)}{@render row(t, false)}{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.tp { width: 100%; }
	.tp-search { position: relative; }

	.tp-input-group { display: flex; gap: 10px; width: 100%; }

	.tp-input {
		flex: 1;
		min-width: 0;
		padding: 14px 18px;
		border-radius: 12px;
		background: var(--color-surface-0);
		border: 1px solid var(--color-surface-4);
		color: var(--color-text-0);
		font-size: 14px;
	}
	.tp-input::placeholder { color: var(--color-text-3); }
	.tp-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
	}

	.tp-btn {
		padding: 14px 22px;
		border-radius: 12px;
		background: var(--color-accent);
		color: white;
		font-weight: 600;
		font-size: 14px;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		white-space: nowrap;
	}
	.tp-btn:hover { background: var(--color-accent-light); }
	.tp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	/* results dropdown */
	.tp-panel {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 8px);
		z-index: 30;
		padding: 6px;
		border-radius: 14px;
		background: var(--color-surface-3);
		border: 1px solid var(--color-surface-4);
		box-shadow: 0 18px 40px -10px rgba(0, 0, 0, 0.6);
	}
	.tp-result {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 9px 12px;
		border-radius: 9px;
		text-align: left;
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
	}
	.tp-result.active { background: var(--color-surface-4); }
	.tp-result-right { display: flex; align-items: center; gap: 8px; flex: none; }
	.tp-saved-dot { color: var(--color-warning); display: flex; }
	.tp-saved-dot :global(svg) { width: 12px; height: 12px; }
	.tp-league { color: var(--color-text-3); margin-left: 5px; }
	mark { background: none; color: var(--color-accent-light); font-weight: 600; }
	.tp-empty { margin: 0; padding: 12px; font-size: 13px; line-height: 1.5; color: var(--color-text-1); }
	.tp-panel-foot {
		margin-top: 4px;
		padding: 8px 12px 4px;
		border-top: 1px solid var(--color-surface-4);
		font-size: 11px;
		color: var(--color-text-2);
	}

	/* shared text bits */
	.tp-row-text { display: flex; flex-direction: column; min-width: 0; }
	.tp-team {
		font-size: 14px;
		font-weight: 500;
		color: var(--color-text-0);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tp-mgr {
		font-size: 12px;
		color: var(--color-text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tp-id { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-3); }

	/* saved / recent lists */
	.tp-lists { margin-top: 28px; }
	.tp-heading {
		margin: 14px 0 6px 2px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-2);
	}
	.tp-heading:first-child { margin-top: 0; }
	.tp-row {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 10px;
	}
	.tp-row:hover { background: var(--color-surface-3); }
	.tp-star {
		flex: none;
		display: flex;
		padding: 9px 6px 9px 10px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-3);
	}
	.tp-star:hover { color: var(--color-text-1); }
	.tp-star.on { color: var(--color-warning); }
	.tp-row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px 8px 4px;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.tp-row-main:disabled { cursor: default; opacity: 0.6; }
</style>
