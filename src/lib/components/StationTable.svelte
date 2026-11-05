<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { formatIsk, formatDate, formatNumber, isStale, ageParts } from '$lib/format';
	import { CONNECTOR_TYPES } from '$lib/types';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import type { StationRow } from '$lib/server/db/queries';

	let {
		stations,
		mode,
		connector,
		network,
		networkOptions
	}: {
		stations: StationRow[];
		mode: 'AC' | 'DC';
		connector: string | null;
		network: string | null;
		networkOptions: { slug: string; name: string }[];
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
						aria-current={connector === t ? 'page' : undefined}>{t}</a
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
										<span class="net">{s.networkName}</span>
									</span>
								</div>
							</td>
							<td data-label={m.th_price()} class="price">
								{#if s.price !== null}
									<strong class="num" data-testid="price">{formatIsk(s.price)}</strong>
									{#if s.minuteFeeIsk}<small class="fee"
											>{s.minuteFeeAfterMin
												? m.minute_fee_after({
														fee: formatNumber(s.minuteFeeIsk),
														min: s.minuteFeeAfterMin
													})
												: m.minute_fee({ fee: formatNumber(s.minuteFeeIsk) })}</small
										>{/if}
									{#if s.verifiedAt}<small class="verified" class:stale={isStale(s.verifiedAt)}
											>{m.verified_on({ date: formatDate(s.verifiedAt) })}</small
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

	.price strong {
		font-size: 1.05rem;
		font-weight: 700;
		white-space: nowrap;
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
