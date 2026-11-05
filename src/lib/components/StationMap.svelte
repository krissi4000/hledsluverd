<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { formatNumber } from '$lib/format';
	import type { LatLng } from '$lib/geo';
	import { networkColor, networkInitials, networkLogo } from '$lib/networks';

	interface PinStation {
		id: number;
		lat: number;
		lng: number;
		price: number | null;
		networkSlug: string;
		networkName: string;
		name?: string;
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
	let pinEls = new Map<number, HTMLElement>();
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
		pinEls = new Map();
		markers = stations.map((s, i) => {
			// MapLibre owns the marker element's transform, so the visible pin is a child
			const wrap = document.createElement('div');
			wrap.className = 'pin-wrap';
			// Higher z-index for earlier stations so DOM-first is visually on top (Playwright-friendly)
			wrap.style.zIndex = String(stations.length - i);
			const el = document.createElement('button');
			el.className = 'pin';
			el.dataset.testid = 'map-pin';
			el.type = 'button';
			el.title = s.name ? `${s.name} · ${s.networkName}` : s.networkName;
			const logoUrl = networkLogo(s.networkSlug);
			if (logoUrl) {
				const img = document.createElement('img');
				img.src = logoUrl;
				img.alt = '';
				img.className = 'pin-logo';
				el.append(img);
			} else {
				const mono = document.createElement('span');
				mono.className = 'pin-logo pin-mono';
				mono.style.background = networkColor(s.networkSlug);
				mono.textContent = networkInitials(s.networkName);
				el.append(mono);
			}
			const label = document.createElement('span');
			label.textContent = s.price === null ? '?' : formatNumber(s.price);
			el.append(label);
			wrap.append(el);
			pinEls.set(s.id, wrap);
			el.addEventListener('click', (ev) => {
				ev.stopPropagation();
				selectedId = s.id;
				revealAboveCard(s);
			});
			return new maplibregl.Marker({ element: wrap }).setLngLat([s.lng, s.lat]).addTo(map!);
		});
	});

	// Pages show the selected station in a card docked to the map's bottom edge
	// (full width on phones, bottom-left otherwise). Pan a pin that would end up
	// under the card into the clear part of the map.
	function revealAboveCard(s: PinStation) {
		if (!map) return;
		const { clientWidth: w, clientHeight: h } = map.getContainer();
		const pt = map.project([s.lng, s.lat]);
		const narrow = w < 640;
		const cardTop = h - (narrow ? 290 : 320);
		const covered = pt.y > cardTop - 30 && (narrow || pt.x < 400);
		if (covered) {
			map.easeTo({
				center: [s.lng, s.lat],
				padding: narrow ? { bottom: h - cardTop } : { left: 400, bottom: h - cardTop },
				duration: 400
			});
		}
	}

	// highlight the selected pin without rebuilding every marker
	$effect(() => {
		if (!map) return;
		void stations; // re-apply after markers are rebuilt
		for (const [id, el] of pinEls) el.classList.toggle('selected', id === selectedId);
	});

	$effect(() => {
		if (!map) return;
		userMarker?.remove();
		userMarker = undefined;
		if (userLocation) {
			const el = document.createElement('div');
			el.className = 'you';
			el.dataset.testid = 'user-pin';
			el.style.zIndex = '10000';
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
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 2px 0.45rem 2px 2px;
		background: #fff;
		color: var(--text, #111a15);
		border: 1px solid rgb(0 0 0 / 12%);
		border-radius: 999px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
		transition:
			transform 0.12s,
			background-color 0.12s;
	}
	:global(.pin:hover) {
		transform: scale(1.08);
	}
	:global(.pin-wrap.selected) {
		z-index: 9999 !important;
	}
	:global(.pin-wrap.selected .pin) {
		background: var(--accent, #15803d);
		border-color: var(--accent, #15803d);
		color: #fff;
		transform: scale(1.12);
	}
	:global(.pin-logo) {
		width: 1.15rem;
		height: 1.15rem;
		padding: 2px;
		border-radius: 50%;
		background: #fff;
		object-fit: contain;
		box-sizing: border-box;
	}
	:global(.pin-mono) {
		display: grid;
		place-items: center;
		padding: 0;
		color: #fff;
		font-size: 0.5rem;
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
