<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import DirectionsLink from '$lib/components/DirectionsLink.svelte';
	import { formatIsk } from '$lib/format';
	import { updatedText } from '$lib/age';
	import { ownBrandPriceOnly } from '$lib/networks';
	import NetworkToggles from '$lib/components/NetworkToggles.svelte';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';
	import UnknownStalls from '$lib/components/UnknownStalls.svelte';
	import GooglePlacePhoto from '$lib/components/GooglePlacePhoto.svelte';
	import OtherPrice from '$lib/components/OtherPrice.svelte';
	import { unknownStalls } from '$lib/availability';
	import { stationDisplayName } from '$lib/station-name';
	import { NEAR_PARAM, parseNear } from '$lib/station-list';
	import type { LatLng } from '$lib/geo';
	import { withParams } from '$lib/url';
	import { page } from '$app/state';
	import { CONNECTOR_TYPES } from '$lib/types';
	import {
		NETWORK_PARAM,
		defaultNetworks,
		isDefault,
		parseShown,
		toggleParam
	} from '$lib/filter-params';

	let { data } = $props();
	let selectedId = $state<number | null>(null);

	/** how much taller the station card gets with a Google photo on top */
	const PHOTO_ROOM_PX = 190;
	let filtersOpen = $state(false);

	// Filters live in the URL like the homepage's (shareable, back button works). The
	// load function never reads the URL, so changing them filters here without a refetch.
	const MODES = ['DC', 'AC'] as const;
	const networkOptions = $derived(
		[...new Map(data.stations.map((s) => [s.networkSlug, s.networkName]))]
			.map(([slug, name]) => ({ slug, name }))
			.sort((a, b) => a.name.localeCompare(b.name, 'is'))
	);
	const slugs = $derived(networkOptions.map((n) => n.slug));
	const networkDefaults = $derived(defaultNetworks(slugs));
	const params = $derived(page.url.searchParams);
	const networks = $derived(parseShown(params.get(NETWORK_PARAM), slugs, networkDefaults));
	const modes = $derived(parseShown(params.get('afl'), MODES, MODES));
	const connector = $derived(CONNECTOR_TYPES.find((t) => t === params.get('tengi')) ?? null);
	const activeFilters = $derived(
		Number(!isDefault(networks, networkDefaults)) +
			Number(!isDefault(modes, MODES)) +
			Number(connector !== null)
	);

	// The price colours rank only what is shown, so hidden networks (Tesla's own-brand
	// price, by default) don't make everyone else look expensive.
	const visible = $derived(
		data.stations.filter(
			(s) =>
				networks.includes(s.networkSlug) &&
				modes.includes(s.mode) &&
				(!connector || s.connectors.some((c) => c.type === connector))
		)
	);
	const selected = $derived(visible.find((s) => s.id === selectedId) ?? null);

	// the filter panel behaves like a menu: picking a station closes it
	$effect(() => {
		if (selectedId !== null) filtersOpen = false;
	});

	const href = (next: Record<string, string | null>) => withParams(page.url, next);

	// Arriving from "Nálægt mér" (?nalaegt=, already rounded): start at the visitor, not
	// at all of Iceland. The map button finds the position the same way, on a click only.
	const start = parseNear(page.url.searchParams.get(NEAR_PARAM));
	let userLocation = $state<LatLng | null>(start);
	let map = $state<StationMap>();
	let canLocate = $state(false);
	let locating = $state(false);
	let locateError = $state<string | null>(null);
	onMount(() => (canLocate = 'geolocation' in navigator));

	function locate() {
		locateError = null;
		locating = true;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				locating = false;
				userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
				map?.flyTo(userLocation, 12);
			},
			(err) => {
				locating = false;
				locateError = err.code === 1 ? m.near_denied() : m.near_unavailable();
			},
			{ enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 }
		);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') filtersOpen = false;
	}}
/>

