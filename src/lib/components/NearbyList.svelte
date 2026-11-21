<script lang="ts">
	// "Nálægt mér" results: the nearest stations as cards, ranked by distance and price
	// ($lib/nearby). Each card shows the distance, the price and what a full charge
	// costs; pressing it opens how that cost and time come about (hidden by default).
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import type { FullChargeEstimate, FullChargeSpeed } from '$lib/ev';
	import {
		ageParts,
		formatDate,
		formatEstimateIsk,
		formatIsk,
		formatNumber,
		isStale
	} from '$lib/format';
	import { formatKm } from '$lib/geo';
	import { BATTERY_MAX_KWH, BATTERY_MIN_KWH, BATTERY_PARAM, NEARBY_COUNT } from '$lib/nearby';
	import { ownBrandPriceOnly } from '$lib/networks';
	import { unknownStalls } from '$lib/availability';
	import type { StationRow } from '$lib/server/db/queries';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import UnknownStalls from '$lib/components/UnknownStalls.svelte';
	import DirectionsLink from '$lib/components/DirectionsLink.svelte';
	import ChargeExplainer from '$lib/components/ChargeExplainer.svelte';
	import StationPhoto from '$lib/components/StationPhoto.svelte';

	let {
		stations,
		hasCar,
		battery,
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
		/** a car is chosen: its own power limits apply, not the no-car assumptions */
		hasCar: boolean;
		battery: { kwh: number | null; fromCar: boolean; typed: number | null };
		/** show Google Street View photos (a key is configured) */
		photos?: boolean;
	} = $props();

	/** the card whose explanation is open (one at a time, like a map app's list) */
	let openSlug = $state<string | null>(null);
	/** cards whose "why an average?" note is open */
	let infoOpen = $state<Record<string, boolean>>({});

	function duration(min: number): string {
		return min < 90
			? m.duration_min({ n: Math.round(min) })
			: m.duration_h({ h: formatNumber(Math.round(min / 6) / 10) });
	}

	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min'
			? m.age_min({ n: p.n })
			: p.unit === 'h'
				? m.age_h({ n: p.n })
				: m.age_d({ n: p.n });
	}

	const pct = (share: number) => Math.round(share * 100);

	// the battery form is a plain GET form: it carries the other filters along
	const kept = $derived([...page.url.searchParams].filter(([k]) => k !== BATTERY_PARAM));
	const clearBattery = $derived.by(() => {
		const u = new URL(page.url);
		u.searchParams.delete(BATTERY_PARAM);
		return u.pathname + u.search;
	});

	function toggle(slug: string) {
		openSlug = openSlug === slug ? null : slug;
	}

	// Pressing anywhere on a card opens its explanation, except on the links and buttons in
	// it. Keyboard and screen-reader users get the same through the card's toggle button.
	function cardClick(e: MouseEvent, slug: string, canOpen: boolean) {
		if (!canOpen) return;
		if ((e.target as Element).closest('a, button, input, form, .explain')) return;
		toggle(slug);
	}
</script>

