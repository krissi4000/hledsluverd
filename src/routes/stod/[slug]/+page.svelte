<script lang="ts">
	import Chart from 'chart.js/auto';
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import { ageParts, formatDate, formatIsk, formatNumber, isStale } from '$lib/format';

	let { data } = $props();
	let canvas = $state<HTMLCanvasElement>();

	const st = $derived(data.station);

	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min'
			? m.age_min({ n: p.n })
			: p.unit === 'h'
				? m.age_h({ n: p.n })
				: m.age_d({ n: p.n });
	}

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
					borderColor: '#2e7d32',
					backgroundColor: '#2e7d32',
					pointRadius: 2
				}))
			},
			options: {
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

<svelte:head>
	<title>{st.name} — {m.site_title()}</title>
	<meta name="description" content="{st.name} · {st.network.name}" />
</svelte:head>

<article>
	<h2>{st.name}</h2>
	<p class="meta">
		{st.network.name}{#if st.address}
			· {st.address}{/if}
		·
		<a
			href="https://www.google.com/maps/dir/?api=1&destination={st.lat},{st.lng}"
			rel="noopener external">{m.station_directions()}</a
		>
	</p>

	<div class="cols">
		<section aria-label={m.station_prices()}>
			<h3>{m.station_prices()}</h3>
			{#each st.prices as p (p.mode)}
				<p class="price-row" data-testid="station-price">
					<span class="mode">{p.mode === 'DC' ? m.mode_label_dc() : m.mode_label_ac()}</span>
					<strong>{formatIsk(p.priceIskPerKwh)}</strong>
					{#if p.minuteFeeIsk}<small
							>{p.minuteFeeAfterMin
								? m.minute_fee_after({
										fee: formatNumber(p.minuteFeeIsk),
										min: p.minuteFeeAfterMin
									})
								: m.minute_fee({ fee: formatNumber(p.minuteFeeIsk) })}</small
						>{/if}
					<small class="verified" class:stale={isStale(p.verifiedAt)}
						>{m.verified_on({ date: formatDate(p.verifiedAt) })}</small
					>
				</p>
			{:else}
				<p><em>{m.price_unknown()}</em></p>
			{/each}

			<h3>{m.station_availability()}</h3>
			<p data-testid="station-availability">
				{#if st.availability && st.availability.freeCount !== null && st.availability.totalCount !== null}
					<strong>{st.availability.freeCount}/{st.availability.totalCount}</strong>
					<small class="verified">{age(st.availability.fetchedAt)}</small>
				{:else}—{/if}
			</p>

			<h3>{m.th_connectors()}</h3>
			<p>
				{#each st.connectors as c}
					<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
				{/each}
			</p>
		</section>

		<div class="minimap" data-testid="station-map">
			<StationMap
				stations={[
					{ id: st.id, lat: st.lat, lng: st.lng, price: st.prices[0]?.priceIskPerKwh ?? null }
				]}
				center={[st.lng, st.lat]}
				zoom={12}
				fallbackText={m.map_fallback()}
			/>
		</div>
	</div>

	{#if data.series.length > 0}
		<section aria-label={m.station_trend({ network: st.network.name })}>
			<h3>{m.station_trend({ network: st.network.name })}</h3>
			<div class="chart"><canvas bind:this={canvas} data-testid="station-trend"></canvas></div>
		</section>
	{/if}
</article>

<style>
	.meta {
		opacity: 0.8;
	}
	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		align-items: start;
	}
	@media (max-width: 640px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	.minimap {
		height: 20rem;
	}
	.price-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.mode {
		opacity: 0.7;
		min-width: 9rem;
	}
	.chip {
		display: inline-block;
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		padding: 0 0.5rem;
		margin: 0 0.2rem 0.2rem 0;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.verified {
		opacity: 0.6;
		font-size: 0.75rem;
	}
	.verified.stale {
		color: #b26a00;
		opacity: 1;
	}
	.chart {
		position: relative;
		min-height: 16rem;
		max-width: 44rem;
	}
</style>
