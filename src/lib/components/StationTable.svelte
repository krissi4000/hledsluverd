<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { formatIsk, formatDate, formatNumber, isStale, ageParts } from '$lib/format';
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

	<nav class="filters">
		<span class="group" role="group" aria-label={m.filter_mode()}>
			<a
				href={href({ afl: null })}
				class:active={mode === 'DC'}
				aria-current={mode === 'DC' ? 'page' : undefined}>{m.mode_dc()}</a
			>
			<a
				href={href({ afl: 'AC' })}
				class:active={mode === 'AC'}
				aria-current={mode === 'AC' ? 'page' : undefined}>{m.mode_ac()}</a
			>
		</span>
		<span class="group" role="group" aria-label={m.th_connectors()}>
			<a
				href={href({ tengi: null })}
				class:active={!connector}
				aria-current={!connector ? 'page' : undefined}>{m.filter_all_connectors()}</a
			>
			{#each CONNECTOR_TYPES as t}
				<a
					href={href({ tengi: t })}
					class:active={connector === t}
					aria-current={connector === t ? 'page' : undefined}>{t}</a
				>
			{/each}
		</span>
		<span class="group" role="group" aria-label={m.th_network()}>
			<a
				href={href({ fyrirtaeki: null })}
				class:active={!network}
				aria-current={!network ? 'page' : undefined}>{m.filter_all_networks()}</a
			>
			{#each networkOptions as n}
				<a
					href={href({ fyrirtaeki: n.slug })}
					class:active={network === n.slug}
					aria-current={network === n.slug ? 'page' : undefined}>{n.name}</a
				>
			{/each}
		</span>
	</nav>

	{#if stations.length === 0}
		<p class="empty">{m.no_results()}</p>
	{:else}
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
								{#if s.minuteFeeIsk}<small
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
								<em>{m.price_unknown()}</em>
							{/if}
						</td>
						<td data-label={m.th_connectors()}>
							{#each s.connectors as c}
								<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
							{/each}
						</td>
						<td data-label={m.th_free()}>
							{#if s.freeCount !== null && s.totalCount !== null}
								<span data-testid="free-count">{s.freeCount}/{s.totalCount}</span>
								{#if s.availabilityFetchedAt}<small class="verified"
										>{age(s.availabilityFetchedAt)}</small
									>{/if}
							{:else}—{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
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
	.empty {
		opacity: 0.7;
		padding: 1rem 0;
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
	.verified.stale {
		color: #b26a00;
		opacity: 1;
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