<section aria-labelledby="map-title" class="wrap">
	<h1 id="map-title" class="visually-hidden">{m.map_title()}</h1>
	<noscript><p class="js-note">{m.map_js()}</p></noscript>
	<div class="maparea" class:has-card={selected}>
		<StationMap
			bind:this={map}
			stations={visible}
			bind:selectedId
			bind:userLocation
			center={start ? [start.lng, start.lat] : undefined}
			zoom={start ? 12 : undefined}
			fallbackText={m.map_fallback()}
			cardExtra={(id) =>
				data.googleMapsKey && visible.find((s) => s.id === id)?.googlePlaceId ? PHOTO_ROOM_PX : 0}
		/>

		<div class="controls">
			{#if filtersOpen}
				<div
					class="filter-panel"
					id="map-filters"
					data-testid="map-filters"
					data-sveltekit-replacestate
					data-sveltekit-noscroll
					data-sveltekit-keepfocus
				>
					<div class="panel-head">
						<h2>{m.filters()}</h2>
						{#if activeFilters > 0}
							<a
								class="btn btn-ghost btn-sm"
								href={href({ [NETWORK_PARAM]: null, afl: null, tengi: null })}
								data-testid="map-filters-reset">{m.filter_reset()}</a
							>
						{/if}
					</div>
					<div class="group">
						<span class="label" aria-hidden="true">{m.filter_mode()}</span>
						<span class="pills" role="group" aria-label={m.filter_mode()}>
							{#each MODES as mode (mode)}
								{@const on = modes.includes(mode)}
								<a
									class="pill"
									class:active={on}
									class:off={!on}
									href={href({ afl: toggleParam(modes, mode, MODES, MODES) })}
									>{mode === 'DC' ? m.mode_dc() : m.mode_ac()}<span class="visually-hidden"
										>, {on ? m.filter_on() : m.filter_off()}</span
									></a
								>
							{/each}
						</span>
					</div>
					<div class="group">
						<span class="label" aria-hidden="true">{m.th_connectors()}</span>
						<span class="pills" role="group" aria-label={m.th_connectors()}>
							{#each CONNECTOR_TYPES as t (t)}
								<a
									class="pill"
									class:active={connector === t}
									aria-current={connector === t ? 'page' : undefined}
									href={href({ tengi: connector === t ? null : t })}
									><ConnectorIcon type={t} size={18} />{t}</a
								>
							{/each}
						</span>
					</div>
					<div class="group">
						<span class="label" aria-hidden="true">{m.th_network()}</span>
						<NetworkToggles
							options={networkOptions}
							shown={networks}
							defaults={networkDefaults}
							href={(v) => href({ [NETWORK_PARAM]: v })}
						/>
					</div>
				</div>
			{/if}
			{#if locateError}<p class="locate-error" role="alert">{locateError}</p>{/if}
			<div class="buttons">
				{#if canLocate}
					<button
						type="button"
						class="btn btn-float square"
						onclick={locate}
						disabled={locating}
						aria-label={m.map_locate()}
						title={m.map_locate()}
						data-testid="map-locate"
						><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
							><circle cx="12" cy="12" r="3.2" fill="currentColor" /><path
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								d="M12 3v3m0 12v3M3 12h3m12 0h3m-2.5 0a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
							/></svg
						></button
					>
				{/if}
				<button
					type="button"
					class="btn btn-float"
					class:on={filtersOpen}
					aria-expanded={filtersOpen}
					aria-controls="map-filters"
					data-testid="map-filters-toggle"
					onclick={() => (filtersOpen = !filtersOpen)}
				>
					<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
						><path
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							d="M4 6h16M7 12h10M10 18h4"
						/></svg
					>
					{m.filters()}
					{#if activeFilters > 0}<span class="count" title={m.filters_active({ n: activeFilters })}
							>{activeFilters}</span
						>{/if}
				</button>
			</div>
		</div>
		{#if selected}
			<aside class="card" data-testid="map-card">
				{#if data.googleMapsKey && selected.googlePlaceId}
					{#key selected.googlePlaceId}
						<GooglePlacePhoto apiKey={data.googleMapsKey} placeId={selected.googlePlaceId} />
					{/key}
				{/if}
				<div class="card-head">
					<NetworkLogo slug={selected.networkSlug} name={selected.networkName} size={40} />
					<div class="card-title">
						<h2>
							<a href="/stod/{selected.slug}"
								>{stationDisplayName(selected.name, selected.networkName)}</a
							>
						</h2>
						<p class="net">
							{selected.networkName}{#if selected.underConstruction}
								<span class="badge badge-muted" data-testid="under-construction"
									>{m.under_construction()}</span
								>{/if}
						</p>
					</div>
					<button
						type="button"
						class="btn btn-icon close"
						aria-label={m.close()}
						onclick={() => (selectedId = null)}
					>
						<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
							><path
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								d="M6 6l12 12M18 6 6 18"
							/></svg
						>
					</button>
				</div>
				<dl class="stats">
					<div>
						<dt>{m.station_prices()}</dt>
						<dd>
							{#if selected.underConstruction}
								<small class="muted">{m.under_construction_note()}</small>
							{:else if selected.price !== null}
								<strong class="num">{formatIsk(selected.price)}</strong><span class="per"
									>{m.price_per_kwh()}</span
								>
								<span class="mode">{selected.mode}</span>
								{#if ownBrandPriceOnly(selected.networkSlug)}<small
										class="muted"
										title={m.tesla_price_only_title()}>{m.tesla_price_only()}</small
									>{/if}
							{:else}
								<span class="muted">{m.price_unknown()}</span>
							{/if}
							<!-- the pin shows the fast price; slow charging here too gets a line -->
							{#if selected.other}<OtherPrice other={selected.other} />{/if}
						</dd>
					</div>
					<div data-testid="card-availability">
						<dt>{m.th_free()}</dt>
						<dd>
							{#if selected.freeCount !== null && selected.totalCount !== null}
								<strong class="num">{selected.freeCount}/{selected.totalCount}</strong
								><UnknownStalls
									unknown={unknownStalls(selected.stallCount, selected.totalCount)}
									total={selected.totalCount}
								/>
								{#if selected.availabilityFetchedAt}<small class="muted"
										>{updatedText(selected.availabilityFetchedAt)}</small
									>{/if}
							{:else}<span title={m.avail_unknown_title()}>—</span>{/if}
						</dd>
					</div>
				</dl>
				<p class="chips">
					{#each selected.connectors as c, ci (ci)}
						<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
					{/each}
				</p>
				<div class="card-actions">
					<DirectionsLink lat={selected.lat} lng={selected.lng} />
					<a class="btn" href="/stod/{selected.slug}">{m.map_details()}</a>
				</div>
			</aside>
		{/if}
	</div>
</section>

<style>
	/* break out of main's centered column so the map runs edge to edge */
	.wrap {
		margin: -1.25rem calc(50% - 50vw) -3rem;
	}
	.maparea {
		position: relative;
		height: calc(100dvh - var(--header-h));
		min-height: 24rem;
	}
	.js-note {
		padding: 1rem;
	}

	.card {
		position: absolute;
		left: 1rem;
		bottom: 1.5rem;
		z-index: 10;
		width: min(22rem, calc(100% - 2rem));
		/* a tall card (a photo on top, a short phone) scrolls rather than run off the map */
		max-height: calc(100% - 2.5rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.card-title {
		flex: 1;
		min-width: 0;
	}
	.card h2 {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.25;
	}
	.card h2 a {
		color: var(--text);
		text-decoration: none;
	}
	.card h2 a:hover {
		text-decoration: underline;
	}
	.net {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.net .badge {
		margin-left: 0.3rem;
	}
	.close {
		align-self: flex-start;
		margin: -0.3rem -0.4rem 0 0;
	}
	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin: 0.85rem 0 0.6rem;
		padding: 0.7rem 0.85rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	dt {
		color: var(--muted);
		font-size: 0.8rem;
	}
	dd {
		margin: 0;
	}
	.stats strong {
		font-size: 1.2rem;
		font-weight: 750;
	}
	.stats small {
		display: block;
		font-size: 0.75rem;
	}
	.per {
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 600;
	}
	.mode {
		margin-left: 0.2rem;
		padding: 0 0.3rem;
		border-radius: 4px;
		background: var(--surface);
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.chips {
		margin: 0 0 0.75rem;
	}
	.card-actions {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
	}

	/* bottom right, above MapLibre's attribution line */
	.controls {
		position: absolute;
		right: 0.75rem;
		bottom: 2.6rem;
		z-index: 11;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
	}
	.buttons {
		display: flex;
		gap: 0.5rem;
	}
	.square {
		width: var(--control-h);
		padding: 0;
		color: var(--accent-text);
	}
	.btn-float.on {
		border-color: var(--accent);
		color: var(--accent-text);
	}
	.count {
		display: grid;
		place-items: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-size: 0.72rem;
		font-weight: 700;
	}
	.locate-error {
		max-width: min(20rem, calc(100vw - 1.5rem));
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
		color: var(--danger);
		font-size: 0.85rem;
	}
	.filter-panel {
		width: min(25rem, calc(100vw - 1.5rem));
		max-height: calc(100dvh - var(--header-h) - 6rem);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 0.9rem 1rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}
	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: var(--control-h-sm);
	}
	.panel-head h2 {
		margin: 0;
		font-size: 1rem;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
	}

	@media (max-width: 640px) {
		/* one bottom overlay at a time on phones: the station card wins */
		.has-card .controls {
			display: none;
		}
		/* clear the attribution, which wraps to two lines until the map is first moved */
		.controls {
			right: 0.5rem;
			bottom: 4.5rem;
		}
		.card {
			left: 0.5rem;
			right: 0.5rem;
			bottom: 0.5rem;
			width: auto;
		}
	}
</style>
