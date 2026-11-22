<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	// "Take me there": the main action wherever a station is shown, so it is always the
	// same primary button. It opens Google Maps' directions; the title and accessible
	// name say so, the visible label is Google's own word for it ("Leiðarlýsing").
	let { lat, lng, class: className = '' }: { lat: number; lng: number; class?: string } = $props();
</script>

<a
	class="btn btn-primary {className}"
	href="https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"
	rel="noopener external"
	title={m.station_directions()}
	aria-label={m.station_directions()}
	data-testid="directions"
>
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
		><path
			fill="currentColor"
			d="M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4ZM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5Z"
		/></svg
	>
	{m.directions()}
</a>
