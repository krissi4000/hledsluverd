<script lang="ts">
	import Chart from 'chart.js/auto';
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import UnknownStalls from '$lib/components/UnknownStalls.svelte';
	import { unknownStalls } from '$lib/availability';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import DirectionsLink from '$lib/components/DirectionsLink.svelte';
	import ReportForm from '$lib/components/ReportForm.svelte';
	import { networkColor, ownBrandPriceOnly } from '$lib/networks';
	import { formatDate, formatIsk, isStale } from '$lib/format';
	import { updatedText, verifiedText } from '$lib/age';
	import { minuteFeeText } from '$lib/fees';
	import { stationDisplayName } from '$lib/station-name';

	let { data, form } = $props();
	let canvas = $state<HTMLCanvasElement>();

	const st = $derived(data.station);
	const avail = $derived(
		st.availability && st.availability.freeCount !== null && st.availability.totalCount !== null
			? {
					free: st.availability.freeCount,
					total: st.availability.totalCount,
					at: st.availability.fetchedAt
				}
			: null
	);

	$effect(() => {
		if (!canvas || data.series.length === 0) return;
		const chart = new Chart(canvas, {
			type: 'line',
			data: {
				datasets: data.series.map((s) => ({
					label: s.networkName,
					data: [...s.points, { t: data.now, y: s.points[s.points.length - 1].y }].map((p) => ({
						x: p.t,
						y: p.y
					})),
					stepped: true,
					borderColor: networkColor(st.network.slug),
					backgroundColor: networkColor(st.network.slug),
					borderWidth: 2.5,
					pointRadius: 2
				}))
			},
			options: {
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: {
					x: {
						type: 'linear',
						ticks: { maxTicksLimit: 6, callback: (v) => formatDate(new Date(Number(v))) }
					},
					y: { title: { display: true, text: 'kr/kWh' } }
				}
			}
		});
		return () => chart.destroy();
	});
</script>

