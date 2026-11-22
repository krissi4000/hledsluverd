<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { formatIsk, formatNumber, isStale } from '$lib/format';
	import { updatedText, verifiedText } from '$lib/age';
	import { minuteFeeText } from '$lib/fees';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import ListControls from '$lib/components/ListControls.svelte';
	import OtherPrice from '$lib/components/OtherPrice.svelte';
	import UnknownStalls from '$lib/components/UnknownStalls.svelte';
	import { ownBrandPriceOnly } from '$lib/networks';
	import { unknownStalls } from '$lib/availability';
	import { NETWORK_PARAM, toggleParam } from '$lib/filter-params';
	import { stationDisplayName } from '$lib/station-name';
	import { withParams } from '$lib/url';
	import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';
	import type { StationRow } from '$lib/server/db/queries';

	// Every station, cheapest first (or by what the chosen car pays). One compact row each,
	// the whole row a link to the station; details live on the station's page.
	let {
		stations,
		mode,
		connector,
		networks,
		networkDefaults,
		networkOptions,
		hidden = [],
		car,
		search
	}: {
		/** carKw: the speed the chosen car gets at the station; effectivePrice: what it pays
		 * per kWh there with per-minute fees (set when a car is chosen) */
		stations: (StationRow & {
			carKw?: number | null;
			effectivePrice?: number | null;
			effectiveApprox?: boolean;
		})[];
		mode: 'AC' | 'DC';
		connector: string | null;
		/** slugs of the networks shown */
		networks: string[];
		networkDefaults: string[];
		networkOptions: { slug: string; name: string }[];
		/** networks toggled off, with how many stations each hides */
		hidden?: { slug: string; name: string; count: number }[];
		car: { make: string; plug: ConnectorType | null } | null;
		search: string;
	} = $props();

	/** "CCS2, CHAdeMO · 400 kW": the plugs for the mode shown, and the fastest of them */
	function plugs(s: StationRow & { carKw?: number | null }): string {
		if (car?.plug) {
			const kw = s.carKw ? m.finder_up_to({ kw: Math.round(s.carKw) }) : null;
			return [car.plug, kw].filter(Boolean).join(' · ');
		}
		const ofMode = s.connectors.filter((c) => (mode === 'AC') === (c.type === 'Type2'));
		const list = ofMode.length > 0 ? ofMode : s.connectors;
		if (list.length === 0) return '';
		// the same order on every row, so the eye can run down the list
		const types = CONNECTOR_TYPES.filter((t) => list.some((c) => c.type === t)).join(', ');
		const kw = Math.max(...list.map((c) => c.powerKw));
		return `${types} · ${formatNumber(kw)} kW`;
	}

	const slugs = $derived(networkOptions.map((o) => o.slug));
</script>

