<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import * as m from '$lib/paraglide/messages';
	import { ageParts, formatNumber } from '$lib/format';
	import type { LatLng } from '$lib/geo';
	import { networkColor, networkInitials, networkLogo } from '$lib/networks';
	import { priceRanks, rankColors } from '$lib/price-scale';

	interface PinStation {
		id: number;
		lat: number;
		lng: number;
		price: number | null;
		/** ranks prices within AC or DC only, when given */
		mode?: 'AC' | 'DC';
		networkSlug: string;
		networkName: string;
		name?: string;
		freeCount?: number | null;
		totalCount?: number | null;
		availabilityFetchedAt?: Date | null;
	}

	// Pins have no room for an age label, so they only carry availability that is
	// near-live; older readings stay on the station card, where the age is shown.
	// The tooltip always states the age (honesty rule: shown availability has an age).
	const PIN_AVAILABILITY_MAX_AGE_MS = 30 * 60 * 1000;

	function pinAvailability(s: PinStation): { free: number; total: number; age: string } | null {
		const { freeCount: free, totalCount: total, availabilityFetchedAt: at } = s;
		if (free == null || total == null || total === 0 || !at) return null;
		if (Date.now() - at.getTime() > PIN_AVAILABILITY_MAX_AGE_MS) return null;
		const p = ageParts(at);
		const age =
			p.unit === 'min'
				? m.age_min({ n: p.n })
				: p.unit === 'h'
					? m.age_h({ n: p.n })
					: m.age_d({ n: p.n });
		return { free, total, age };
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
		const ranks = priceRanks(stations);
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
			const rank = ranks.get(s.id);
			if (rank !== undefined) {
				const c = rankColors(rank);
				el.style.setProperty('--pin-bg', c.background);
				el.style.setProperty('--pin-border', c.border);
			}
			const avail = pinAvailability(s);
			const title = [s.name, s.networkName, s.mode].filter(Boolean).join(' · ');
			el.title = avail
				? `${title} · ${m.pin_free({ free: avail.free, total: avail.total })} (${avail.age})`
				: title;
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
			label.className = 'pin-price';
			if (s.price === null) {
				label.textContent = '?';
			} else {
				label.textContent = formatNumber(s.price);
				const unit = document.createElement('span');
				unit.className = 'pin-unit';
				unit.textContent = 'kr';
				label.append(unit);
			}
			el.append(label);
			// AC (slow) and DC (fast) prices are not comparable, so every pin says which it is
			if (s.mode) {
				const tag = document.createElement('span');
				tag.className = `pin-mode pin-mode-${s.mode.toLowerCase()}`;
				tag.dataset.testid = 'map-pin-mode';
				tag.textContent = s.mode;
				el.dataset.mode = s.mode;
				el.append(tag);
			}
			if (avail) {
				const free = document.createElement('span');
				free.className = avail.free > 0 ? 'pin-avail' : 'pin-avail pin-avail-none';
				free.dataset.testid = 'map-pin-availability';
				free.textContent = `${avail.free}/${avail.total}`;
				el.append(free);
			}
			wrap.append(el);
			pinEls.set(s.id, wrap);
			el.addEventListener('click', (ev) => {
				ev.stopPropagation();
				selectedId = s.id;
				revealAboveCard(s);
			});
			// anchor at the bottom: the tip under the pill points at the exact location
			return new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
				.setLngLat([s.lng, s.lat])
				.addTo(map!);
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
		/* keep the markers' z-indexes inside the map, under overlays drawn over it */
		isolation: isolate;
	}
	.fallback {
		opacity: 0.7;
		padding: 1rem 0;
	}
	/* the wrap's bottom edge is the marker anchor, so it reserves room for the tip */
	:global(.pin-wrap) {
		display: flex;
		padding-bottom: var(--pin-tip);
		--pin-tip: 6px;
	}
	:global(.pin) {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 2px 0.45rem 2px 2px;
		background: var(--pin-bg, #fff);
		color: var(--text, #111a15);
		border: 1px solid var(--pin-border, rgb(0 0 0 / 12%));
		border-radius: 999px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
		/* scale around the tip so the pin never drifts off its location */
		transform-origin: 50% calc(100% + var(--pin-tip));
		transition:
			transform 0.12s,
			background-color 0.12s;
	}
	/* teardrop tip: a rotated square clipped to its lower half, sharing the pill's
	   fill and border; it overlaps the pill's bottom border by 1px to hide the seam */
	:global(.pin)::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 1px;
		width: 10px;
		height: 10px;
		box-sizing: border-box;
		background: var(--pin-bg, #fff);
		border-right: 1px solid var(--pin-border, rgb(0 0 0 / 12%));
		border-bottom: 1px solid var(--pin-border, rgb(0 0 0 / 12%));
		clip-path: polygon(100% 0, 100% 100%, 0 100%);
		transform: translate(-50%, 50%) rotate(45deg);
		pointer-events: none;
	}
	:global(.pin-wrap.selected .pin)::after {
		border-color: var(--text, #111a15);
	}
	:global(.pin-unit) {
		margin-left: 1px;
		font-size: 0.55rem;
		font-weight: 600;
		opacity: 0.7;
	}
	:global(.pin-mode) {
		margin-left: 1px;
		padding: 2px 3px;
		border-radius: 4px;
		font-size: 0.55rem;
		font-weight: 750;
		letter-spacing: 0.02em;
		line-height: 1;
	}
	:global(.pin-mode-dc) {
		background: var(--text, #111a15);
		color: #fff;
	}
	/* AC: outlined, so slow-charging pins read differently at a glance */
	:global(.pin-mode-ac) {
		padding: 1px 2px;
		border: 1px solid currentColor;
		background: rgb(255 255 255 / 70%);
	}
	:global(.pin-avail) {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-left: 0.15rem;
		padding-left: 0.35rem;
		border-left: 1px solid rgb(0 0 0 / 15%);
		font-size: 0.7rem;
		font-weight: 650;
	}
	/* dot: green = a charger is free, grey = all busy (a known 0, not unknown) */
	:global(.pin-avail)::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #16a34a;
		box-shadow: 0 0 0 1px #fff;
	}
	:global(.pin-avail-none)::before {
		background: #9ca3af;
	}
	:global(.pin:hover) {
		transform: scale(1.08);
	}
	:global(.pin-wrap.selected) {
		z-index: 9999 !important;
	}
	/* keep the price colour on the selected pin; mark it with a dark ring instead */
	:global(.pin-wrap.selected .pin) {
		border-color: var(--text, #111a15);
		box-shadow:
			0 0 0 2px var(--text, #111a15),
			0 2px 8px rgb(0 0 0 / 35%);
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
