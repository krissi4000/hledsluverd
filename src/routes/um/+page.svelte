<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import { ownBrandPriceOnly } from '$lib/networks';

	let { data } = $props();

	const scraped = $derived(data.sources.filter((s) => s.method === 'scraped'));
	const manual = $derived(data.sources.filter((s) => s.method === 'manual'));
</script>

<svelte:head>
	<title>{m.um_title()} — {m.site_title()}</title>
	<meta name="description" content={m.um_intro()} />
</svelte:head>

<article class="about">
	<h2>{m.um_title()}</h2>
	<p class="lead">{m.um_intro()}</p>

	<section class="panel surface">
		<h3>{m.um_independent_title()}</h3>
		<p>{m.um_independent()}</p>
	</section>

	<section class="panel surface" data-testid="um-price-sources">
		<h3>{m.um_prices_title()}</h3>
		<p>{m.um_prices_intro()}</p>
		<ul class="sources">
			{#each scraped as s (s.slug)}
				<li>
					<NetworkLogo slug={s.slug} name={s.name} size={28} />
					<span>
						<strong>{s.name}</strong>: {m.um_method_scraped()}
						{#if s.sourceUrl}(<a href={s.sourceUrl} rel="noopener external">{m.um_source()}</a
							>){/if}
					</span>
				</li>
			{/each}
			{#each manual as s (s.slug)}
				<li>
					<NetworkLogo slug={s.slug} name={s.name} size={28} />
					<span>
						<strong>{s.name}</strong>: {m.um_method_manual()}
						{#if ownBrandPriceOnly(s.slug)}<br /><small>{m.tesla_price_only_title()}</small>{/if}
					</span>
				</li>
			{/each}
		</ul>
		<p>{m.um_fail_loud()}</p>
		<p>{m.um_host_priced()}</p>
	</section>

	<section class="panel surface">
		<h3>{m.um_verified_title()}</h3>
		<p>{m.um_verified()}</p>
		<p><span class="stale-sample">{m.um_stale_sample()}</span> {m.um_stale()}</p>
	</section>

	<section class="panel surface">
		<h3>{m.um_estimate_title()}</h3>
		<p>{m.um_estimate()}</p>
	</section>

	<section class="panel surface">
		<h3>{m.um_avail_title()}</h3>
		<p>{m.um_avail()}</p>
	</section>

	<section class="panel surface" data-testid="um-data-sources">
		<h3>{m.um_stations_title()}</h3>
		<p>{m.um_stations_intro()}</p>
		<ul class="credits">
			<li>
				<a href="https://openchargemap.org" rel="noopener external">Open Charge Map</a>: {m.um_src_ocm()}
				<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener external license"
					>CC BY 4.0</a
				>.
			</li>
			<li>
				<a href="https://www.virta.global" rel="noopener external">Virta</a>: {m.um_src_virta()}
			</li>
			<li><a href="https://www.e1.is" rel="noopener external">e1</a>: {m.um_src_e1()}</li>
			<li>
				<a href="https://supercharge.info" rel="noopener external">supercharge.info</a>: {m.um_src_supercharge()}
			</li>
			<li>
				<a href="https://www.tomtom.com" rel="noopener external">TomTom</a>: {m.um_src_tomtom()}
			</li>
			<li>
				<a href="https://github.com/open-ev-data/open-ev-data-dataset" rel="noopener external"
					>OpenEV Data</a
				>: {m.um_src_openev()}
				<a href="https://cdla.dev/permissive-2-0/" rel="noopener external license"
					>CDLA-Permissive-2.0</a
				>.
			</li>
			<li>
				<a href="https://openfreemap.org" rel="noopener external">OpenFreeMap</a>: {m.um_src_map()}
				<a href="https://www.openstreetmap.org/copyright" rel="noopener external">© OpenStreetMap</a
				>.
			</li>
		</ul>
		<p>{m.um_stations_sync()}</p>
	</section>

	<section class="panel surface" id="samband">
		<h3>{m.um_contact_title()}</h3>
		{#if data.contactEmail}
			<p>
				{m.um_contact_email()}
				<a href="mailto:{data.contactEmail}" data-testid="um-contact-email">{data.contactEmail}</a>
			</p>
		{/if}
		<p>{m.um_contact_report()}</p>
	</section>
</article>

<style>
	.about {
		max-width: 46rem;
	}
	h2 {
		margin: 0.5rem 0 0.5rem;
		font-size: 1.6rem;
	}
	.lead {
		margin: 0 0 1.25rem;
		font-size: 1.05rem;
		color: var(--muted);
	}
	.panel {
		padding: 1rem 1.15rem;
		margin-bottom: 1rem;
	}
	.panel h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.panel p {
		margin: 0 0 0.6rem;
		line-height: 1.55;
	}
	.panel p:last-child {
		margin-bottom: 0;
	}
	.sources,
	.credits {
		margin: 0 0 0.75rem;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sources li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.sources small {
		color: var(--muted);
	}
	.credits li {
		line-height: 1.5;
	}
	.stale-sample {
		color: var(--stale);
		font-weight: 650;
	}
</style>