<section class="list" aria-labelledby="stations-title">
	<header class="head">
		<h2 id="stations-title">
			{m.stations_title()} <span class="count num">{stations.length}</span>
		</h2>
		{#if hidden.length > 0}
			<!-- the list is never "all" while a toggle hides some: say what and how many -->
			<small class="hidden-nets" data-testid="hidden-networks"
				>{m.stations_hidden()}
				{#each hidden as h, i (h.slug)}{#if i > 0},
					{/if}<a
						href={withParams(page.url, {
							[NETWORK_PARAM]: toggleParam(networks, h.slug, slugs, networkDefaults)
						})}
						title={m.stations_hidden_show({ name: h.name })}
						data-sveltekit-noscroll
						data-sveltekit-keepfocus>{h.name} ({h.count})</a
					>{/each}</small
			>
		{/if}
	</header>

	<ListControls {mode} {connector} {networks} {networkDefaults} {networkOptions} {search} />

	{#if car}
		<p class="note" data-testid="estimate-note">{m.sorted_by_effective()}</p>
	{/if}

	{#if stations.length === 0}
		<p class="empty surface">{m.no_results()}</p>
	{:else}
		<div class="rows surface">
			<div class="row legend-row" aria-hidden="true">
				<span></span>
				<span>{m.th_station()}</span>
				<span class="avail">{m.th_free()}</span>
				<span class="price">{m.station_prices()}</span>
			</div>
			<ol>
				{#each stations as s (s.slug)}
					{@const stale = s.verifiedAt !== null && isStale(s.verifiedAt)}
					{@const known = s.freeCount !== null && s.totalCount !== null}
					<li class="row" data-testid="station-row" data-network={s.networkSlug}>
						<NetworkLogo slug={s.networkSlug} name={s.networkName} size={32} />
						<div class="main">
							<a class="name" href="/stod/{s.slug}">{stationDisplayName(s.name, s.networkName)}</a>
							<span class="meta"
								>{s.networkName}{#if plugs(s)}{' · '}<span class:car-kw={car}>{plugs(s)}</span
									>{/if}</span
							>
						</div>
						<div class="avail" class:unknown={!known}>
							{#if s.underConstruction}{:else if known}
								<span class="free num" class:has-free={s.freeCount! > 0} data-testid="free-count"
									>{s.freeCount}/{s.totalCount}</span
								><UnknownStalls
									unknown={unknownStalls(s.stallCount, s.totalCount!)}
									total={s.totalCount!}
								/>
								{#if s.availabilityFetchedAt}<small>{updatedText(s.availabilityFetchedAt)}</small
									>{/if}
							{:else}<span class="muted" title={m.avail_unknown_title()}>—</span>{/if}
						</div>
						<div class="price">
							{#if s.underConstruction}
								<span
									class="badge badge-muted"
									title={m.under_construction_note()}
									data-testid="under-construction">{m.under_construction()}</span
								>
							{:else if s.price !== null}
								<span class="amount" class:stale
									><strong class="num" data-testid="price">{formatIsk(s.price)}</strong><span
										class="per">{m.price_per_kwh()}</span
									></span
								>
								<!-- per-minute fees in the site's one wording ("+ 64 kr/mín eftir 1 klst") -->
								{#if s.minuteFeeIsk}<small
										>{minuteFeeText(s.minuteFeeIsk, s.minuteFeeAfterMin)}</small
									>{/if}
								<!-- what the chosen car pays with per-minute fees; only when it differs -->
								{#if s.effectivePrice != null && Math.abs(s.effectivePrice - s.price) >= 0.05}<small
										class="effective"
										class:stale
										data-testid="effective-price"
										>{s.effectiveApprox ? '≈ ' : ''}{m.effective_price({
											price: formatNumber(s.effectivePrice)
										})}</small
									>{/if}
								{#if stale && s.verifiedAt}<small class="verified stale"
										>{verifiedText(s.verifiedAt)}</small
									>{/if}
								{#if ownBrandPriceOnly(s.networkSlug)}<small title={m.tesla_price_only_title()}
										>{m.tesla_price_only()}</small
									>{/if}
							{:else}
								<span class="unknown-price">{m.price_unknown()}</span>
							{/if}
							<!-- the station's other kind of charging (slow beside fast, or fast beside slow) -->
							{#if s.other}<OtherPrice other={s.other} />{/if}
						</div>
					</li>
				{/each}
			</ol>
		</div>
		<p class="legend" data-testid="avail-legend">{m.avail_legend()}</p>
	{/if}
</section>

<style>
	.list {
		margin-top: 2rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 1rem;
		margin-bottom: 0.6rem;
	}
	h2 {
		margin: 0;
	}
	.count {
		margin-left: 0.25rem;
		color: var(--muted);
		font-size: 0.9rem;
		font-weight: 600;
	}
	.hidden-nets {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.hidden-nets a {
		color: inherit;
	}
	.note {
		margin: -0.25rem 0 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.empty {
		padding: 2rem 1rem;
		color: var(--muted);
		text-align: center;
	}

	.rows {
		overflow: hidden;
	}
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		position: relative;
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) 8.5rem 10rem;
		align-items: center;
		gap: 0 0.85rem;
		padding: 0.7rem 1rem;
		border-top: 1px solid var(--border);
	}
	li.row:hover {
		background: #fafbfa;
	}
	.legend-row {
		padding-top: 0.5rem;
		padding-bottom: 0.5rem;
		border-top: 0;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
	}
	.name {
		color: var(--text);
		font-weight: 650;
		text-decoration: none;
	}
	/* the whole row is the link to the station */
	.name::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	li.row:hover .name {
		color: var(--accent-text);
	}
	.meta {
		color: var(--muted);
		font-size: 0.82rem;
	}
	.car-kw {
		color: var(--accent-text);
		font-weight: 600;
	}

	.avail {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		text-align: right;
		line-height: 1.3;
	}
	.avail small {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.free {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.875rem;
		font-weight: 650;
	}
	.free.has-free {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	.price {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		text-align: right;
		line-height: 1.3;
	}
	.amount {
		white-space: nowrap;
	}
	.amount strong {
		font-size: 1.1rem;
		font-weight: 700;
	}
	.per {
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 600;
	}
	/* unverified for 30+ days: the price itself turns amber */
	.amount.stale,
	.amount.stale .per {
		color: var(--stale);
	}
	.price small {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.price small.effective {
		color: var(--accent-text);
		font-weight: 650;
	}
	.price small.stale {
		color: var(--stale);
	}
	.unknown-price {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.legend {
		margin: 0.5rem 0 0;
		color: var(--muted);
		font-size: 0.78rem;
	}

	/* phones: two lines a row; live availability tucks under the price, an unknown one
	   (most stations) shows nothing rather than a column of dashes */
	@media (max-width: 640px) {
		.rows {
			margin: 0 -0.25rem;
		}
		.row {
			grid-template-columns: 2rem minmax(0, 1fr) auto;
			grid-template-areas:
				'logo main price'
				'logo avail avail';
			gap: 0 0.7rem;
			padding: 0.65rem 0.85rem;
		}
		.row > :global(:first-child) {
			grid-area: logo;
		}
		.main {
			grid-area: main;
		}
		.price {
			grid-area: price;
		}
		.avail {
			grid-area: avail;
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: flex-start;
			align-items: baseline;
			gap: 0 0.35rem;
			margin-top: 0.25rem;
			text-align: left;
		}
		/* shown availability always carries its age, on phones too */
		.avail.unknown,
		.legend-row,
		.legend {
			display: none;
		}
		/* fees and the other kind of charging wrap ("+ 64 kr/mín / eftir 1 klst") rather
		   than widen the price column and squeeze the station's name */
		.price small,
		.price :global(.other) {
			max-width: 6rem;
		}
	}
</style>
