<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import { ageParts, formatIsk } from '$lib/format';

	let { data } = $props();
	let selectedId = $state<number | null>(null);

	const selected = $derived(data.stations.find((s) => s.id === selectedId) ?? null);

	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min'
			? m.age_min({ n: p.n })
			: p.unit === 'h'
				? m.age_h({ n: p.n })
				: m.age_d({ n: p.n });
	}
</script>

<svelte:head>
	<title>{m.map_title()} — {m.site_title()}</title>
	<meta name="description" content={m.map_title()} />
</svelte:head>

<section aria-label={m.map_title()} class="wrap">
	<h2 class="visually-hidden">{m.map_title()}</h2>
	<noscript><p class="js-note">{m.map_js()}</p></noscript>
	<div class="maparea">
		<StationMap stations={data.stations} bind:selectedId fallbackText={m.map_fallback()} />
		{#if selected}
			<aside class="card" data-testid="map-card">
				<h3><a href="/stod/{selected.slug}">{selected.name}</a></h3>
				<p class="net">{selected.networkName}</p>
				<p class="price">
					{#if selected.price !== null}
						<strong>{formatIsk(selected.price)}</strong> {selected.mode}
					{:else}
						<em>{m.price_unknown()}</em>
					{/if}
				</p>
				<p>
					{#each selected.connectors as c}
						<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
					{/each}
				</p>
				<p data-testid="card-availability">
					{m.th_free()}:
					{#if selected.freeCount !== null && selected.totalCount !== null}
						{selected.freeCount}/{selected.totalCount}
						{#if selected.availabilityFetchedAt}<small>{age(selected.availabilityFetchedAt)}</small
							>{/if}
					{:else}—{/if}
				</p>
				<a class="more" href="/stod/{selected.slug}">{m.map_details()} →</a>
			</aside>
		{/if}
	</div>
</section>

<style>
	/* break out of main's centered column so the map runs edge to edge */
	.wrap {
		margin: -1rem calc(50% - 50vw) 0;
	}
	.maparea {
		position: relative;
		height: calc(100vh - 7rem);
		min-height: 24rem;
	}
	.card {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		background: #fff;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.5rem;
		box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
		padding: 0.75rem 1rem;
		max-width: 20rem;
	}
	.card h3 {
		margin: 0 0 0.25rem;
	}
	.card p {
		margin: 0.25rem 0;
	}
	.net {
		opacity: 0.7;
		font-size: 0.9rem;
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
	.more {
		font-weight: 600;
	}
	.js-note {
		padding: 1rem;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
