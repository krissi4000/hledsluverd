<script lang="ts">
	import Chart from 'chart.js/auto';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatIsk } from '$lib/format';
	import { networkColor } from '$lib/networks';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';

	let { data } = $props();
	let canvas = $state<HTMLCanvasElement | undefined>();

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
					borderColor: networkColor(s.networkSlug, i),
					backgroundColor: networkColor(s.networkSlug, i),
					borderWidth: 2.5,
					pointRadius: 2
				}))
			},
			options: {
				maintainAspectRatio: false,
				plugins: {
					legend: { position: 'bottom', labels: { usePointStyle: true, boxHeight: 8 } }
				},
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
		<span class="pills" role="group" aria-label={m.filter_mode()}>
			<a
				class="pill"
				href="/verdthroun"
				class:active={data.mode === 'DC'}
				aria-current={data.mode === 'DC' ? 'page' : undefined}>{m.mode_dc()}</a
			>
			<a
				class="pill"
				href="/verdthroun?afl=AC"
				class:active={data.mode === 'AC'}
				aria-current={data.mode === 'AC' ? 'page' : undefined}>{m.mode_ac()}</a
			>
		</span>
	</nav>

	{#if data.series.length === 0}
		<p class="empty surface">{m.trends_no_data()}</p>
	{:else}
		<div class="panel surface">
			<div class="chart"><canvas bind:this={canvas} data-testid="trend-chart"></canvas></div>
		</div>
		<noscript>
			<table class="surface">
				<thead>
					<tr><th>{m.th_network()}</th><th>{m.trends_current()}</th><th></th></tr>
				</thead>
				<tbody>
					{#each data.series as s (s.networkSlug)}
						{@const last = s.points[s.points.length - 1]}
						<tr data-testid="trend-row">
							<td
								><span class="netcell"
									><NetworkLogo
										slug={s.networkSlug}
										name={s.networkName}
										size={24}
									/>{s.networkName}</span
								></td
							>
							<td class="num">{formatIsk(last.y)}</td>
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
		color: var(--muted);
		font-size: 0.9rem;
		margin-top: -0.25rem;
		max-width: 44rem;
	}
	.filters {
		margin-bottom: 1rem;
	}
	.panel {
		padding: 1rem;
	}
	.chart {
		position: relative;
		height: min(26rem, 60vh);
		min-height: 18rem;
	}
	.empty {
		color: var(--muted);
		padding: 2rem 1rem;
		text-align: center;
	}
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		overflow: hidden;
		margin-top: 1rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	th {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--muted);
		background: var(--surface-2);
	}
	.netcell {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
	}
</style>
