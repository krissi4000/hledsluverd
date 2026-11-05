<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
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
				<div class="card-head">
					<NetworkLogo slug={selected.networkSlug} name={selected.networkName} size={40} />
					<div class="card-title">
						<h3><a href="/stod/{selected.slug}">{selected.name}</a></h3>
						<p class="net">{selected.networkName}</p>
					</div>
					<button
						type="button"
						class="close"
						aria-label={m.close()}
						onclick={() => (selectedId = null)}
					>
						<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
							><path
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								d="M6 6l12 12M18 6 6 18"
							/></svg
						>
					</button>
				</div>
				<div class="stats">
					<div>
						<span class="label">{m.th_price()}</span>
						{#if selected.price !== null}
							<strong class="num">{formatIsk(selected.price)}</strong>
							<span class="mode">{selected.mode}</span>
						{:else}
							<em class="muted">{m.price_unknown()}</em>
						{/if}
					</div>
					<div data-testid="card-availability">
						<span class="label">{m.th_free()}</span>
						{#if selected.freeCount !== null && selected.totalCount !== null}
							<strong class="num">{selected.freeCount}/{selected.totalCount}</strong>
							{#if selected.availabilityFetchedAt}<small class="muted"
									>{age(selected.availabilityFetchedAt)}</small
								>{/if}
						{:else}—{/if}
					</div>
				</div>
				<p class="chips">
					{#each selected.connectors as c, ci (ci)}
						<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
					{/each}
				</p>
				<a class="btn btn-primary more" href="/stod/{selected.slug}">{m.map_details()} →</a>
			</aside>
		{/if}
	</div>
</section>

<style>
	/* break out of main's centered column so the map runs edge to edge */
	.wrap {
		margin: -1.25rem calc(50% - 50vw) -3rem;
	}
	.maparea {
		position: relative;
		height: calc(100dvh - var(--header-h));
		min-height: 24rem;
	}
	.card {
		position: absolute;
		left: 1rem;
		bottom: 1.5rem;
		z-index: 10;
		width: min(22rem, calc(100% - 2rem));
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 1rem;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.card-title {
		flex: 1;
		min-width: 0;
	}
	.card h3 {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.25;
	}
	.card h3 a {
		color: var(--text);
		text-decoration: none;
	}
	.card h3 a:hover {
		text-decoration: underline;
	}
	.net {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.close {
		align-self: flex-start;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		margin: -0.25rem -0.25rem 0 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin: 0.85rem 0 0.6rem;
		padding: 0.7rem 0.85rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.stats strong {
		font-size: 1.2rem;
		font-weight: 750;
	}
	.label {
		display: block;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.mode {
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
	}
	.stats small {
		display: block;
		font-size: 0.72rem;
	}
	.chips {
		margin: 0 0 0.75rem;
	}
	.more {
		width: 100%;
	}
	.js-note {
		padding: 1rem;
	}

	@media (max-width: 640px) {
		.card {
			left: 0.5rem;
			right: 0.5rem;
			bottom: 0.5rem;
			width: auto;
		}
	}
</style>
