<script lang="ts">
	let files: FileList | null = $state(null);
	let season = $state('2026-27');
	let gameweek = $state(1);
	let uploading = $state(false);
	let result: any = $state(null);
	let errorMsg = $state('');

	// Matching issues
	let issues: any[] = $state([]);
	let issuesLoading = $state(true);
	let resolveSearch = $state('');
	let resolveResults: any[] = $state([]);
	let resolvingId: number | null = $state(null);

	// Load issues on mount
	$effect(() => { loadIssues(); });

	async function loadIssues() {
		issuesLoading = true;
		try {
			const resp = await fetch('/api/matching-issues');
			if (resp.ok) issues = await resp.json();
		} finally {
			issuesLoading = false;
		}
	}

	async function startResolve(issue: any) {
		resolvingId = issue.id;
		resolveSearch = issue.csv_name;
		await searchForResolve();
	}

	async function searchForResolve() {
		if (resolveSearch.length < 2) { resolveResults = []; return; }
		const resp = await fetch(`/api/players?q=${encodeURIComponent(resolveSearch)}`);
		if (resp.ok) resolveResults = await resp.json();
	}

	async function resolveIssue(elementId: number) {
		if (!resolvingId) return;
		const resp = await fetch('/api/matching-issues', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: resolvingId, element_id: elementId }),
		});
		if (resp.ok) {
			issues = issues.filter(i => i.id !== resolvingId);
			resolvingId = null;
			resolveSearch = '';
			resolveResults = [];
		}
	}

	function cancelResolve() {
		resolvingId = null;
		resolveSearch = '';
		resolveResults = [];
	}

	async function handleUpload() {
		if (!files || files.length === 0) return;
		
		uploading = true;
		errorMsg = '';
		result = null;

		const formData = new FormData();
		formData.append('csv', files[0]);
		formData.append('season', season);
		formData.append('gameweek', gameweek.toString());

		try {
			const resp = await fetch('/api/import', {
				method: 'POST',
				body: formData
			});

			if (!resp.ok) {
				errorMsg = await resp.text();
			} else {
				result = await resp.json();
			}
		} catch (e: any) {
			errorMsg = e.message;
		} finally {
			uploading = false;
		}
	}
</script>

<svelte:head>
	<title>Admin — FPL Tracker</title>
</svelte:head>

<div class="max-w-2xl space-y-8">
	<h1 class="text-2xl font-bold">Admin</h1>

	<!-- CSV Upload -->
	<section class="bg-[var(--color-bg-card)] rounded-xl p-6 border border-[var(--color-border)]">
		<h2 class="text-lg font-semibold mb-4">Import Transfer Algorithm CSV</h2>
		
		<div class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label for="season" class="block text-sm text-[var(--color-text-secondary)] mb-1">Season</label>
					<input id="season" type="text" bind:value={season}
						class="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)]" />
				</div>
				<div>
					<label for="gameweek" class="block text-sm text-[var(--color-text-secondary)] mb-1">Gameweek</label>
					<input id="gameweek" type="number" bind:value={gameweek} min="1" max="38"
						class="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)]" />
				</div>
			</div>

			<div>
				<label for="csv-file" class="block text-sm text-[var(--color-text-secondary)] mb-1">CSV File</label>
				<input id="csv-file" type="file" accept=".csv" bind:files
					class="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-[var(--color-accent)] file:text-[var(--color-bg-primary)] file:font-medium file:cursor-pointer" />
			</div>

			<button onclick={handleUpload} disabled={uploading || !files}
				class="px-6 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
				{uploading ? 'Importing...' : 'Import CSV'}
			</button>
		</div>

		<!-- Results -->
		{#if result}
			<div class="mt-6 p-4 rounded-lg bg-green-900/20 border border-green-700">
				<p class="text-[var(--color-success)] font-medium">✓ Import successful</p>
				<p class="text-sm text-[var(--color-text-secondary)] mt-1">
					Matched {result.matched}/{result.total} players ({result.matchRate}%)
				</p>
				{#if result.unmatched?.length > 0}
					<div class="mt-3">
						<p class="text-sm text-[var(--color-warning)]">Unmatched players:</p>
						<ul class="text-sm text-[var(--color-text-muted)] mt-1">
							{#each result.unmatched as u}
								<li>{u.name} ({u.team}) ~ {u.bestGuess} (score: {u.score})</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if result.lowConfidence?.length > 0}
					<div class="mt-3">
						<p class="text-sm text-[var(--color-warning)]">Low confidence (check these):</p>
						<ul class="text-sm text-[var(--color-text-muted)] mt-1">
							{#each result.lowConfidence as lc}
								<li>{lc.csvName} → {lc.apiName} (score: {lc.score})</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}

		{#if errorMsg}
			<div class="mt-6 p-4 rounded-lg bg-red-900/20 border border-red-700">
				<p class="text-[var(--color-danger)]">Error: {errorMsg}</p>
			</div>
		{/if}
	</section>

	<!-- Matching Issues -->
	<section class="bg-[var(--color-surface-2)] rounded-xl p-6 border border-[var(--color-surface-4)]">
		<h2 class="text-lg font-semibold mb-4">Matching Issues</h2>
		{#if issuesLoading}
			<p class="text-[var(--color-text-2)] text-sm">Loading...</p>
		{:else if issues.length === 0}
			<p class="text-[var(--color-text-2)] text-sm">No unresolved matching issues ✓</p>
		{:else}
			<p class="text-[var(--color-text-2)] text-sm mb-4">{issues.length} player{issues.length > 1 ? 's' : ''} couldn't be matched automatically. Resolve below:</p>
			<div class="space-y-3">
				{#each issues as issue}
					<div class="p-3 rounded-lg bg-[var(--color-surface-3)]/50 border border-[var(--color-surface-4)]">
						<div class="flex items-center justify-between">
							<div>
								<span class="font-medium text-sm">{issue.csv_name}</span>
								<span class="text-[var(--color-text-2)] text-xs ml-2">({issue.csv_team})</span>
								{#if issue.notes}
									<span class="text-[var(--color-text-3)] text-xs ml-2">{issue.notes}</span>
								{/if}
							</div>
							{#if resolvingId !== issue.id}
								<button onclick={() => startResolve(issue)}
									class="px-3 py-1 rounded bg-[var(--color-accent)] text-white text-xs font-medium hover:bg-[var(--color-accent-light)]">
									Resolve
								</button>
							{/if}
						</div>

						{#if resolvingId === issue.id}
							<div class="mt-3 space-y-2">
								<input type="text" bind:value={resolveSearch}
									oninput={searchForResolve}
									placeholder="Search for correct player..."
									class="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-surface-4)] text-[var(--color-text-0)] text-sm focus:outline-none focus:border-[var(--color-accent)]" />
								{#if resolveResults.length > 0}
									<div class="max-h-40 overflow-y-auto space-y-1">
										{#each resolveResults.slice(0, 15) as player}
											<button onclick={() => resolveIssue(player.element_id)}
												class="w-full flex items-center justify-between px-3 py-2 rounded text-left text-sm hover:bg-[var(--color-surface-3)] transition-colors">
												<span>{player.web_name} <span class="text-[var(--color-text-3)]">({player.team_short})</span></span>
												<span class="font-mono text-xs text-[var(--color-text-2)]">ID: {player.element_id}</span>
											</button>
										{/each}
									</div>
								{/if}
								<button onclick={cancelResolve} class="text-[var(--color-text-3)] text-xs hover:text-[var(--color-text-1)]">Cancel</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
