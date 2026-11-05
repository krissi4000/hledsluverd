<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
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
		<div class="picker surface">
			<h3>{m.finder_pick_car()}</h3>
			<div class="search">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
					><path
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
					/></svg
				>
				<input
					type="search"
					placeholder={m.finder_search()}
					bind:value={search}
					data-testid="car-search"
				/>
			</div>
			{#if hits.length > 0}
				<ul class="hits" data-testid="car-hits">
					{#each hits as c (c.slug)}
						<li>
							<button type="button" onclick={() => chooseCar(c.slug)}
								><strong>{c.make}</strong>
								{c.model} <span class="muted">{c.variant ?? ''}</span></button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="fallback-plug">
				<span class="muted">{m.finder_no_car()} — {m.finder_pick_plug()}:</span>
				<span class="pills">
					{#each CONNECTOR_TYPES as t (t)}
						<button type="button" class="pill" onclick={() => choosePlug(t)}>{t}</button>
					{/each}
				</span>
			</div>
		</div>
	{:else}
		<div class="chosen surface" data-testid="chosen-car">
			<div class="car">
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
					><path
						fill="currentColor"
						d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11a2 2 0 0 1 2 2v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H4a1 1 0 0 1-1-1v-4a2 2 0 0 1 2-2Zm2.1 0h9.8l-1.2-3.6a.6.6 0 0 0-.5-.4H8.8a.6.6 0 0 0-.5.4L7.1 11ZM7 15.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
					/></svg
				>
				<div>
					<strong>{carLabel}</strong>
					<span class="count muted" data-testid="compatible-count"
						>{m.finder_compatible({ n: compatible.length })}</span
					>
				</div>
			</div>
			<div class="actions">
				<button type="button" class="btn" onclick={reset}>{m.finder_change()}</button>
				<button type="button" class="btn btn-primary" onclick={locate}
					><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
						><path
							fill="currentColor"
							d="M12 2a1 1 0 0 1 1 1v1.06A8 8 0 0 1 19.94 11H21a1 1 0 1 1 0 2h-1.06A8 8 0 0 1 13 19.94V21a1 1 0 1 1-2 0v-1.06A8 8 0 0 1 4.06 13H3a1 1 0 1 1 0-2h1.06A8 8 0 0 1 11 4.06V3a1 1 0 0 1 1-1Zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"
						/></svg
					>{m.finder_use_location()}</button
				>
			</div>
			<small class="hint muted">{m.finder_or_tap()}</small>
		</div>

		<div class="maparea surface">
			<StationMap
				stations={sorted}
				bind:selectedId
				bind:userLocation
				pickLocation={true}
				fallbackText={m.map_fallback()}
			/>
			{#if selected}
				<aside class="card" data-testid="finder-card">
					<NetworkLogo slug={selected.networkSlug} name={selected.networkName} size={36} />
					<div>
						<h3><a href="/stod/{selected.slug}">{selected.name}</a></h3>
						<p class="net">{selected.networkName}</p>
						<p class="facts">
							{#if selected.price !== null}<strong class="num">{formatIsk(selected.price)}</strong>
								{selected.mode}{:else}<em>{m.price_unknown()}</em>{/if}
							{#if selected.kw !== null}
								· {m.finder_up_to({ kw: Math.round(selected.kw) })}{/if}
							{#if selected.km !== null}
								· {formatKm(selected.km)}{/if}
						</p>
					</div>
				</aside>
			{/if}
		</div>

		<ol class="results surface" data-testid="finder-results">
			{#each sorted.slice(0, 25) as s (s.id)}
				<li>
					<NetworkLogo slug={s.networkSlug} name={s.networkName} size={32} />
					<div class="r-main">
						<a href="/stod/{s.slug}">{s.name}</a>
						<span class="net">
							{s.networkName}{#if s.kw !== null}{' · '}{m.finder_up_to({
									kw: Math.round(s.kw)
								})}{/if}
						</span>
					</div>
					<div class="r-side">
						{#if s.price !== null}<strong class="num">{formatIsk(s.price)}</strong>{/if}
						{#if s.km !== null}<span class="km num">{formatKm(s.km)}</span>{/if}
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.picker {
		padding: 1.15rem;
		max-width: 36rem;
	}
	.picker h3 {
		margin-top: 0;
	}
	.search {
		position: relative;
		color: var(--muted);
	}
	.search svg {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}
	input[type='search'] {
		width: 100%;
		padding-left: 2.4rem;
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.hits {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0.25rem;
		max-height: 20rem;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.hits button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		font: inherit;
		font-size: 0.95rem;
		color: var(--text);
		cursor: pointer;
	}
	.hits button:hover {
		background: var(--accent-soft);
	}
	.fallback-plug {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		font-size: 0.9rem;
	}

	.chosen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
		padding: 0.85rem 1rem;
	}
	.car {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		flex: 1 1 14rem;
		min-width: 0;
	}
	.car svg {
		flex: none;
		padding: 0.45rem;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.car strong {
		display: block;
	}
	.count {
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.hint {
		flex: 1 0 100%;
		font-size: 0.8rem;
	}

	.maparea {
		position: relative;
		height: 55vh;
		min-height: 20rem;
		margin: 1rem 0;
		overflow: hidden;
	}
	.card {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg);
		padding: 0.8rem 1rem;
		max-width: min(22rem, calc(100% - 1.5rem));
	}
	.card h3 {
		margin: 0;
		font-size: 1rem;
	}
	.card h3 a {
		color: var(--text);
	}
	.card p {
		margin: 0.15rem 0 0;
	}
	.facts {
		font-size: 0.9rem;
	}
	.net {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
	.results li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 1rem;
		border-top: 1px solid var(--border);
	}
	.results li:first-child {
		border-top: none;
	}
	.r-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.r-main a {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.r-main a:hover {
		text-decoration: underline;
	}
	.r-side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1.3;
		white-space: nowrap;
	}
	.km {
		color: var(--muted);
		font-size: 0.82rem;
	}
</style>
