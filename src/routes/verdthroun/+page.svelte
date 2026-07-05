<script lang="ts">
	import Chart from 'chart.js/auto';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatIsk } from '$lib/format';

	let { data } = $props();
	let canvas = $state<HTMLCanvasElement | undefined>();

	const PALETTE = ['#2e7d32', '#1565c0', '#e65100', '#6a1b9a', '#c62828', '#00838f'];

	$effect(() => {
		if (!canvas || data.series.length === 0) return;
		const chart = new Chart(canvas, {
			type: 'line',
			data: {
				datasets: data.series.map((s, i) => ({
					label: s.networkName,
					// extend each stepped line to "now" so current prices read at the right edge
					data: [...s.points, { t: data.now, y: s.points[s.points.length - 1].y }].map((p) => ({
						x: p.t,
						y: p.y
					})),
					stepped: true,
					borderColor: PALETTE[i % PALETTE.length],
					backgroundColor: PALETTE[i % PALETTE.length],
					pointRadius: 2
				}))
			},
			options: {
				scales: {
					x: {
						type: 'linear',
						ticks: {
							maxTicksLimit: 8,
							callback: (v) => formatDate(new Date(Number(v)))
						}
					},
					y: { title: { display: true, text: 'kr/kWh' } }
				},
				interaction: { mode: 'nearest', intersect: false }
			}
		});
		return () => chart.destroy();
	});
</script>

<svelte:head>
	<title>{m.trends_title()} — {m.site_title()}</title>
	<meta name="description" content={m.trends_note()} />
</svelte:head>

<section aria-label={m.trends_title()}>
	<h2>{m.trends_title()}</h2>
	<p class="note">{m.trends_note()}</p>

	<nav class="filters">
		<span class="group" role="group" aria-label={m.filter_mode()}>
			<a href="/verdthroun" class:active={data.mode === 'DC'}>{m.mode_dc()}</a>
			<a href="/verdthroun?afl=AC" class:active={data.mode === 'AC'}>{m.mode_ac()}</a>
		</span>
	</nav>

	{#if data.series.length === 0}
		<p class="empty">{m.trends_no_data()}</p>
	{:else}
		<div class="chart"><canvas bind:this={canvas} data-testid="trend-chart"></canvas></div>
		<noscript>
			<table>
				<thead>
					<tr><th>{m.th_network()}</th><th>{m.trends_current()}</th><th></th></tr>
				</thead>
				<tbody>
					{#each data.series as s (s.networkSlug)}
						{@const last = s.points[s.points.length - 1]}
						<tr data-testid="trend-row">
							<td>{s.networkName}</td>
							<td>{formatIsk(last.y)}</td>
							<td>{m.trends_since({ date: formatDate(new Date(last.t)) })}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</noscript>
	{/if}
</section>

<style>
	.note {
		opacity: 0.7;
		font-size: 0.9rem;
	}
	.filters {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.group {
		display: inline-flex;
		gap: 0.25rem;
	}
	.group a {
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		padding: 0.15rem 0.7rem;
		text-decoration: none;
		color: inherit;
		font-size: 0.9rem;
	}
	.group a.active {
		background: var(--accent, #2e7d32);
		border-color: var(--accent, #2e7d32);
		color: #fff;
	}
	.chart {
		position: relative;
		min-height: 20rem;
	}
	.empty {
		opacity: 0.7;
		padding: 1rem 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border, #e2e2e2);
	}
</style>
