<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import { ownBrandPriceOnly } from '$lib/networks';

	let { data } = $props();

	const scraped = $derived(data.sources.filter((s) => s.method === 'scraped'));
	const manual = $derived(data.sources.filter((s) => s.method === 'manual'));
</script>

<article class="about">
	<h1>{m.um_title()}</h1>
	<p class="lead">{m.um_intro()}</p>

	<section id="ohadur">
		<h2>{m.um_independent_title()}</h2>
		<p>{m.um_independent()}</p>
	</section>

	<section id="verd" data-testid="um-price-sources">
		<h2>{m.um_prices_title()}</h2>
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

	<section id="stadfest">
		<h2>{m.um_verified_title()}</h2>
		<p>{m.um_verified()}</p>
		<p><span class="stale-sample">{m.um_stale_sample()}</span> {m.um_stale()}</p>
	</section>

	<section id="aaetlun">
		<h2>{m.um_estimate_title()}</h2>
		<p>{m.um_estimate()}</p>
		<p>{m.um_nearby()}</p>
	</section>

	<section id="laust">
		<h2>{m.um_avail_title()}</h2>
		<p>{m.um_avail()}</p>
	</section>

	<section id="heimildir" data-testid="um-data-sources">
		<h2>{m.um_stations_title()}</h2>
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
			{#if data.streetView}
				<li>
					<a href="https://www.google.com/streetview/" rel="noopener external">Google Street View</a
					>: {m.um_src_streetview()}
				</li>
			{/if}
			{#if data.placePhotos}
				<li>
					<a href="https://www.google.com/maps" rel="noopener external">Google Maps</a>: {m.um_src_places()}
				</li>
			{/if}
			<li>{m.um_src_cars()}</li>
			<li>
				<a href="https://openfreemap.org" rel="noopener external">OpenFreeMap</a>: {m.um_src_map()}
				<a href="https://www.openstreetmap.org/copyright" rel="noopener external">© OpenStreetMap</a
				>.
			</li>
		</ul>
		<p>{m.um_stations_sync()}</p>
	</section>

	<section id="samband">
		<h2>{m.um_contact_title()}</h2>
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
		max-width: 42rem;
	}
	h1 {
		margin-bottom: 0.5rem;
	}
	.lead {
		margin: 0 0 1.5rem;
		font-size: 1.05rem;
		color: var(--muted);
	}
	section {
		padding: 1.25rem 0;
		border-top: 1px solid var(--border);
		scroll-margin-top: calc(var(--header-h) + 0.5rem);
	}
	h2 {
		margin-bottom: 0.5rem;
	}
	section p {
		margin: 0 0 0.6rem;
		line-height: 1.6;
	}
	section p:last-child {
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