<div class="nearby" data-testid="nearby-list">
	<div class="intro">
		<p class="note">{m.nearby_note({ n: NEARBY_COUNT })}</p>
		{#if battery.kwh !== null}
			<p class="note">
				{battery.fromCar
					? m.nearby_battery_car({ kwh: formatNumber(battery.kwh) })
					: m.nearby_battery_typed({ kwh: formatNumber(battery.kwh) })}
			</p>
		{/if}
		{#if !battery.fromCar}
			<form method="GET" action={page.url.pathname} class="battery" data-testid="battery-form">
				{#each kept as [k, v], i (i)}<input type="hidden" name={k} value={v} />{/each}
				<label for="battery-kwh">{m.battery_label()}</label>
				<input
					id="battery-kwh"
					type="number"
					name={BATTERY_PARAM}
					min={BATTERY_MIN_KWH}
					max={BATTERY_MAX_KWH}
					step="0.1"
					inputmode="decimal"
					value={battery.typed ?? ''}
					data-testid="battery-input"
				/>
				<button class="btn btn-sm">{m.battery_submit()}</button>
				{#if battery.typed !== null}<a class="filter-reset" href={clearBattery}
						>{m.battery_clear()}</a
					>{/if}
				{#if battery.kwh === null}<p class="hint">{m.battery_hint()}</p>{/if}
			</form>
		{/if}
	</div>

	{#if stations.length === 0}
		<p class="empty surface">{m.no_results()}</p>
	{:else}
		<ol class="cards">
			{#each stations as s (s.slug)}
				{@const fc = s.fullCharge}
				{@const stale = s.verifiedAt !== null && isStale(s.verifiedAt)}
				{@const speed = s.fullChargeSpeed}
				{@const open = openSlug === s.slug && fc !== null}
				<li>
					<!-- the toggle button below is the keyboard way to the same action -->
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<article
						class="card surface"
						class:clickable={fc !== null}
						class:open
						data-testid="nearby-card"
						data-network={s.networkSlug}
						onclick={(e) => cardClick(e, s.slug, fc !== null)}
					>
						<header class="head" class:with-photo={photos}>
							{#if photos}
								<StationPhoto
									slug={s.slug}
									networkSlug={s.networkSlug}
									networkName={s.networkName}
								/>
							{:else}
								<NetworkLogo slug={s.networkSlug} name={s.networkName} size={40} />
							{/if}
							<div class="title">
								<a class="name" href="/stod/{s.slug}">{s.name}</a>
								<span class="sub"
									>{s.networkName}{#if s.carKw}{' · '}<span class="car-kw"
											>{m.finder_up_to({ kw: Math.round(s.carKw) })}</span
										>{/if}</span
								>
							</div>
							<span class="distance num" data-testid="distance">{formatKm(s.distanceKm)}</span>
						</header>

						<div class="facts">
							<div class="price-block">
								{#if s.price !== null}
									<strong class="price num" class:stale data-testid="price"
										>{formatIsk(s.price)}<span class="unit">/kWh</span></strong
									>
									{#if s.minuteFeeIsk}<small class="fee"
											>{s.minuteFeeAfterMin
												? m.minute_fee_after({
														fee: formatNumber(s.minuteFeeIsk),
														min: s.minuteFeeAfterMin
													})
												: m.minute_fee({ fee: formatNumber(s.minuteFeeIsk) })}</small
										>{/if}
									{#if stale && s.verifiedAt}<small class="verified stale"
											>{m.verified_on({ date: formatDate(s.verifiedAt) })}</small
										>{/if}
									{#if ownBrandPriceOnly(s.networkSlug)}<small
											class="brand-only"
											title={m.tesla_price_only_title()}>{m.tesla_price_only()}</small
										>{/if}
								{:else}
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
							</div>
							<div class="avail-block">
								<span class="label">{m.th_free()}</span>
								{#if s.freeCount !== null && s.totalCount !== null}
									<span>
										<span
											class="avail num"
											class:has-free={s.freeCount > 0}
											data-testid="free-count">{s.freeCount}/{s.totalCount}</span
										><UnknownStalls
											unknown={unknownStalls(s.stallCount, s.totalCount)}
											total={s.totalCount}
										/>
									</span>
									{#if s.availabilityFetchedAt}<small class="verified"
											>{age(s.availabilityFetchedAt)}</small
										>{/if}
								{:else}<span class="muted">—</span>{/if}
							</div>
						</div>

						<div class="full">
							<span class="label">{m.nearby_full_charge()}</span>
							{#if s.price === null}
								<span class="muted">{m.nearby_price_unknown_note()}</span>
							{:else if fc}
								<span class="full-value">
									<strong class="num" class:stale data-testid="full-charge-cost"
										>≈ {formatEstimateIsk(fc.costIsk)}</strong
									>
									<span class="num" data-testid="full-charge-time">· ≈ {duration(fc.minutes)}</span>
									<button
										type="button"
										class="info"
										aria-expanded={infoOpen[s.slug] ?? false}
										aria-controls="avg-info-{s.slug}"
										aria-label={m.nearby_info_label()}
										title={m.nearby_info_label()}
										data-testid="avg-info"
										onclick={() => (infoOpen[s.slug] = !infoOpen[s.slug])}
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
												d="M11 10.5h2V17h-2zM12 6.8a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z"
											/></svg
										></button
									>
								</span>
							{:else}
								<span class="muted" data-testid="full-charge-unknown">{m.nearby_unknown()}</span>
							{/if}
						</div>
						{#if fc}
							<p class="info-text" id="avg-info-{s.slug}" hidden={!infoOpen[s.slug]}>
								{m.nearby_info({ kw: Math.round(fc.avgKw) })}
								{#if !hasCar}{m.nearby_info_no_car()}{/if}
								{m.nearby_info_loss({ loss: pct(fc.loss) })}
							</p>
						{/if}

						<footer class="actions">
							<DirectionsLink lat={s.lat} lng={s.lng} class="btn-sm" />
							{#if fc}
								<button
									type="button"
									class="toggle"
									aria-expanded={open}
									aria-controls="explain-{s.slug}"
									data-testid="explain-toggle"
									onclick={() => toggle(s.slug)}
									>{open ? m.explain_hide() : m.explain_show()}<svg
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

						{#if fc && speed}
							<div class="explain" id="explain-{s.slug}" hidden={!open}>
								{#if open}
									<ChargeExplainer est={fc} {speed} {duration} />
								{/if}
							</div>
						{/if}
					</article>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.nearby {
		max-width: 48rem;
	}
	.intro {
		margin-bottom: 1rem;
	}
	.note {
		margin: 0 0 0.35rem;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.battery {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
		margin: 0.6rem 0 0;
	}
	.battery label {
		font-size: 0.85rem;
		font-weight: 600;
	}
	.battery input[type='number'] {
		width: 6.5rem;
		min-height: 2rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.9rem;
	}
	.hint {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.82rem;
		color: var(--muted);
	}
	.empty {
		color: var(--muted);
		padding: 2rem 1rem;
		text-align: center;
	}

	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0.9rem 1rem;
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
		gap: 0.75rem;
	}
	/* name and distance line up with the top of the photo */
	.head.with-photo {
		align-items: flex-start;
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
		font-size: 0.95rem;
		white-space: nowrap;
	}

	.facts {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.price-block {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.price {
		font-size: 1.15rem;
		font-weight: 700;
	}
	.unit {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--muted);
	}
	.price.stale,
	.price.stale .unit {
		color: var(--stale);
	}
	small {
		display: block;
	}
	.fee {
		font-size: 0.78rem;
	}
	.brand-only {
		font-size: 0.75rem;
		color: var(--muted);
	}
	/* an unknown price must be impossible to miss, never mistaken for a cheap one */
	.price-unknown {
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
	.avail-block {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		text-align: right;
		white-space: nowrap;
	}
	.label {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.avail {
		display: inline-block;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-weight: 650;
		font-size: 0.875rem;
	}
	.avail.has-free {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	.full {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
	}
	.full-value {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.full-value strong {
		font-size: 1rem;
	}
	.full-value strong.stale {
		color: var(--stale);
	}
	.info {
		display: inline-grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.info:hover,
	.info[aria-expanded='true'] {
		background: var(--surface-2);
		color: var(--text);
	}
	.info-text {
		margin: -0.3rem 0 0;
		padding: 0.55rem 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.info-text[hidden] {
		display: none;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	/* a quiet text button: the explanation is there for whoever wants it */
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 2rem;
		padding: 0 0.25rem;
		border: none;
		background: none;
		color: var(--accent-text);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.toggle:hover {
		text-decoration: underline;
	}
	.toggle .chevron {
		transition: transform 0.15s;
	}
	.card.open .toggle .chevron {
		transform: rotate(180deg);
	}

	.explain {
		padding-top: 0.85rem;
		border-top: 1px solid var(--border);
	}
	.explain[hidden] {
		display: none;
	}

	@media (max-width: 640px) {
		.card {
			padding: 0.8rem 0.85rem;
		}
	}
</style>
