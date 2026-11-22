<script lang="ts">
	// "Nálægt mér": the nearest stations as cards, ranked by distance and the kWh price
	// every visit pays ($lib/nearby). The card face holds only what is known: the kWh
	// price and its fees, the distance, the speed, the live status, and the way there.
	// What a full 0→100 % charge would cost is an estimate, one tap away under
	// "Full hleðsla" (pressing the card does the same), with the battery-size field.
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import type { FullChargeEstimate, FullChargeSpeed } from '$lib/ev';
	import { formatEstimateIsk, formatIsk, formatNumber, isStale } from '$lib/format';
	import { updatedText, verifiedText } from '$lib/age';
	import { minuteFeeText } from '$lib/fees';
	import { formatKm, type LatLng } from '$lib/geo';
	import { BATTERY_MAX_KWH, BATTERY_MIN_KWH, BATTERY_PARAM, NEARBY_COUNT } from '$lib/nearby';
	import { NEAR_PARAM, formatNear } from '$lib/station-list';
	import { ownBrandPriceOnly } from '$lib/networks';
	import { unknownStalls } from '$lib/availability';
	import { stationDisplayName } from '$lib/station-name';
	import { withParams } from '$lib/url';
	import type { StationRow } from '$lib/server/db/queries';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import UnknownStalls from '$lib/components/UnknownStalls.svelte';
	import DirectionsLink from '$lib/components/DirectionsLink.svelte';
	import ChargeExplainer from '$lib/components/ChargeExplainer.svelte';
	import StationPhoto from '$lib/components/StationPhoto.svelte';
	import CarFilter, { type CarPill } from '$lib/components/CarFilter.svelte';
	import ListControls from '$lib/components/ListControls.svelte';
	import OtherPrice from '$lib/components/OtherPrice.svelte';

	let {
		stations,
		near,
		car,
		battery,
		mode,
		connector,
		networks,
		networkDefaults,
		networkOptions,
		plateLookup = false,
		photos = false
	}: {
		/** ranked best first */
		stations: (StationRow & {
			distanceKm: number;
			carKw: number | null;
			/** null = no battery size (or no connector rating) to estimate from */
			fullCharge: FullChargeEstimate | null;
			/** what sets the full charge's time; set whenever fullCharge is */
			fullChargeSpeed: FullChargeSpeed | null;
		})[];
		/** the visitor's (rounded) position */
		near: LatLng;
		car: CarPill | null;
		battery: { kwh: number | null; fromCar: boolean; typed: number | null };
		mode: 'AC' | 'DC';
		connector: string | null;
		networks: string[];
		networkDefaults: string[];
		networkOptions: { slug: string; name: string }[];
		/** offer registration-plate lookup in the car search */
		plateLookup?: boolean;
		/** show Google Street View photos (a key is configured) */
		photos?: boolean;
	} = $props();

	/** the card whose full-charge estimate is open (one at a time, like a map app's list) */
	let openSlug = $state<string | null>(null);

	function duration(min: number): string {
		return min < 90
			? m.duration_min({ n: Math.round(min) })
			: m.duration_h({ h: formatNumber(Math.round(min / 6) / 10) });
	}

	const href = (params: Record<string, string | null>) => withParams(page.url, params);
	// the battery form is a plain GET form: it carries the other filters along
	const kept = $derived([...page.url.searchParams].filter(([k]) => k !== BATTERY_PARAM));

	function toggle(slug: string) {
		openSlug = openSlug === slug ? null : slug;
	}

	// Pressing anywhere on a card opens its estimate, except on the links, buttons and the
	// form in it. Keyboard and screen-reader users get the same through the toggle button.
	function cardClick(e: MouseEvent, slug: string, canOpen: boolean) {
		if (!canOpen) return;
		if ((e.target as Element).closest('a, button, input, form, .explain')) return;
		toggle(slug);
	}
</script>

