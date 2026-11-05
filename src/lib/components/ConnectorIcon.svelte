<script lang="ts">
	import type { ConnectorType } from '$lib/types';

	// Schematic plug faces, as seen looking into the socket. Always decorative:
	// the connector name is printed right next to the icon.
	let { type, size = 20 }: { type: ConnectorType; size?: number } = $props();
</script>

<svg
	class="connector-icon"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	aria-hidden="true"
	fill="currentColor"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linejoin="round"
>
	{#if type === 'Type2'}
		<!-- round housing with a flat top; 2 signal pins over 5 power pins -->
		<path fill="none" d="M6.17 4.5h11.66a9.5 9.5 0 1 1-11.66 0Z" />
		<g stroke="none">
			<circle cx="9.6" cy="7.6" r="1.1" />
			<circle cx="14.4" cy="7.6" r="1.1" />
			<circle cx="7.2" cy="12.2" r="1.6" />
			<circle cx="12" cy="12.2" r="1.6" />
			<circle cx="16.8" cy="12.2" r="1.6" />
			<circle cx="9.6" cy="16.8" r="1.6" />
			<circle cx="14.4" cy="16.8" r="1.6" />
		</g>
	{:else if type === 'CCS2'}
		<!-- Type 2 signal half on top, separate DC half with two big pins below -->
		<path fill="none" d="M8.54 2.2h6.92a6.5 6.5 0 1 1-6.92 0Z" />
		<rect fill="none" x="6" y="15.6" width="12" height="6.8" rx="3.4" />
		<g stroke="none">
			<circle cx="10" cy="5.3" r="1" />
			<circle cx="14" cy="5.3" r="1" />
			<circle cx="8.6" cy="9.4" r="1.2" />
			<circle cx="12" cy="9.4" r="1.2" />
			<circle cx="15.4" cy="9.4" r="1.2" />
			<circle cx="9.3" cy="19" r="1.7" />
			<circle cx="14.7" cy="19" r="1.7" />
		</g>
	{:else}
		<!-- CHAdeMO: large round face with a key notch, two big DC pins and a row of signal pins -->
		<path fill="none" d="M10.4 2.6a9.5 9.5 0 1 0 3.2 0v1.6h-3.2Z" />
		<g stroke="none">
			<circle cx="8.3" cy="10" r="2.3" />
			<circle cx="15.7" cy="10" r="2.3" />
			<circle cx="6.9" cy="14.9" r="0.95" />
			<circle cx="9.3" cy="16.9" r="0.95" />
			<circle cx="12" cy="17.6" r="0.95" />
			<circle cx="14.7" cy="16.9" r="0.95" />
			<circle cx="17.1" cy="14.9" r="0.95" />
			<circle cx="12" cy="13.6" r="0.95" />
		</g>
	{/if}
</svg>

<style>
	.connector-icon {
		flex: none;
		vertical-align: middle;
	}
</style>
