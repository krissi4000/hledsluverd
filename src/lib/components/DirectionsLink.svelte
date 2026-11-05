<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let {
		lat,
		lng,
		primary = false,
		class: className = ''
	}: { lat: number; lng: number; primary?: boolean; class?: string } = $props();
</script>

<!-- visible text is just "Google Maps"; the accessible name and hover title say it's directions -->
<a
	class="btn {className}"
	class:btn-primary={primary}
	href="https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"
	rel="noopener external"
	title={m.station_directions()}
	aria-label={m.station_directions()}
>
	<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
		><path
			fill="currentColor"
			d="M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4ZM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5Z"
		/></svg
	>
	{m.google_maps()}
</a>
