<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { NEAR_PARAM, SEARCH_PARAM, formatNear } from '$lib/station-list';
	import { withParams } from '$lib/url';

	// The site's main action: the nearest stations, ranked by distance and price.
	// It needs JS (the Geolocation API), so it stays inert until hydration.
	let { class: className = '' }: { class?: string } = $props();

	let ready = $state(false);
	onMount(() => (ready = true));
	let locating = $state(false);
	let geoError = $state<string | null>(null);

	// Only ever called from a click: the browser asks for permission then, never on load.
	function locate() {
		geoError = null;
		if (!('geolocation' in navigator)) {
			geoError = m.near_unsupported();
			return;
		}
		locating = true;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				locating = false;
				// rounded to ~100 m before it goes into the URL (and so into any server log);
				// a text search would hide most nearby stations, so it goes
				const value = formatNear({ lat: pos.coords.latitude, lng: pos.coords.longitude });
				goto(withParams(page.url, { [NEAR_PARAM]: value, [SEARCH_PARAM]: null }));
			},
			(err) => {
				locating = false;
				geoError = err.code === 1 ? m.near_denied() : m.near_unavailable();
			},
			{ enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 }
		);
	}
</script>

<button
	type="button"
	class="btn btn-primary {className}"
	onclick={locate}
	disabled={!ready || locating}
	data-testid="near-me"
>
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
		><path
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linejoin="round"
			d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"
		/><circle cx="12" cy="10" r="2.4" fill="currentColor" /></svg
	>
	{locating ? m.near_locating() : m.near_me_cta()}
</button>
{#if geoError}<p class="geo-error" role="alert">{geoError}</p>{/if}

<style>
	.geo-error {
		margin: 0;
		font-size: 0.875rem;
		color: var(--danger);
	}
</style>
