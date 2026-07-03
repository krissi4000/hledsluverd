<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { formatIsk, formatDate } from '$lib/format';
	import { CONNECTOR_TYPES } from '$lib/types';
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

	<nav class="filters">
		<span class="group" role="group" aria-label="mode">
			<a href={href({ afl: null })} class:active={mode === 'DC'}>{m.mode_dc()}</a>
			<a href={href({ afl: 'AC' })} class:active={mode === 'AC'}>{m.mode_ac()}</a>
		</span>
		<span class="group" role="group" aria-label="connector">
			<a href={href({ tengi: null })} class:active={!connector}>{m.filter_all_connectors()}</a>
			{#each CONNECTOR_TYPES as t}
				<a href={href({ tengi: t })} class:active={connector === t}>{t}</a>
			{/each}
		</span>
		<span class="group" role="group" aria-label="network">
			<a href={href({ fyrirtaeki: null })} class:active={!network}>{m.filter_all_networks()}</a>
			{#each networkOptions as n}
				<a href={href({ fyrirtaeki: n.slug })} class:active={network === n.slug}>{n.name}</a>
			{/each}
		</span>
	</nav>

	<table>
		<thead>
			<tr>
				<th>{m.th_station()}</th>
				<th>{m.th_network()}</th>
				<th>{m.th_price()}</th>
				<th>{m.th_connectors()}</th>
				<th>{m.th_free()}</th>
			</tr>
		</thead>
		<tbody>
			{#each stations as s (s.slug)}
				<tr data-testid="station-row">
					<td data-label={m.th_station()}>{s.name}</td>
					<td data-label={m.th_network()}>{s.networkName}</td>
					<td data-label={m.th_price()}>
						{#if s.price !== null}
							<strong data-testid="price">{formatIsk(s.price)}</strong>
							{#if s.minuteFeeIsk}<small>{m.minute_fee({ fee: String(s.minuteFeeIsk) })}</small
								>{/if}
							{#if s.verifiedAt}<small class="verified"
									>{m.verified_on({ date: formatDate(s.verifiedAt) })}</small
								>{/if}
						{:else}
							<em>{m.price_unknown()}</em>
						{/if}
					</td>
					<td data-label={m.th_connectors()}>
						{#each s.connectors as c}
							<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
						{/each}
					</td>
					<td data-label={m.th_free()}>—</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.group {
		display: inline-flex;
		flex-wrap: wrap;
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
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-size: 0.85rem;
		opacity: 0.7;
		border-bottom: 2px solid var(--border, #ccc);
		padding: 0.4rem 0.5rem;
	}
	td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border, #e2e2e2);
		vertical-align: top;
	}
	.chip {
		display: inline-block;
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		padding: 0 0.5rem;
		margin: 0 0.2rem 0.2rem 0;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.verified {
		display: block;
		opacity: 0.6;
		font-size: 0.75rem;
	}
	small {
		display: block;
	}

	@media (max-width: 640px) {
		thead {
			display: none;
		}
		tr {
			display: block;
			border-bottom: 2px solid var(--border, #ccc);
			padding: 0.4rem 0;
		}
		td {
			display: flex;
			gap: 0.5rem;
			border: none;
			padding: 0.15rem 0.25rem;
		}
		td::before {
			content: attr(data-label);
			flex: 0 0 6rem;
			font-size: 0.8rem;
			opacity: 0.6;
		}
	}
</style>
