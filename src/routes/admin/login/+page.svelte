<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let submitting = $state(false);

	const message = $derived(
		form?.error === 'wrong' ? 'That password isn’t right.'
		: form?.error === 'locked' ? 'Too many attempts. Try again in 15 minutes.'
		: form?.error === 'not_configured' ? 'Admin sign-in isn’t set up yet.'
		: ''
	);
</script>

<svelte:head>
	<title>Admin sign in — FPL Sorted</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="wrap">
	<section class="card">
		<div class="lock" aria-hidden="true">
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
				<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
			</svg>
		</div>
		<h1 class="font-display">Admin</h1>

		{#if data.configured}
			<p class="sub">Enter the admin password to continue.</p>
			<form method="POST" use:enhance={() => { submitting = true; return async ({ update }) => { await update({ reset: false }); submitting = false; }; }}>
				<input
					type="password"
					name="password"
					placeholder="Password"
					autocomplete="current-password"
					required
					class:bad={form?.error === 'wrong'}
					aria-label="Admin password"
					aria-invalid={form?.error === 'wrong'}
				/>
				<button type="submit" disabled={submitting}>
					{#if submitting}
						<svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" /></svg>
					{:else}
						Sign in
					{/if}
				</button>
			</form>
			{#if message}<p class="msg" role="alert">{message}</p>{/if}
		{:else}
			<p class="sub">
				Admin is locked because no password has been set.<br />
				Add an <code>ADMIN_PASSWORD</code> environment variable (at least 12 characters) in Vercel and redeploy.
			</p>
		{/if}
	</section>
</div>

<style>
	.wrap { display: flex; align-items: center; justify-content: center; min-height: 70vh; }
	.card {
		display: flex; flex-direction: column; align-items: center;
		width: 100%; max-width: 380px; padding: 2.5rem 2.25rem;
		border-radius: 20px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-surface-4);
		box-shadow: 0 0 0 1px var(--color-surface-4), 0 20px 60px -12px rgba(0, 0, 0, 0.5), 0 0 80px -20px rgba(99, 102, 241, 0.08);
	}
	.lock {
		display: flex; align-items: center; justify-content: center;
		width: 44px; height: 44px; margin-bottom: 1.1rem; border-radius: 12px;
		background: var(--color-accent-glow); color: var(--color-accent-light);
	}
	h1 { font-weight: 700; font-size: 1.75rem; color: var(--color-text-0); margin: 0 0 .35rem; }
	.sub { margin: 0 0 1.5rem; font-size: .875rem; line-height: 1.55; color: var(--color-text-2); text-align: center; }
	code { font-family: var(--font-mono); font-size: .8em; padding: 1px 5px; border-radius: 5px; background: var(--color-surface-3); color: var(--color-accent-light); }
	form { display: flex; gap: 10px; width: 100%; }
	input {
		flex: 1; min-width: 0; padding: 13px 16px; border-radius: 12px;
		background: var(--color-surface-0); border: 1px solid var(--color-surface-4);
		color: var(--color-text-0); font-size: 14px;
	}
	input::placeholder { color: var(--color-text-3); }
	input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12); }
	input.bad { border-color: var(--color-fall); }
	button {
		display: flex; align-items: center; justify-content: center; min-width: 92px;
		padding: 13px 20px; border: none; border-radius: 12px; cursor: pointer;
		background: var(--color-accent); color: #fff; font-weight: 600; font-size: 14px;
	}
	button:hover { background: var(--color-accent-light); }
	button:disabled { opacity: .6; cursor: default; }
	.msg { margin: .9rem 0 0; font-size: .8125rem; color: var(--color-fall); }
</style>
