<script lang="ts">
	// A nearby card's photo: the station from Google Street View, through
	// /stod/[slug]/mynd (a redirect to Google, or 404 when there is no imagery). Until it
	// loads, and when there is none, the tile shows the network's logo instead.
	// Google's terms: never on or next to a map, and "Google Maps" stays under the image
	// unchanged (not translated, never wrapped).
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';

	let {
		slug,
		networkSlug,
		networkName
	}: { slug: string; networkSlug: string; networkName: string } = $props();

	let loaded = $state(false);
	let failed = $state(false);
</script>

<div class="photo" class:loaded data-testid="station-photo">
	<div class="frame">
		<NetworkLogo slug={networkSlug} name={networkName} size={36} />
		{#if !failed}
			<img
				src="/stod/{slug}/mynd"
				alt=""
				width="240"
				height="180"
				loading="lazy"
				decoding="async"
				onload={() => (loaded = true)}
				onerror={() => (failed = true)}
			/>
		{/if}
	</div>
	<span class="attribution" translate="no" aria-hidden="true">Google Maps</span>
</div>

<style>
	.photo {
		flex: none;
		width: 6rem;
	}
	.frame {
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		transition: opacity 0.25s;
	}
	.loaded img {
		opacity: 1;
	}
	/* Google's text attribution: 12–16 px, weight 400, grey #5E5E5E (4.5:1 on white) */
	.attribution {
		display: block;
		margin-top: 0.2rem;
		font-family: Roboto, ui-sans-serif, system-ui, sans-serif;
		font-size: 12px;
		font-weight: 400;
		line-height: 1.2;
		color: #5e5e5e;
		white-space: nowrap;
		visibility: hidden;
	}
	.loaded .attribution {
		visibility: visible;
	}

	@media (min-width: 641px) {
		.photo {
			width: 7.5rem;
		}
	}
</style>
