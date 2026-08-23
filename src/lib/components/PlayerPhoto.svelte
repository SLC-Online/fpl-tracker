<script lang="ts">
	import { playerPhotoUrl, playerPhotoFallback } from '$lib/types';

	interface Props {
		code: number;
		teamCode: number;
		size?: '40x40' | '110x140' | '250x250';
		class?: string;
		isGk?: boolean;
	}

	let { code, teamCode, size = '250x250', class: className = '', isGk = false }: Props = $props();
	let failed = $state(false);
</script>

{#if failed}
	<img
		src={playerPhotoFallback(teamCode, isGk)}
		alt=""
		class={className}
	/>
{:else}
	<img
		src={playerPhotoUrl(code, size)}
		alt=""
		class={className}
		onerror={() => { failed = true; }}
	/>
{/if}
