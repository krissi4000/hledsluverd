<script lang="ts">
	import Chart from 'chart.js/auto';
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import { networkColor } from '$lib/networks';
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

<svelte:head>
	<title>{st.name} — {m.site_title()}</title>
	<meta name="description" content="{st.name} · {st.network.name}" />
</svelte:head>

<article>
	<header class="head">
		<NetworkLogo slug={st.network.slug} name={st.network.name} size={56} />
		<div class="title">
			<h2>{st.name}</h2>
			<p class="meta">
				{#if st.network.websiteUrl}<a href={st.network.websiteUrl} rel="noopener external"
						>{st.network.name}</a
					>{:else}{st.network.name}{/if}{#if st.address}
					<span class="dot" aria-hidden="true">·</span> {st.address}{/if}
			</p>
		</div>
		<a
			class="btn btn-primary directions"
			href="https://www.google.com/maps/dir/?api=1&destination={st.lat},{st.lng}"
			rel="noopener external"
		>
			<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
				><path
					fill="currentColor"
					d="M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4ZM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5Z"
				/></svg
			>
			{m.station_directions()}
		</a>
	</header>

	<div class="cols">
		<section class="info" aria-label={m.station_prices()}>
			<div class="panel surface">
				<h3>{m.station_prices()}</h3>
				{#each st.prices as p (p.mode)}
					<div class="price-row" data-testid="station-price">
						<span class="mode">{p.mode === 'DC' ? m.mode_label_dc() : m.mode_label_ac()}</span>
						<span class="amount">
							<strong class="num">{formatIsk(p.priceIskPerKwh)}</strong><span class="unit"
								>/kWh</span
							>
						</span>
						{#if p.minuteFeeIsk}<small class="fee"
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
					</div>
				{:else}
					<p class="muted"><em>{m.price_unknown()}</em></p>
				{/each}
			</div>

			<div class="panel surface split">
				<div>
					<h3>{m.station_availability()}</h3>
					<p class="avail" data-testid="station-availability">
						{#if st.availability && st.availability.freeCount !== null && st.availability.totalCount !== null}
							<strong class="num">{st.availability.freeCount}/{st.availability.totalCount}</strong>
							<small class="verified">{age(st.availability.fetchedAt)}</small>
						{:else}—{/if}
					</p>
				</div>
				<div>
					<h3>{m.th_connectors()}</h3>
					<p class="chips">
						{#each st.connectors as c, ci (ci)}
							<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
						{/each}
					</p>
				</div>
			</div>
		</section>

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
		<section class="panel surface trend" aria-label={m.station_trend({ network: st.network.name })}>
			<h3>{m.station_trend({ network: st.network.name })}</h3>
			<div class="chart"><canvas bind:this={canvas} data-testid="station-trend"></canvas></div>
		</section>
	{/if}
</article>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		margin: 0.5rem 0 1.25rem;
	}
	.title {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.title h2 {
		margin: 0;
		font-size: 1.6rem;
		line-height: 1.2;
	}
	.meta {
		margin: 0.2rem 0 0;
		color: var(--muted);
	}
	.meta a {
		color: inherit;
		font-weight: 600;
	}
	.dot {
		margin: 0 0.3rem;
	}

	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		align-items: stretch;
	}
	@media (max-width: 760px) {
		.cols {
			grid-template-columns: 1fr;
		}
		.directions {
			flex: 1 0 100%;
		}
		.minimap {
			height: 18rem;
		}
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.panel {
		padding: 1rem 1.15rem;
	}
	.panel h3 {
		margin: 0 0 0.6rem;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.split {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1.5rem;
	}
	.split p {
		margin: 0;
	}

	.price-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: baseline;
		gap: 0.1rem 1rem;
		padding: 0.6rem 0;
		border-top: 1px solid var(--border);
	}
	.price-row:first-of-type {
		border-top: none;
		padding-top: 0;
	}
	.mode {
		font-weight: 600;
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
	.fee,
	.price-row .verified {
		grid-column: 1 / -1;
		font-size: 0.8rem;
	}

	.avail strong {
		font-size: 1.5rem;
		font-weight: 750;
	}
	.chips {
		line-height: 1.9;
	}

	.minimap {
		min-height: 20rem;
		overflow: hidden;
	}

	.trend {
		margin-top: 1rem;
	}
	.chart {
		position: relative;
		height: 16rem;
	}
</style>
