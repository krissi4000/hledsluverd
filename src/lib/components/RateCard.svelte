<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatIsk } from '$lib/format';
	import type { RateCardEntry } from '$lib/server/db/queries';

	let { cards }: { cards: RateCardEntry[] } = $props();
</script>

<section aria-label={m.rate_card_title()}>
	<h2>{m.rate_card_title()}</h2>
	<ul class="cards">
		{#each cards as card, i}
			<li class="card" class:best={i === 0 && card.dc !== null} data-testid="rate-card">
				<span class="network">{card.networkName}</span>
				<span class="dc">
					{#if card.dc !== null}<strong data-testid="rate-dc"
							>{card.dcFrom
								? m.price_from({ price: formatIsk(card.dc) })
								: formatIsk(card.dc)}</strong
						> DC{/if}
				</span>
				<span class="ac">
					{#if card.ac !== null}{card.acFrom
							? m.price_from({ price: formatIsk(card.ac) })
							: formatIsk(card.ac)} AC{/if}
				</span>
				{#if i === 0 && card.dc !== null}<span class="badge">{m.cheapest()}</span>{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.cards {
		display: flex;
		gap: 0.5rem;
		padding: 0;
		list-style: none;
		overflow-x: auto;
	}
	.card {
		flex: 1 1 8rem;
		min-width: 7rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.5rem;
		padding: 0.6rem 0.8rem;
	}
	.card.best {
		border-color: var(--accent, #2e7d32);
	}
	.network {
		font-weight: 600;
	}
	.dc strong {
		font-size: 1.25rem;
	}
	.ac {
		opacity: 0.75;
		font-size: 0.9rem;
	}
	.badge {
		color: var(--accent, #2e7d32);
		font-size: 0.8rem;
		font-weight: 600;
	}
</style>
