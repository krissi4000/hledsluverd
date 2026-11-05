<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatIsk } from '$lib/format';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import { ownBrandPriceOnly } from '$lib/networks';
	import type { RateCardEntry } from '$lib/server/db/queries';

	let { cards }: { cards: RateCardEntry[] } = $props();
</script>

<section aria-label={m.rate_card_title()}>
	<h2>{m.rate_card_title()}</h2>
	<ul class="cards">
		{#each cards as card, i (card.networkSlug)}
			{@const best = i === 0 && card.dc !== null}
			<li class="card surface" class:best data-testid="rate-card">
				<div class="head">
					<NetworkLogo slug={card.networkSlug} name={card.networkName} size={32} />
					<span class="network">{card.networkName}</span>
					{#if best}<span class="badge">{m.cheapest()}</span>{/if}
				</div>
				<div class="dc">
					{#if card.dc !== null}
						<strong class="num" data-testid="rate-dc"
							>{card.dcFrom
								? m.price_from({ price: formatIsk(card.dc) })
								: formatIsk(card.dc)}</strong
						>
						<span class="unit">DC</span>
						{#if ownBrandPriceOnly(card.networkSlug)}<small
								class="brand-only"
								title={m.tesla_price_only_title()}>{m.tesla_price_only()}</small
							>{/if}
					{:else}
						<span class="none">—</span>
					{/if}
				</div>
				<div class="ac num">
					{#if card.ac !== null}{card.acFrom
							? m.price_from({ price: formatIsk(card.ac) })
							: formatIsk(card.ac)} AC{/if}
				</div>
			</li>
		{/each}
	</ul>
</section>

<style>
	h2 {
		margin-top: 0.5rem;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
	}
	.card.best {
		border-color: var(--accent);
		box-shadow:
			0 0 0 1px var(--accent),
			var(--shadow);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}
	.network {
		font-weight: 650;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		position: absolute;
		top: -0.6rem;
		right: 0.75rem;
	}
	.dc {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.dc strong {
		font-size: 1.5rem;
		font-weight: 750;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.unit {
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
	}
	.brand-only {
		flex-basis: 100%;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.none {
		font-size: 1.5rem;
		color: var(--muted);
		line-height: 1.1;
	}
	.ac {
		color: var(--muted);
		font-size: 0.875rem;
		min-height: 1.3em;
	}

	/* phones: horizontal scroller keeps the station list above the fold */
	@media (max-width: 640px) {
		.cards {
			display: flex;
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			scroll-padding: 0 1rem;
			margin: 0 -1rem;
			padding: 0.7rem 1rem 0.5rem;
		}
		.card {
			flex: 0 0 9.5rem;
			scroll-snap-align: start;
		}
	}
</style>
