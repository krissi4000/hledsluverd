<script lang="ts">
	// The station's photo from Google Maps on the /kort station card, through Google's
	// Places UI Kit: a Place Details Compact element showing only the place's photo (tap
	// for more, in Google's own viewer) and Google's attribution. Unlike Street View images
	// (see $lib/server/streetview), Google's terms allow UI Kit content with any map.
	// Each load is billed (Places UI Kit, 10 000 a month free), so it loads only for a
	// station the visitor opens. It takes no room and shows nothing until a photo has
	// rendered, and stays that way when the place has none or Google can't be reached.
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { loadPlacesUiKit } from '$lib/google-maps';

	let { placeId, apiKey }: { placeId: string; apiKey: string } = $props();

	/** taller than Google's attribution line alone, so the element is showing a photo */
	const MIN_PHOTO_PX = 72;

	let phase = $state<'loading' | 'rendering' | 'gone'>('loading');
	let shown = $state(false);
	let el = $state<HTMLElement>();

	$effect(() => {
		let live = true;
		loadPlacesUiKit(apiKey, getLocale()).then(
			() => live && (phase = 'rendering'),
			() => live && (phase = 'gone')
		);
		return () => {
			live = false;
		};
	});

	$effect(() => {
		const node = el;
		if (!node) return;
		// a place without photos renders the attribution alone; that stays hidden
		const sized = new ResizeObserver(() => (shown = node.offsetHeight >= MIN_PHOTO_PX));
		const gone = () => (phase = 'gone');
		sized.observe(node);
		node.addEventListener('gmp-error', gone);
		return () => {
			sized.disconnect();
			node.removeEventListener('gmp-error', gone);
		};
	});
</script>

{#if phase !== 'gone'}
	<figure
		class="gphoto"
		class:shown
		aria-label={m.map_google_photo()}
		aria-hidden={!shown}
		data-testid="google-place"
	>
		{#if phase === 'rendering'}
			<gmp-place-details-compact bind:this={el} orientation="vertical">
				<gmp-place-details-place-request place={placeId}></gmp-place-details-place-request>
				<gmp-place-media lightbox-preferred></gmp-place-media>
				<gmp-place-attribution light-scheme-color="gray" dark-scheme-color="white"
				></gmp-place-attribution>
			</gmp-place-details-compact>
		{/if}
	</figure>
{/if}

<style>
	.gphoto {
		margin: 0 0 0.85rem;
	}
	/* laid out, so Google can render into it, but out of the card's flow and invisible
	   until it holds a photo */
	.gphoto:not(.shown) {
		position: absolute;
		inset: 0 0 auto;
		margin: 0;
		visibility: hidden;
		pointer-events: none;
	}
	gmp-place-details-compact {
		display: block;
		width: 100%;
		/* the site is light only; Google's own default follows the device's setting */
		color-scheme: light;
		background-color: transparent;
		border: none;
		--gmp-mat-color-surface: var(--surface);
		--gmp-thumbnail-border-radius: var(--radius-sm);
	}
</style>
