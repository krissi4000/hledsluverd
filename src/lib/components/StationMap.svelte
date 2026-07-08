<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { formatNumber } from '$lib/format';
	import type { LatLng } from '$lib/geo';

	interface PinStation {
		id: number;
		lat: number;
		lng: number;
		price: number | null;
	}

	let {
		stations,
		selectedId = $bindable(null),
		pickLocation = false,
		userLocation = $bindable(null),
		center = [-18.8, 65.0] as [number, number],
		zoom = 5.2,
		fallbackText
	}: {
		stations: PinStation[];
		selectedId?: number | null;
		pickLocation?: boolean;
		userLocation?: LatLng | null;
		center?: [number, number];
		zoom?: number;
		fallbackText: string;
	} = $props();

	let mapEl = $state<HTMLDivElement>();
	let map = $state<maplibregl.Map>();
	let failed = $state(false);
	let markers: maplibregl.Marker[] = [];
	let userMarker: maplibregl.Marker | undefined;

	$effect(() => {
		if (!mapEl) return;
		let m: maplibregl.Map;
		try {
			m = new maplibregl.Map({
				container: mapEl,
				style: 'https://tiles.openfreemap.org/styles/liberty',
				center,
				zoom
			});
		} catch {
			failed = true; // no WebGL — the SSR content still tells the whole story
			return;
		}
		if (pickLocation) {
			m.on('click', (e) => {
				userLocation = { lat: e.lngLat.lat, lng: e.lngLat.lng };
			});
		}
		map = m;
		return () => m.remove();
	});

	$effect(() => {
		if (!map) return;
		for (const mk of markers) mk.remove();
		markers = stations.map((s) => {
			const el = document.createElement('button');
			el.className = 'pin';
			el.dataset.testid = 'map-pin';
			el.type = 'button';
			el.textContent = s.price === null ? '?' : formatNumber(s.price);
			el.addEventListener('click', (ev) => {
				ev.stopPropagation();
				selectedId = s.id;
			});
			return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map!);
		});
	});

	$effect(() => {
		if (!map) return;
		userMarker?.remove();
		userMarker = undefined;
		if (userLocation) {
			const el = document.createElement('div');
			el.className = 'you';
			el.dataset.testid = 'user-pin';
			userMarker = new maplibregl.Marker({ element: el })
				.setLngLat([userLocation.lng, userLocation.lat])
				.addTo(map);
		}
	});
</script>

{#if failed}
	<p class="fallback" data-testid="map-fallback">{fallbackText}</p>
{:else}
	<div class="map" bind:this={mapEl}></div>
{/if}

<style>
	.map {
		width: 100%;
		height: 100%;
		min-height: 16rem;
	}
	.fallback {
		opacity: 0.7;
		padding: 1rem 0;
	}
	:global(.pin) {
		background: var(--accent, #2e7d32);
		color: #fff;
		border: 2px solid #fff;
		border-radius: 1rem;
		padding: 0.05rem 0.45rem;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
	}
	:global(.you) {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: #1565c0;
		border: 3px solid #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
	}
</style>
