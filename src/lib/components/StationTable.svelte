<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { formatIsk, formatDate, formatNumber, isStale, ageParts } from '$lib/format';
	import { CONNECTOR_TYPES } from '$lib/types';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';
	import CarFilter from '$lib/components/CarFilter.svelte';
	import type { StationRow } from '$lib/server/db/queries';

	let {
		stations,
		mode,
		connector,
		network,
		networkOptions,
		car
	}: {
		/** carKw: the speed the chosen car gets at the station (set when a car filters the list) */
		stations: (StationRow & { carKw?: number | null })[];
		mode: 'AC' | 'DC';
		connector: string | null;
		network: string | null;
		networkOptions: { slug: string; name: string }[];
		car: { slug: string; make: string; model: string; variant: string | null } | null;
	} = $props();

	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min'
			? m.age_min({ n: p.n })
			: p.unit === 'h'
				? m.age_h({ n: p.n })
				: m.age_d({ n: p.n });
	}

	function href(params: Record<string, string | null>): string {
		const u = new URL(page.url);
		for (const [k, v] of Object.entries(params)) {
			if (v === null) u.searchParams.delete(k);
			else u.searchParams.set(k, v);
		}
		return u.pathname + u.search;
	}
</script>

<section aria-label={m.stations_title()}>
	<h2>{m.stations_title()}</h2>

	<nav class="filters surface">
		<div class="filter-row">
			<span class="filter-label" aria-hidden="true">{m.filter_mode()}</span>
			<span class="pills" role="group" aria-label={m.filter_mode()}>
				<a
					class="pill"
					href={href({ afl: null })}
					class:active={mode === 'DC'}
					aria-current={mode === 'DC' ? 'page' : undefined}>{m.mode_dc()}</a
				>
				<a
					class="pill"
					href={href({ afl: 'AC' })}
					class:active={mode === 'AC'}
					aria-current={mode === 'AC' ? 'page' : undefined}>{m.mode_ac()}</a
				>
			</span>
		</div>
		<div class="filter-row">
			<span class="filter-label" aria-hidden="true">{m.th_connectors()}</span>
			<span class="pills" role="group" aria-label={m.th_connectors()}>
				<a
					class="pill"
					href={href({ tengi: null })}
					class:active={!connector}
					aria-current={!connector ? 'page' : undefined}>{m.filter_all_connectors()}</a
				>
				{#each CONNECTOR_TYPES as t (t)}
					<a
						class="pill"
						href={href({ tengi: t })}
						class:active={connector === t}
						aria-current={connector === t ? 'page' : undefined}
						><ConnectorIcon type={t} size={18} />{t}</a
					>
				{/each}
			</span>
		</div>
		<div class="filter-row">
			<span class="filter-label" aria-hidden="true">{m.th_network()}</span>
			<span class="pills" role="group" aria-label={m.th_network()}>
				<a
					class="pill"
					href={href({ fyrirtaeki: null })}
					class:active={!network}
					aria-current={!network ? 'page' : undefined}>{m.filter_all_networks()}</a
				>
				{#each networkOptions as n (n.slug)}
					<a
						class="pill has-logo"
						href={href({ fyrirtaeki: n.slug })}
						class:active={network === n.slug}
						aria-current={network === n.slug ? 'page' : undefined}
						><NetworkLogo slug={n.slug} name={n.name} size={22} />{n.name}</a
					>
				{/each}
			</span>
		</div>
		<div class="filter-row">
			<span class="filter-label" aria-hidden="true">{m.filter_car()}</span>
			<CarFilter {car} {href} />
		</div>
	</nav>

	{#if stations.length === 0}
		<p class="empty surface">{m.no_results()}</p>
	{:else}
		<div class="table-wrap surface">
			<table>
				<thead>
					<tr>
						<th>{m.th_station()}</th>
						<th>{m.th_price()}</th>
						<th>{m.th_connectors()}</th>
						<th class="free-col">{m.th_free()}</th>
					</tr>
				</thead>
				<tbody>
					{#each stations as s (s.slug)}
						<tr data-testid="station-row">
							<td class="station">
								<div class="station-cell">
									<NetworkLogo slug={s.networkSlug} name={s.networkName} size={36} />
									<span class="station-text">
										<a href="/stod/{s.slug}">{s.name}</a>
										<span class="net"
											>{s.networkName}{#if s.carKw}{' · '}<span class="car-kw"
													>{m.finder_up_to({ kw: Math.round(s.carKw) })}</span
												>{/if}</span
										>
									</span>
								</div>
							</td>
							<td data-label={m.th_price()} class="price">
								{#if s.price !== null}
									{@const stale = s.verifiedAt !== null && isStale(s.verifiedAt)}
									{@const idleFee = s.minuteFeeIsk && s.minuteFeeAfterMin ? s.minuteFeeIsk : null}
									<span class="price-wrap" class:stale>
										<button type="button" class="price-info" aria-describedby="price-tip-{s.slug}">
											<strong class="num" data-testid="price">{formatIsk(s.price)}</strong>
											<svg
												class="info-icon"
												viewBox="0 0 24 24"
												width="15"
												height="15"
												aria-hidden="true"
												><circle
													cx="12"
													cy="12"
													r="9"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
												/><path
													fill="currentColor"
													d="M11 10.5h2V17h-2zM12 6.8a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z"
												/></svg
											></button
										>
										<span class="tip" role="tooltip" id="price-tip-{s.slug}">
											{#if idleFee}<span class="tip-line"
													>{m.minute_fee_after({
														fee: formatNumber(idleFee),
														min: s.minuteFeeAfterMin!
													})}</span
												>{/if}
											{#if s.verifiedAt}<span class="tip-line tip-verified" class:stale
													>{m.verified_on({ date: formatDate(s.verifiedAt) })}</span
												>{/if}
										</span>
									</span>
									<!-- a per-minute fee from minute 0 hits every charge, so it stays visible -->
									{#if s.minuteFeeIsk && !s.minuteFeeAfterMin}<small class="fee"
											>{m.minute_fee({ fee: formatNumber(s.minuteFeeIsk) })}</small
										>{/if}
								{:else}
									<em class="unknown">{m.price_unknown()}</em>
								{/if}
							</td>
							<td data-label={m.th_connectors()} class="connectors">
								{#each s.connectors as c, ci (ci)}
									<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
								{/each}
							</td>
							<td data-label={m.th_free()} class="free-col">
								{#if s.freeCount !== null && s.totalCount !== null}
									<span class="avail num" class:has-free={s.freeCount > 0} data-testid="free-count"
										>{s.freeCount}/{s.totalCount}</span
									>
									{#if s.availabilityFetchedAt}<small class="verified"
											>{age(s.availabilityFetchedAt)}</small
										>{/if}
								{:else}<span class="muted">—</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.filters {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		margin-bottom: 1rem;
	}
	.empty {
		color: var(--muted);
		padding: 2rem 1rem;
		text-align: center;
	}

	.table-wrap {
		overflow: hidden;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
		background: var(--surface-2);
		padding: 0.6rem 1rem;
	}
	td {
		padding: 0.8rem 1rem;
		border-top: 1px solid var(--border);
		vertical-align: top;
	}
	tbody tr {
		transition: background-color 0.12s;
	}
	tbody tr:hover {
		background: #fafbfa;
	}

	.station {
		min-width: 14rem;
	}
	.station-cell {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.station-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
	}
	.station a {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.station a:hover {
		color: var(--accent-text);
		text-decoration: underline;
	}
	.net {
		color: var(--muted);
		font-size: 0.82rem;
	}
	.car-kw {
		color: var(--accent-text);
		font-weight: 600;
	}

	.price strong {
		font-size: 1.05rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.price-wrap {
		position: relative;
		display: inline-flex;
	}
	.price-info {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: none;
		color: inherit;
		font: inherit;
		cursor: help;
	}
	.info-icon {
		flex: none;
		color: var(--muted);
		opacity: 0.75;
		transition: opacity 0.12s;
	}
	.price-wrap:hover .info-icon,
	.price-info:focus-visible .info-icon {
		opacity: 1;
	}
	/* unverified for 30+ days: the price itself turns amber, not just the hidden date */
	.price-wrap.stale strong,
	.price-wrap.stale .info-icon {
		color: var(--stale);
	}
	/* kept in the DOM (not display:none) so screen readers still get the details */
	.tip {
		position: absolute;
		left: calc(100% + 0.5rem);
		top: 50%;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.45rem 0.65rem;
		border-radius: var(--radius-sm);
		background: var(--text);
		color: #fff;
		box-shadow: var(--shadow-lg);
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.35;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transform: translate(-0.25rem, -50%);
		transition:
			opacity 0.12s,
			transform 0.12s;
	}
	.price-wrap:hover .tip,
	.price-info:focus-visible + .tip {
		opacity: 1;
		transform: translate(0, -50%);
	}
	.tip-verified {
		opacity: 0.75;
	}
	.tip-line.stale {
		color: #fbbf24;
		opacity: 1;
	}
	small {
		display: block;
	}
	.fee {
		font-size: 0.78rem;
		color: var(--text);
	}
	.unknown {
		color: var(--muted);
		font-style: normal;
	}

	.free-col {
		text-align: right;
		white-space: nowrap;
	}
	.avail {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-weight: 650;
		font-size: 0.875rem;
	}
	.avail.has-free {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	/* phones: each row becomes a card */
	@media (max-width: 640px) {
		.table-wrap {
			background: none;
			border: none;
			box-shadow: none;
			overflow: visible;
		}
		thead {
			display: none;
		}
		table,
		tbody {
			display: block;
		}
		tbody tr {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 0.5rem 0.75rem;
			margin-bottom: 0.6rem;
			padding: 0.85rem;
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			box-shadow: var(--shadow-sm);
		}
		td {
			display: block;
			padding: 0;
			border: none;
		}
		.station {
			grid-column: 1 / -1;
			min-width: 0;
		}
		.price {
			grid-column: 1;
		}
		.free-col {
			grid-column: 2;
			grid-row: 2;
		}
		.free-col::before {
			content: attr(data-label);
			display: block;
			font-size: 0.72rem;
			color: var(--muted);
		}
		.connectors {
			grid-column: 1 / -1;
		}
		.connectors:empty {
			display: none;
		}
	}
</style>
