<script lang="ts">
	let files: FileList | null = $state(null);
	let season = $state('2026-27');
	let gameweek = $state(1);
	let uploading = $state(false);
	let result: any = $state(null);
	let errorMsg = $state('');

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
</div>
