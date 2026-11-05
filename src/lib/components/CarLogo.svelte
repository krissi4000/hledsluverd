<script lang="ts">
	import { carInitials, carLogo } from '$lib/cars';

	let { make, size = 24 }: { make: string; size?: number } = $props();

	const src = $derived(carLogo(make));
</script>

<!-- always decorative: the make is printed right next to it -->
{#if src}
	<img class="logo" {src} alt="" width={size} height={size} style:--size="{size}px" />
{:else}
	<span class="logo mono" style:--size="{size}px" aria-hidden="true">{carInitials(make)}</span>
{/if}

<style>
	.logo {
		flex: none;
		width: var(--size);
		height: var(--size);
		object-fit: contain;
		vertical-align: middle;
	}
	.mono {
		display: inline-grid;
		place-items: center;
		border-radius: 50%;
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--border);
		color: var(--muted);
		font-size: calc(var(--size) * 0.38);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.02em;
	}
</style>
