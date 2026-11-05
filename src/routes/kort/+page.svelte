<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import DirectionsLink from '$lib/components/DirectionsLink.svelte';
	import { ageParts, formatIsk } from '$lib/format';
	import { ownBrandPriceOnly } from '$lib/networks';
	import NetworkToggles from '$lib/components/NetworkToggles.svelte';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';
	import UnknownStalls from '$lib/components/UnknownStalls.svelte';
	import { unknownStalls } from '$lib/availability';
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

	function href(next: Record<string, string | null>): string {
		const u = new URL(page.url);
		for (const [k, v] of Object.entries(next)) {
			if (v === null) u.searchParams.delete(k);
			else u.searchParams.set(k, v);
		}
		return u.pathname + u.search;
	}

	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min'
			? m.age_min({ n: p.n })
			: p.unit === 'h'
				? m.age_h({ n: p.n })
				: m.age_d({ n: p.n });
	}
</script>

<svelte:head>
	<title>{m.map_title()} — {m.site_title()}</title>
	<meta name="description" content={m.map_title()} />
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') filtersOpen = false;
	}}
/>

<section aria-label={m.map_title()} class="wrap">
	<h2 class="visually-hidden">{m.map_title()}</h2>
	<noscript><p class="js-note">{m.map_js()}</p></noscript>
	<div class="maparea" class:has-card={selected}>
		<StationMap stations={visible} bind:selectedId fallbackText={m.map_fallback()} />

		<div class="filter-ctl" class:open={filtersOpen}>
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
						<h3>{m.map_filters()}</h3>
						{#if activeFilters > 0}
							<a
								class="filter-reset"
								href={href({ [NETWORK_PARAM]: null, afl: null, tengi: null })}
								data-testid="map-filters-reset">{m.filter_reset()}</a
							>
						{:else}
							<span class="filter-reset" aria-disabled="true">{m.filter_reset()}</span>
						{/if}
					</div>
					<div class="panel-row">
						<span class="filter-label" aria-hidden="true">{m.filter_mode()}</span>
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
					<div class="panel-row">
						<span class="filter-label" aria-hidden="true">{m.th_connectors()}</span>
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
					<div class="panel-row">
						<span class="filter-label" aria-hidden="true">{m.th_network()}</span>
						<NetworkToggles
							options={networkOptions}
							shown={networks}
							defaults={networkDefaults}
							href={(v) => href({ [NETWORK_PARAM]: v })}
							reset={false}
						/>
					</div>
				</div>
			{/if}
			<button
				type="button"
				class="filter-btn"
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
				{m.map_filters()}
				{#if activeFilters > 0}<span
						class="badge"
						title={m.map_filters_active({ n: activeFilters })}>{activeFilters}</span
					>{/if}
			</button>
		</div>
		{#if selected}
			<aside class="card" data-testid="map-card">
				<div class="card-head">
					<NetworkLogo slug={selected.networkSlug} name={selected.networkName} size={40} />
					<div class="card-title">
						<h3><a href="/stod/{selected.slug}">{selected.name}</a></h3>
						<p class="net">{selected.networkName}</p>
					</div>
					<button
						type="button"
						class="close"
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
				<div class="stats">
					<div>
						<span class="label">{m.th_price()}</span>
						{#if selected.price !== null}
							<strong class="num">{formatIsk(selected.price)}</strong>
							<span class="mode">{selected.mode}</span>
							{#if ownBrandPriceOnly(selected.networkSlug)}<small
									class="brand-only"
									title={m.tesla_price_only_title()}>{m.tesla_price_only()}</small
								>{/if}
						{:else}
							<em class="muted">{m.price_unknown()}</em>
						{/if}
					</div>
					<div data-testid="card-availability">
						<span class="label">{m.th_free()}</span>
						{#if selected.freeCount !== null && selected.totalCount !== null}
							<strong class="num">{selected.freeCount}/{selected.totalCount}</strong><UnknownStalls
								unknown={unknownStalls(selected.stallCount, selected.totalCount)}
								total={selected.totalCount}
							/>
							{#if selected.availabilityFetchedAt}<small class="muted"
									>{age(selected.availabilityFetchedAt)}</small
								>{/if}
						{:else}—{/if}
					</div>
				</div>
				<p class="chips">
					{#each selected.connectors as c, ci (ci)}
						<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
					{/each}
				</p>
				<a class="btn btn-primary more" href="/stod/{selected.slug}">{m.map_details()} →</a>
				<DirectionsLink lat={selected.lat} lng={selected.lng} class="more" />
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
	.card {
		position: absolute;
		left: 1rem;
		bottom: 1.5rem;
		z-index: 10;
		width: min(22rem, calc(100% - 2rem));
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 1rem;
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
	.card h3 {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.25;
	}
	.card h3 a {
		color: var(--text);
		text-decoration: none;
	}
	.card h3 a:hover {
		text-decoration: underline;
	}
	.net {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.close {
		align-self: flex-start;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		margin: -0.25rem -0.25rem 0 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-2);
		color: var(--text);
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
	.stats strong {
		font-size: 1.2rem;
		font-weight: 750;
	}
	.label {
		display: block;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.brand-only {
		display: block;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.mode {
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
	}
	.stats small {
		display: block;
		font-size: 0.72rem;
	}
	.chips {
		margin: 0 0 0.75rem;
	}
	.card :global(.more) {
		width: 100%;
	}
	.card :global(.more + .more) {
		margin-top: 0.5rem;
	}
	.js-note {
		padding: 1rem;
	}

	/* bottom right, above MapLibre's attribution line */
	.filter-ctl {
		position: absolute;
		right: 0.75rem;
		bottom: 2.6rem;
		z-index: 11;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
	}
	.filter-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.5rem;
		padding: 0 1rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		font: inherit;
		font-size: 0.9rem;
		font-weight: 650;
		cursor: pointer;
	}
	.filter-btn:hover,
	.open .filter-btn {
		border-color: var(--accent);
		color: var(--accent-text);
	}
	.badge {
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
	}
	.panel-head h3 {
		margin: 0;
		font-size: 1rem;
	}
	.panel-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	/* the shared label has a fixed width as a flex basis, which would be a height here */
	.panel-row .filter-label {
		flex: none;
	}

	@media (max-width: 640px) {
		/* one bottom overlay at a time on phones: the station card wins */
		.has-card .filter-ctl {
			display: none;
		}
		/* clear the attribution, which wraps to two lines until the map is first moved */
		.filter-ctl {
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
