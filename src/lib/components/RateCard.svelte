<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatIsk, isStale } from '$lib/format';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import { cheapestDc, ownBrandPriceOnly } from '$lib/networks';
	import type { RateCardEntry } from '$lib/server/db/queries';

	// Each network's price at a glance: one row per network, fast and slow side by side.
	let {
		cards,
		carMake = null
	}: {
		/** cheapest DC first (rateCard's order) */
		cards: RateCardEntry[];
		/** the chosen car's make: its own brand's member price (Tesla's) counts for it */
		carMake?: string | null;
	} = $props();

	// the badge goes to the lowest price every car can pay, never Tesla's Tesla-only price
	const cheapest = $derived(cheapestDc(cards));
	// a price only one brand's cars get sorts after everyone's, unless the car is that brand
	const brandOnly = (slug: string) => ownBrandPriceOnly(slug) && slug !== carMake?.toLowerCase();
	const rows = $derived(
		[...cards].sort((a, b) => Number(brandOnly(a.networkSlug)) - Number(brandOnly(b.networkSlug)))
	);
	const stale = (d: Date | null) => d !== null && isStale(d);
	const price = (value: number, from: boolean) =>
		from ? m.price_from({ price: formatIsk(value) }) : formatIsk(value);
</script>

<section class="rates surface" aria-labelledby="rates-title">
	<header class="head">
		<h2 id="rates-title">{m.rate_card_title()}</h2>
		<span class="unit">{m.rates_unit()}</span>
	</header>
	<table>
		<thead>
			<tr>
				<th scope="col"><span class="visually-hidden">{m.th_network()}</span></th>
				<!-- phones get the short labels, so each heading keeps to one line -->
				<th scope="col"
					><span class="full">{m.mode_dc()}</span><span class="short">{m.mode_dc_short()}</span></th
				>
				<th scope="col"
					><span class="full">{m.mode_ac()}</span><span class="short">{m.mode_ac_short()}</span></th
				>
			</tr>
		</thead>
		<tbody>
			{#each rows as card (card.networkSlug)}
				{@const isBest = card === cheapest}
				{@const dcStale = stale(card.dcVerifiedAt)}
				{@const acStale = stale(card.acVerifiedAt)}
				<tr
					data-testid="rate-card"
					data-network={card.networkSlug}
					class:brand-only={brandOnly(card.networkSlug)}
				>
					<th scope="row">
						<span class="net">
							<NetworkLogo slug={card.networkSlug} name={card.networkName} size={28} />
							<span class="name">
								{card.networkName}
								{#if ownBrandPriceOnly(card.networkSlug)}<small title={m.tesla_price_only_title()}
										>{m.tesla_price_only()}</small
									>{:else if card.hostLower}<small
										class="host-lower"
										title={m.host_lower_title({ network: card.networkName })}
										data-testid="host-lower">{m.host_lower()}</small
									>{/if}
							</span>
						</span>
					</th>
					<td class="price">
						{#if card.dc !== null}
							<span class="cell">
								<strong class="num" class:stale={dcStale} data-testid="rate-dc"
									>{price(card.dc, card.dcFrom)}</strong
								>
								{#if isBest}<span
										class="badge"
										class:stale={dcStale}
										title={m.cheapest_title()}
										data-testid="cheapest-badge">{m.cheapest()}</span
									>{/if}
							</span>
							{#if dcStale && card.dcVerifiedAt}<small class="verified stale"
									>{m.verified_on({ date: formatDate(card.dcVerifiedAt) })}</small
								>{/if}
						{:else}<span class="none">—</span>{/if}
					</td>
					<td class="price">
						{#if card.ac !== null}
							<strong class="num" class:stale={acStale}>{price(card.ac, card.acFrom)}</strong>
							{#if acStale && card.acVerifiedAt}<small class="verified stale"
									>{m.verified_on({ date: formatDate(card.acVerifiedAt) })}</small
								>{/if}
						{:else}<span class="none">—</span>{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.rates {
		padding: 0.9rem 1rem 0.5rem;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}
	h2 {
		margin: 0;
	}
	.unit {
		color: var(--muted);
		font-size: 0.8rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	thead th {
		white-space: nowrap;
		padding: 0.35rem 0 0.45rem;
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 600;
		text-align: left;
		vertical-align: bottom;
	}
	tbody th,
	td {
		padding: 0.55rem 0;
		border-top: 1px solid var(--border);
		text-align: left;
		vertical-align: middle;
	}
	tbody th {
		font-weight: 600;
		padding-right: 0.5rem;
	}
	td {
		padding-left: 0.5rem;
	}
	.net {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.name {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.25;
	}
	.name small {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.host-lower {
		cursor: help;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}
	/* the badge sits beside the price, or under it when the column is narrow */
	.cell {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.4rem;
	}
	.price strong {
		font-size: 1.05rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.price strong.stale {
		color: var(--stale);
	}
	/* a "cheapest" claim on a price unverified for 30+ days carries the amber warning */
	.badge.stale {
		background: var(--stale);
	}
	.none {
		color: var(--muted);
	}
	.full {
		display: none;
	}
	@media (min-width: 480px) {
		.full {
			display: inline;
		}
		.short {
			display: none;
		}
	}
	/* Tesla's price is for Tesla cars: listed, but out of the way (amber still wins) */
	.brand-only .price strong:not(.stale) {
		font-weight: 600;
		color: var(--muted);
	}
</style>
