<script lang="ts">
	// How a nearby card's full charge adds up, as a static picture: the cost building up
	// over the charge (electricity, plus the per-minute fee once it starts), what each part
	// costs, and why the charge takes as long as it does. Deliberately not interactive: it
	// explains the estimate, it isn't a tool. Rendered only when the visitor opens a card.
	import * as m from '$lib/paraglide/messages';
	import type { FullChargeEstimate, FullChargeSpeed } from '$lib/ev';
	import { formatEstimateIsk, formatNumber } from '$lib/format';

	let {
		est,
		speed,
		duration
	}: {
		est: FullChargeEstimate;
		speed: FullChargeSpeed;
		/** "59 mín" / "2 klst", the same wording as the card */
		duration: (min: number) => string;
	} = $props();

	let width = $state(0);

	// a little taller on wide cards, so the bend where the fee starts stays visible
	const H = $derived(Math.round(Math.min(150, Math.max(112, width * 0.2))));
	const TOP = 24; // room for the total above the end of the line
	const BOTTOM = 22; // the time labels
	const SIDE = 6; // the end dot and its ring
	const plotH = $derived(H - TOP - BOTTOM);
	const plotW = $derived(Math.max(width - 2 * SIDE, 1));

	const total = $derived(est.minutes);
	const topIsk = $derived(Math.max(est.costIsk, 1));
	const x = (t: number) => SIDE + (t / total) * plotW;
	const y = (isk: number) => TOP + plotH - (isk / topIsk) * plotH;
	const energyAt = (t: number) => est.energyIsk * (t / total);

	/** minute the per-minute fee starts within the charge (0 = from the start); null = none paid */
	const feeAt = $derived(est.feeMinutes > 0 ? (est.feeFromMin ?? 0) : null);
	const base = $derived(y(0));
	const energyLine = $derived(`M${x(0)} ${base}L${x(total)} ${y(est.energyIsk)}`);
	const feeStart = $derived(feeAt === null ? null : { x: x(feeAt), y: y(energyAt(feeAt)) });
	const feeLine = $derived(
		feeStart ? `M${feeStart.x} ${feeStart.y}L${x(total)} ${y(est.costIsk)}` : null
	);
	// the fee's label sits under the point where it starts, when it doesn't crowd the ends
	const feeLabel = $derived(
		feeStart && feeAt! > 0 && feeStart.x - x(0) >= 30 && x(total) - feeStart.x >= 84
	);

	const alt = $derived(
		[
			m.explain_chart_alt({
				cost: formatEstimateIsk(est.costIsk),
				time: duration(est.minutes)
			}),
			feeAt === null
				? ''
				: feeAt > 0
					? m.explain_chart_alt_fee({ min: feeAt })
					: m.explain_chart_alt_fee_all()
		]
			.filter(Boolean)
			.join(' ')
	);

	const kw = (v: number) => formatNumber(Math.round(v * 10) / 10);
	const why = $derived.by(() => {
		const time = duration(est.minutes);
		const avg = Math.round(speed.avgKw);
		if (est.mode === 'AC') {
			if (speed.limit === 'station')
				return m.explain_time_station_ac({ time, kw: kw(speed.stationKw) });
			if (speed.limit === 'car' && speed.carKw !== null)
				return m.explain_time_car_ac({ time, kw: kw(speed.carKw) });
			return m.explain_time_onboard({ time, kw: kw(speed.avgKw) });
		}
		if (speed.limit === 'car' && speed.carKw !== null)
			return m.explain_time_car({ time, kw: kw(speed.carKw), avg });
		if (speed.limit === 'battery') {
			// the peak this car gets here: the same "allt að" figure as the card's header
			const peak = Math.min(speed.stationKw, speed.carKw ?? Infinity);
			return m.explain_time_battery({ time, kw: kw(peak), avg });
		}
		return m.explain_time_station({ time, kw: kw(speed.stationKw), avg });
	});

	const feeDetail = $derived(
		est.minuteFeeIsk === null
			? ''
			: feeAt === null
				? m.explain_fee_none({
						fee: formatNumber(est.minuteFeeIsk),
						after: est.feeFromMin ?? 0
					})
				: feeAt > 0
					? m.explain_fee_after({
							min: Math.round(est.feeMinutes),
							fee: formatNumber(est.minuteFeeIsk),
							after: feeAt
						})
					: m.explain_fee_all({
							min: Math.round(est.feeMinutes),
							fee: formatNumber(est.minuteFeeIsk)
						})
	);
</script>