<article class="station">
	<header class="head">
		<NetworkLogo slug={st.network.slug} name={st.network.name} size={48} />
		<div class="title">
			<h1>
				{stationDisplayName(st.name, st.network.name)}{#if st.underConstruction}
					<span class="badge badge-muted" data-testid="under-construction"
						>{m.under_construction()}</span
					>{/if}
			</h1>
			<p class="meta">
				{#if st.network.websiteUrl}<a href={st.network.websiteUrl} rel="noopener external"
						>{st.network.name}</a
					>{:else}{st.network.name}{/if}{#if st.address}{' '}<span aria-hidden="true">·</span>
					{st.address}{/if}
			</p>
		</div>
		<DirectionsLink lat={st.lat} lng={st.lng} class="go" />
	</header>

	<div class="cols">
		<div class="facts surface">
			<section class="prices" aria-label={m.station_prices()}>
				{#each st.prices as p (p.mode)}
					<div class="price-row" data-testid="station-price">
						<span class="mode">{p.mode === 'DC' ? m.mode_label_dc() : m.mode_label_ac()}</span>
						<span class="amount" class:stale={isStale(p.verifiedAt)}>
							<strong class="num">{formatIsk(p.priceIskPerKwh)}</strong><span class="unit"
								>{m.price_per_kwh()}</span
							>
						</span>
						{#if p.minuteFeeIsk}<small class="line"
								>{minuteFeeText(p.minuteFeeIsk, p.minuteFeeAfterMin)}</small
							>{/if}
						{#if ownBrandPriceOnly(st.network.slug)}<small
								class="line muted"
								title={m.tesla_price_only_title()}>{m.tesla_price_only()}</small
							>{/if}
						<small class="line verified" class:stale={isStale(p.verifiedAt)}
							>{verifiedText(p.verifiedAt)}</small
						>
					</div>
				{:else}
					{#if st.underConstruction}
						<p class="muted none" data-testid="under-construction-note">
							{m.under_construction_note()}
						</p>
					{:else}
						<p class="muted none">{m.price_unknown()}</p>
					{/if}
				{/each}
				{#if st.hostPriced}
					<p class="host-priced" data-testid="station-host-priced">
						{m.station_host_priced({ network: st.network.name })}
					</p>
				{/if}
			</section>

			<dl class="details">
				<div>
					<dt>{m.station_availability()}</dt>
					<dd class="avail" data-testid="station-availability">
						{#if avail}
							<strong class="num">{avail.free}/{avail.total}</strong><UnknownStalls
								unknown={unknownStalls(st.stallCount, avail.total)}
								total={avail.total}
							/>
							<small class="verified">{updatedText(avail.at)}</small>
						{:else}<span title={m.avail_unknown_title()}>—</span>{/if}
					</dd>
				</div>
				<div>
					<dt>{m.th_connectors()}</dt>
					<dd class="chips">
						{#each st.connectors as c, ci (ci)}
							<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
						{/each}
					</dd>
				</div>
			</dl>
		</div>

		<div class="minimap surface" data-testid="station-map">
			<StationMap
				stations={[
					{
						id: st.id,
						lat: st.lat,
						lng: st.lng,
						price: st.prices[0]?.priceIskPerKwh ?? null,
						networkSlug: st.network.slug,
						networkName: st.network.name,
						name: st.name
					}
				]}
				center={[st.lng, st.lat]}
				zoom={12}
				fallbackText={m.map_fallback()}
			/>
		</div>
	</div>

	{#if data.series.length > 0}
		<section class="trend surface" aria-labelledby="trend-title">
			<h2 id="trend-title">{m.station_trend({ network: st.network.name })}</h2>
			<div class="chart"><canvas bind:this={canvas} data-testid="station-trend"></canvas></div>
		</section>
	{/if}

	<ReportForm result={form} />
</article>

<style>
	.head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		margin-bottom: 1.25rem;
	}
	.title {
		flex: 1 1 14rem;
		min-width: 0;
	}
	h1 {
		margin: 0;
	}
	h1 .badge {
		margin-left: 0.4rem;
		vertical-align: middle;
	}
	.meta {
		margin: 0.2rem 0 0;
		color: var(--muted);
	}
	.meta a {
		color: inherit;
		font-weight: 600;
	}
	/* phones: the way there gets the full width under the name */
	@media (max-width: 640px) {
		.head :global(.go) {
			flex: 1 0 100%;
		}
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
		align-items: stretch;
	}
	@media (max-width: 760px) {
		.cols {
			grid-template-columns: 1fr;
		}
		.minimap {
			height: 16rem;
		}
	}

	.facts {
		display: flex;
		flex-direction: column;
	}
	.prices {
		padding: 0.4rem 1.1rem;
	}
	.price-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: baseline;
		gap: 0 1rem;
		padding: 0.7rem 0;
	}
	.price-row + .price-row {
		border-top: 1px solid var(--border);
	}
	.mode {
		font-weight: 600;
	}
	.amount {
		white-space: nowrap;
	}
	.amount strong {
		font-size: 1.5rem;
		font-weight: 750;
		letter-spacing: -0.02em;
	}
	.unit {
		margin-left: 0.15rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	/* unverified for 30+ days: amber, price and all */
	.amount.stale,
	.amount.stale .unit {
		color: var(--stale);
	}
	.line {
		grid-column: 1 / -1;
		font-size: 0.82rem;
	}
	.none {
		margin: 0.7rem 0;
	}
	.host-priced {
		margin: 0 0 0.7rem;
		color: var(--muted);
		font-size: 0.82rem;
	}

	.details {
		margin: 0;
		padding: 0.2rem 1.1rem 0.6rem;
		border-top: 1px solid var(--border);
	}
	.details > div {
		display: grid;
		grid-template-columns: 9rem minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0.6rem 0;
	}
	.details > div + div {
		border-top: 1px solid var(--border);
	}
	dt {
		color: var(--muted);
		font-size: 0.875rem;
	}
	dd {
		margin: 0;
	}
	.avail strong {
		font-size: 1.15rem;
		font-weight: 700;
	}
	.chips {
		line-height: 1.9;
	}

	.minimap {
		min-height: 18rem;
		overflow: hidden;
	}

	.trend {
		margin-top: 1rem;
		padding: 1rem 1.1rem;
	}
	.trend h2 {
		font-size: 1rem;
	}
	.chart {
		position: relative;
		height: 15rem;
	}
</style>
