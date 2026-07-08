<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import { carMatchesStation, effectiveKw, type CarSpec } from '$lib/ev';
	import { formatKm, haversineKm, type LatLng } from '$lib/geo';
	import { formatIsk } from '$lib/format';
	import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';

	let { data } = $props();

	const CAR_KEY = 'hledsluverd:car';
	const PLUG_KEY = 'hledsluverd:plug';

	let search = $state('');
	let carSlug = $state<string | null>(null);
	let plug = $state<ConnectorType | null>(null);
	let userLocation = $state<LatLng | null>(null);
	let selectedId = $state<number | null>(null);

	// restore the remembered choice once, client-side only
	$effect(() => {
		const savedCar = localStorage.getItem(CAR_KEY);
		const savedPlug = localStorage.getItem(PLUG_KEY) as ConnectorType | null;
		if (savedCar && data.cars.some((c) => c.slug === savedCar)) carSlug = savedCar;
		else if (savedPlug && (CONNECTOR_TYPES as readonly string[]).includes(savedPlug))
			plug = savedPlug;
	});

	const car = $derived.by((): CarSpec | null => {
		if (carSlug) {
			const c = data.cars.find((x) => x.slug === carSlug);
			if (c) return c;
		}
		if (plug) {
			return {
				acConnector: plug === 'Type2' ? plug : null,
				maxAcKw: null,
				dcConnector: plug !== 'Type2' ? plug : null,
				maxDcKw: null
			};
		}
		return null;
	});

	const carLabel = $derived.by(() => {
		if (carSlug) {
			const c = data.cars.find((x) => x.slug === carSlug);
			if (c) return `${c.make} ${c.model} ${c.variant ?? ''}`.trim();
		}
		return plug ?? '';
	});

	const hits = $derived(
		search.trim().length < 2
			? []
			: data.cars
					.filter((c) =>
						`${c.make} ${c.model} ${c.variant ?? ''}`
							.toLowerCase()
							.includes(search.trim().toLowerCase())
					)
					.slice(0, 30)
	);

	const compatible = $derived(
		car === null ? [] : data.stations.filter((s) => carMatchesStation(car, s.connectors))
	);

	const sorted = $derived.by(() => {
		const rows = compatible.map((s) => ({
			...s,
			kw: car ? effectiveKw(car, s.connectors) : null,
			km: userLocation ? haversineKm(userLocation, { lat: s.lat, lng: s.lng }) : null
		}));
		return rows.sort((a, b) =>
			a.km !== null && b.km !== null ? a.km - b.km : (a.price ?? Infinity) - (b.price ?? Infinity)
		);
	});

	const selected = $derived(sorted.find((s) => s.id === selectedId) ?? null);

	function chooseCar(slug: string) {
		carSlug = slug;
		plug = null;
		search = '';
		localStorage.setItem(CAR_KEY, slug);
		localStorage.removeItem(PLUG_KEY);
	}

	function choosePlug(p: ConnectorType) {
		plug = p;
		carSlug = null;
		localStorage.setItem(PLUG_KEY, p);
		localStorage.removeItem(CAR_KEY);
	}

	function reset() {
		carSlug = null;
		plug = null;
		localStorage.removeItem(CAR_KEY);
		localStorage.removeItem(PLUG_KEY);
	}

	function locate() {
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
			},
			() => {
				/* denied — the map-tap fallback is right there */
			}
		);
	}
</script>

<svelte:head>
	<title>{m.finder_title()} — {m.site_title()}</title>
	<meta name="description" content={m.finder_title()} />
</svelte:head>

<section aria-label={m.finder_title()}>
	<h2>{m.finder_title()}</h2>
	<noscript><p>{m.finder_js()}</p></noscript>

	{#if car === null}
		<h3>{m.finder_pick_car()}</h3>
		<input
			type="search"
			placeholder={m.finder_search()}
			bind:value={search}
			data-testid="car-search"
		/>
		{#if hits.length > 0}
			<ul class="hits" data-testid="car-hits">
				{#each hits as c (c.slug)}
					<li>
						<button type="button" onclick={() => chooseCar(c.slug)}
							>{c.make} {c.model} {c.variant ?? ''}</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="fallback-plug">
			{m.finder_no_car()} — {m.finder_pick_plug()}:
			{#each CONNECTOR_TYPES as t (t)}
				<button type="button" class="plug" onclick={() => choosePlug(t)}>{t}</button>
			{/each}
		</p>
	{:else}
		<p class="chosen" data-testid="chosen-car">
			<strong>{carLabel}</strong>
			<button type="button" onclick={reset}>{m.finder_change()}</button>
			<button type="button" onclick={locate}>{m.finder_use_location()}</button>
			<small>{m.finder_or_tap()}</small>
		</p>
		<p data-testid="compatible-count">{m.finder_compatible({ n: compatible.length })}</p>

		<div class="maparea">
			<StationMap
				stations={sorted}
				bind:selectedId
				bind:userLocation
				pickLocation={true}
				fallbackText={m.map_fallback()}
			/>
			{#if selected}
				<aside class="card" data-testid="finder-card">
					<h3><a href="/stod/{selected.slug}">{selected.name}</a></h3>
					<p class="net">{selected.networkName}</p>
					<p>
						{#if selected.price !== null}<strong>{formatIsk(selected.price)}</strong>
							{selected.mode}{:else}<em>{m.price_unknown()}</em>{/if}
						{#if selected.kw !== null}
							· {m.finder_up_to({ kw: Math.round(selected.kw) })}{/if}
						{#if selected.km !== null}
							· {formatKm(selected.km)}{/if}
					</p>
				</aside>
			{/if}
		</div>

		<ol class="results" data-testid="finder-results">
			{#each sorted.slice(0, 25) as s (s.id)}
				<li>
					<a href="/stod/{s.slug}">{s.name}</a>
					<span class="net">{s.networkName}</span>
					{#if s.price !== null}<strong>{formatIsk(s.price)}</strong>{/if}
					{#if s.kw !== null}<span>{m.finder_up_to({ kw: Math.round(s.kw) })}</span>{/if}
					{#if s.km !== null}<span>{formatKm(s.km)}</span>{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	input[type='search'] {
		width: 100%;
		max-width: 24rem;
		padding: 0.4rem 0.6rem;
		font-size: 1rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.4rem;
	}
	.hits {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		max-width: 24rem;
	}
	.hits button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-bottom: 1px solid var(--border, #e2e2e2);
		padding: 0.4rem 0.25rem;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.hits button:hover {
		background: #f4f4f4;
	}
	.plug {
		margin-left: 0.4rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		background: none;
		padding: 0.15rem 0.7rem;
		cursor: pointer;
	}
	.chosen button {
		margin-left: 0.5rem;
	}
	.maparea {
		position: relative;
		height: 55vh;
		min-height: 20rem;
		margin: 0.75rem 0;
	}
	.card {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		background: #fff;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.5rem;
		box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
		padding: 0.6rem 0.9rem;
		max-width: 20rem;
	}
	.card h3 {
		margin: 0 0 0.25rem;
	}
	.card p {
		margin: 0.25rem 0;
	}
	.net {
		opacity: 0.7;
		font-size: 0.9rem;
		margin-right: 0.4rem;
	}
	.results {
		padding-left: 1.25rem;
	}
	.results li {
		padding: 0.25rem 0;
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: baseline;
	}
</style>