<div class="explainer" data-testid="charge-explainer">
	<figure class="chart">
		<figcaption>{m.explain_chart_title()}</figcaption>
		<div class="plot" bind:clientWidth={width}>
			{#if width > 0}
				<svg {width} height={H} viewBox="0 0 {width} {H}" role="img" aria-label={alt}>
					<path class="area energy" d="{energyLine}L{x(total)} {base}Z" />
					{#if feeLine}
						<path class="area fee" d="{feeLine}L{x(total)} {y(est.energyIsk)}Z" />
					{/if}
					<line class="base" x1={x(0)} x2={x(total)} y1={base} y2={base} />
					{#if feeStart && feeAt! > 0}
						<line class="guide" x1={feeStart.x} x2={feeStart.x} y1={base} y2={feeStart.y + 6} />
					{/if}
					<path class="line energy" d={energyLine} />
					{#if feeLine}
						<path class="line fee" d={feeLine} />
					{/if}
					{#if feeStart && feeAt! > 0}
						<circle class="dot fee" cx={feeStart.x} cy={feeStart.y} r="4" />
					{/if}
					<circle
						class="dot"
						class:fee={feeLine !== null}
						class:energy={feeLine === null}
						cx={x(total)}
						cy={y(est.costIsk)}
						r="4.5"
					/>
					<text class="value" x={width} y={y(est.costIsk) - 11} text-anchor="end"
						>≈ {formatEstimateIsk(est.costIsk)}</text
					>
					<text class="tick" x={x(0) - SIDE} y={H - 5}>0</text>
					{#if feeLabel}
						<text class="tick" x={feeStart!.x} y={H - 5} text-anchor="middle"
							>{m.duration_min({ n: feeAt! })}</text
						>
					{/if}
					<text class="tick" x={width} y={H - 5} text-anchor="end">≈ {duration(est.minutes)}</text>
				</svg>
			{/if}
		</div>
	</figure>

	<dl class="receipt" data-testid="breakdown">
		<div class="row">
			<dt><span class="key energy" aria-hidden="true"></span>{m.explain_energy()}</dt>
			<dd class="amount num">≈ {formatEstimateIsk(est.energyIsk)}</dd>
			<dd class="detail">
				{m.explain_energy_detail({
					billed: formatNumber(Math.round(est.billedKwh * 10) / 10),
					price: formatNumber(est.priceIskPerKwh),
					battery: formatNumber(est.batteryKwh),
					loss: Math.round(est.loss * 100)
				})}
			</dd>
		</div>
		{#if est.minuteFeeIsk !== null}
			<div class="row">
				<dt>
					<span class="key fee" class:none={feeAt === null} aria-hidden="true"
					></span>{m.explain_fee()}
				</dt>
				<!-- no fee within the charge is exactly nothing, not an estimate -->
				<dd class="amount num">
					{feeAt === null ? formatEstimateIsk(0) : `≈ ${formatEstimateIsk(est.feeIsk)}`}
				</dd>
				<dd class="detail">{feeDetail}</dd>
			</div>
			<div class="row total">
				<dt>{m.explain_total()}</dt>
				<dd class="amount num">≈ {formatEstimateIsk(est.costIsk)}</dd>
			</div>
		{/if}
	</dl>

	<p class="why">
		<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
			><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" /><path
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				d="M12 7v5l3 2"
			/></svg
		>
		<span>{why}</span>
	</p>
</div>

<style>
	/* electricity is the brand green; the fee a blue that stays apart from it for every
	   kind of colour vision (checked with the dataviz palette validator) */
	.explainer {
		--energy: var(--accent);
		--fee: #2a78d6;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.chart {
		margin: 0;
	}
	figcaption {
		margin-bottom: 0.35rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
	}
	svg {
		display: block;
		overflow: visible;
	}
	.area.energy {
		fill: var(--energy);
		fill-opacity: 0.12;
	}
	.area.fee {
		fill: var(--fee);
		fill-opacity: 0.14;
	}
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.line.energy {
		stroke: var(--energy);
	}
	.line.fee {
		stroke: var(--fee);
	}
	.base,
	.guide {
		stroke: var(--border-strong);
		stroke-width: 1;
	}
	.dot {
		stroke: var(--surface);
		stroke-width: 2;
	}
	.dot.energy {
		fill: var(--energy);
	}
	.dot.fee {
		fill: var(--fee);
	}
	.value {
		fill: var(--text);
		font-size: 13px;
		font-weight: 700;
	}
	.tick {
		fill: var(--muted);
		font-size: 11.5px;
	}

	.receipt {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		column-gap: 0.75rem;
		align-items: baseline;
	}
	dt {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-weight: 600;
	}
	.amount {
		margin: 0;
		font-weight: 650;
		text-align: right;
		white-space: nowrap;
	}
	.detail {
		grid-column: 1 / -1;
		margin: 0.05rem 0 0 1.15rem;
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.4;
	}
	.key {
		flex: none;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 3px;
	}
	.key.energy {
		background: var(--energy);
	}
	.key.fee {
		background: var(--fee);
	}
	.key.none {
		background: var(--border-strong);
	}
	.total {
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
	}
	.total dt {
		padding-left: 1.15rem;
	}
	.total dt,
	.total .amount {
		font-weight: 750;
	}

	.why {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0;
		padding: 0.6rem 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.why svg {
		flex: none;
		margin-top: 0.1rem;
		color: var(--muted);
	}
</style>