<section class="nearby" data-testid="nearby-list" aria-labelledby="nearby-title">
	<div class="top">
		<a class="btn btn-ghost btn-sm" href={href({ [NEAR_PARAM]: null })} data-testid="near-clear"
			><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
				><path
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M15 6l-6 6 6 6"
				/></svg
			>{m.nearby_back()}</a
		>
		<a class="btn btn-ghost btn-sm" href="/kort?{NEAR_PARAM}={formatNear(near)}"
			>{m.nearby_on_map()}</a
		>
	</div>

	<h1 id="nearby-title">{m.nearby_title()}</h1>

	<div class="setup">
		<CarFilter {car} {href} {plateLookup} />
	</div>

	<ListControls {mode} {connector} {networks} {networkDefaults} {networkOptions} />

	<p class="note">{m.nearby_summary({ n: NEARBY_COUNT })}</p>

	{#if stations.length === 0}
		<p class="empty surface">{m.no_results()}</p>
	{:else}
		<ol class="cards">
			{#each stations as s (s.slug)}
				{@const fc = s.fullCharge}
				{@const stale = s.verifiedAt !== null && isStale(s.verifiedAt)}
				{@const speed = s.fullChargeSpeed}
				{@const priced = s.price !== null}
				{@const open = openSlug === s.slug && priced}
				{@const known = s.freeCount !== null && s.totalCount !== null}
				{@const fee = minuteFeeText(s.minuteFeeIsk, s.minuteFeeAfterMin)}
				<li>
					<!-- the toggle button below is the keyboard way to the same action -->
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<article
						class="card surface"
						class:clickable={priced}
						class:open
						class:with-photo={photos}
						data-testid="nearby-card"
						data-network={s.networkSlug}
						onclick={(e) => cardClick(e, s.slug, priced)}
					>
						<!-- its own grid cell: beside the name on phones, beside everything on wider screens -->
						{#if photos}
							<div class="photo">
								<StationPhoto
									slug={s.slug}
									networkSlug={s.networkSlug}
									networkName={s.networkName}
								/>
							</div>
						{/if}
						<header class="head">
							{#if !photos}
								<NetworkLogo slug={s.networkSlug} name={s.networkName} size={36} />
							{/if}
							<div class="title">
								<a class="name" href="/stod/{s.slug}">{stationDisplayName(s.name, s.networkName)}</a
								>
								<span class="sub"
									>{s.networkName}{#if s.carKw}{' · '}<span class="car-kw"
											>{m.finder_up_to({ kw: Math.round(s.carKw) })}</span
										>{/if}</span
								>
							</div>
							<span class="distance num" data-testid="distance">{formatKm(s.distanceKm)}</span>
						</header>

						<div class="facts">
							<div class="rate">
								{#if priced}
									<span class="kwh num" class:stale data-testid="price"
										>{formatIsk(s.price!)}<span class="unit">{m.price_per_kwh()}</span></span
									>
									{#if fee}<small class="fee" data-testid="minute-fee">{fee}</small>{/if}
									{#if stale && s.verifiedAt}<small class="verified stale"
											>{verifiedText(s.verifiedAt)}</small
										>{/if}
									{#if ownBrandPriceOnly(s.networkSlug)}<small title={m.tesla_price_only_title()}
											>{m.tesla_price_only()}</small
										>{/if}
								{:else}
									<!-- an unknown price must be impossible to miss, never mistaken for a cheap one -->
									<span class="price-unknown" data-testid="price-unknown"
										><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
											><circle
												cx="12"
												cy="12"
												r="9"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
											/><path
												fill="currentColor"
												d="M11 6.5h2v7h-2zM12 15.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z"
											/></svg
										>{m.nearby_price_unknown()}</span
									>
								{/if}
								<!-- the station's other kind of charging (slow beside fast, or fast beside slow) -->
								{#if s.other}<OtherPrice other={s.other} />{/if}
							</div>
							<!-- live status only where there is one; it always says how old it is -->
							{#if known}
								<div class="avail">
									<span
										><span
											class="free num"
											class:has-free={s.freeCount! > 0}
											data-testid="free-count"
											>{m.pin_free({ free: s.freeCount!, total: s.totalCount! })}</span
										><UnknownStalls
											unknown={unknownStalls(s.stallCount, s.totalCount!)}
											total={s.totalCount!}
										/></span
									>
									{#if s.availabilityFetchedAt}<small>{updatedText(s.availabilityFetchedAt)}</small
										>{/if}
								</div>
							{/if}
						</div>

						<footer class="actions">
							<DirectionsLink lat={s.lat} lng={s.lng} class="btn-sm" />
							{#if priced}
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									aria-expanded={open}
									aria-controls="full-{s.slug}"
									data-testid="explain-toggle"
									onclick={() => toggle(s.slug)}
									>{m.nearby_full_charge()}<svg
										class="chevron"
										viewBox="0 0 24 24"
										width="14"
										height="14"
										aria-hidden="true"
										><path
											fill="none"
											stroke="currentColor"
											stroke-width="2.4"
											stroke-linecap="round"
											stroke-linejoin="round"
											d="m6 9 6 6 6-6"
										/></svg
									></button
								>
							{/if}
						</footer>

						{#if priced}
							<div class="explain" id="full-{s.slug}" hidden={!open}>
								{#if open}
									{#if !battery.fromCar}
										<!-- the battery size only feeds this estimate, so it is asked for here -->
										<form
											method="GET"
											action={page.url.pathname}
											class="battery"
											data-testid="battery-form"
											data-sveltekit-noscroll
										>
											{#each kept as [k, v], i (i)}<input type="hidden" name={k} value={v} />{/each}
											<label for="battery-kwh">{m.battery_label()}</label>
											<!-- the server writes the value; in the browser it is only a default, so
											     hydration never wipes what was typed, and a new battery brings a fresh field -->
											{#key battery.typed}
												<input
													id="battery-kwh"
													type="number"
													name={BATTERY_PARAM}
													min={BATTERY_MIN_KWH}
													max={BATTERY_MAX_KWH}
													step="0.1"
													inputmode="decimal"
													value={browser ? undefined : (battery.typed ?? '')}
													defaultValue={battery.typed ?? ''}
													data-testid="battery-input"
												/>
											{/key}
											<button class="btn btn-sm">{m.battery_submit()}</button>
											{#if battery.typed !== null}<a
													class="btn btn-ghost btn-sm"
													href={href({ [BATTERY_PARAM]: null })}>{m.battery_clear()}</a
												>{/if}
										</form>
									{/if}
									{#if fc && speed}
										<div class="estimate">
											<span class="visually-hidden">{m.nearby_full_charge()}:</span>
											<strong class="num" class:stale data-testid="full-charge-cost"
												>≈ {formatEstimateIsk(fc.costIsk)}</strong
											>
											<span
												class="time num"
												title={m.nearby_charge_time()}
												data-testid="full-charge-time"
												><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
													><circle
														cx="12"
														cy="12"
														r="9"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
													/><path
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														d="M12 7v5l3 2"
													/></svg
												><span class="visually-hidden">{m.nearby_charge_time()}:</span>
												≈ {duration(fc.minutes)}</span
											>
										</div>
										<p class="basis">
											{battery.fromCar
												? m.nearby_battery_car({ kwh: formatNumber(fc.batteryKwh) })
												: m.nearby_battery_typed({ kwh: formatNumber(fc.batteryKwh) })}
										</p>
										<ChargeExplainer est={fc} {speed} {duration} hasCar={car !== null} />
									{:else if battery.kwh === null}
										<p class="basis">{m.battery_hint()}</p>
									{:else}
										<p class="basis">{m.nearby_estimate_unavailable()}</p>
									{/if}
								{/if}
							</div>
						{/if}
					</article>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.nearby {
		max-width: 44rem;
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin: -0.5rem -0.6rem 0.25rem;
	}
	h1 {
		margin-bottom: 0.85rem;
	}
	.setup {
		margin-bottom: 0.75rem;
	}
	.note {
		margin: 0 0 0.9rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.empty {
		padding: 2rem 1rem;
		color: var(--muted);
		text-align: center;
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.75rem 0.85rem;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.card.clickable {
		cursor: pointer;
	}
	.card.clickable:hover {
		border-color: var(--border-strong);
	}
	.card.open {
		border-color: var(--accent);
		box-shadow: var(--shadow);
		cursor: default;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}

	/* With a Street View photo: on phones it sits beside the name, everything else runs
	   full width under them; with more room it gets a column of its own, so the card is
	   no taller than its text */
	.card.with-photo {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-areas:
			'photo head'
			'facts facts'
			'actions actions';
		gap: 0.55rem 0.65rem;
	}
	.photo {
		grid-area: photo;
	}
	.with-photo .head {
		grid-area: head;
		align-items: flex-start;
	}
	.with-photo .facts {
		grid-area: facts;
	}
	.with-photo .actions {
		grid-area: actions;
	}
	/* a row of its own only while open: a closed one leaves no gap behind */
	.with-photo .explain {
		grid-column: 1 / -1;
	}
	@media (min-width: 641px) {
		.card.with-photo {
			grid-template-areas:
				'photo head'
				'photo facts'
				'photo actions';
			column-gap: 0.85rem;
		}
	}

	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.name {
		color: var(--text);
		font-weight: 650;
		text-decoration: none;
	}
	.name:hover {
		color: var(--accent-text);
		text-decoration: underline;
	}
	.sub {
		color: var(--muted);
		font-size: 0.82rem;
	}
	.car-kw {
		color: var(--accent-text);
		font-weight: 600;
	}
	.distance {
		flex: none;
		align-self: flex-start;
		font-weight: 700;
		white-space: nowrap;
	}

	/* the kWh price, the headline, on the left; live status on the right */
	.facts {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: 0.3rem 0.75rem;
	}
	.rate {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}
	.kwh {
		font-size: 1.3rem;
		font-weight: 750;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.unit {
		margin-left: 0.1rem;
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0;
	}
	.stale,
	.stale .unit {
		color: var(--stale);
	}
	.rate small {
		margin-top: 0.1rem;
		color: var(--muted);
		font-size: 0.8rem;
	}
	.rate small.fee {
		color: var(--text);
	}
	.rate small.stale {
		color: var(--stale);
	}
	.price-unknown {
		align-self: flex-start;
		margin-bottom: 0.15rem;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.6rem;
		border: 1px dashed var(--border-strong);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.9rem;
		font-weight: 650;
	}
	.avail {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		text-align: right;
		line-height: 1.3;
	}
	.avail small {
		margin-top: 0.15rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.free {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.8rem;
		font-weight: 650;
		white-space: nowrap;
	}
	.free.has-free {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.chevron {
		transition: transform 0.15s;
	}
	.card.open .chevron {
		transform: rotate(180deg);
	}

	/* the full-charge estimate: battery size, cost and time, and how they come about */
	.explain {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-top: 0.85rem;
		border-top: 1px solid var(--border);
	}
	.explain[hidden] {
		display: none;
	}
	.battery {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.5rem;
		margin: 0;
	}
	.battery label {
		font-size: 0.875rem;
		font-weight: 600;
	}
	.battery input[type='number'] {
		width: 5rem;
		min-height: var(--control-h-sm);
		padding: 0.2rem 0.6rem;
	}
	.estimate {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
	}
	.estimate strong {
		font-size: 1.25rem;
		font-weight: 750;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.time {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.time svg {
		color: var(--muted);
	}
	.basis {
		margin: -0.25rem 0 0;
		color: var(--muted);
		font-size: 0.82rem;
	}
	.battery + .basis {
		margin-top: 0;
	}
</style>
