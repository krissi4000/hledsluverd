<script lang="ts">
	import { networkColor, networkInitials, networkLogo } from '$lib/networks';

	let {
		slug,
		name,
		size = 24,
		decorative = true
	}: {
		slug: string;
		name: string;
		size?: number;
		/** true when the network name is printed right next to the logo */
		decorative?: boolean;
	} = $props();

	const src = $derived(networkLogo(slug));
</script>

{#if src}
	<span class="tile" style:--size="{size}px">
		<img {src} alt={decorative ? '' : name} width={size} height={size} />
	</span>
{:else}
	<span
		class="tile mono"
		style:--size="{size}px"
		style:--brand={networkColor(slug)}
		role={decorative ? undefined : 'img'}
		aria-label={decorative ? undefined : name}
		aria-hidden={decorative ? 'true' : undefined}>{networkInitials(name)}</span
	>
{/if}

<style>
	.tile {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: var(--size);
		height: var(--size);
		box-sizing: border-box;
		padding: calc(var(--size) * 0.14);
		border-radius: calc(var(--size) * 0.28);
		background: #fff;
		box-shadow: inset 0 0 0 1px var(--border);
		vertical-align: middle;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.mono {
		background: var(--brand);
		box-shadow: none;
		color: #fff;
		font-weight: 700;
		font-size: calc(var(--size) * 0.4);
		line-height: 1;
		letter-spacing: -0.02em;
	}
</style>
