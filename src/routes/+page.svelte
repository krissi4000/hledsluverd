<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import RateCard from '$lib/components/RateCard.svelte';
	import StationList from '$lib/components/StationList.svelte';
	import NearbyList from '$lib/components/NearbyList.svelte';
	import NearMeButton from '$lib/components/NearMeButton.svelte';
	import CarFilter from '$lib/components/CarFilter.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { withParams } from '$lib/url';

	let { data } = $props();

	const href = (params: Record<string, string | null>) => withParams(page.url, params);

	// Remember the chosen car: restore it once on arrival, then mirror the URL into storage
	// (choosing a car stores it, removing it from the filter forgets it).
	const CAR_KEY = 'hledsluverd:car';
	let restored = false;
	$effect(() => {
		const car = data.car;
		const hasParam = page.url.searchParams.has('bill');
		if (!restored) {
			restored = true;
			const saved = localStorage.getItem(CAR_KEY);
			if (!hasParam && saved) {
				const u = new URL(page.url);
				u.searchParams.set('bill', saved);
				goto(u.pathname + u.search, { replaceState: true, noScroll: true, keepFocus: true });
				return;
			}
		}
		if (car) localStorage.setItem(CAR_KEY, car.slug);
		else localStorage.removeItem(CAR_KEY);
	});
</script>

{#if data.nearby && data.near}
	<!-- with a position the page answers one question: where to charge near here -->
	<NearbyList
		stations={data.nearby}
		near={data.near}
		car={data.car}
		battery={data.battery}
		mode={data.mode}
		connector={data.connector}
		networks={data.networks}
		networkDefaults={data.networkDefaults}
		networkOptions={data.networkOptions}
		plateLookup={data.plateLookup}
		photos={data.streetView}
	/>
{:else}
	<div class="top">
		<section class="hero" aria-labelledby="home-title">
			<h1 id="home-title">{m.home_title()}</h1>
			<div class="actions">
				<NearMeButton class="btn-block" />
				<CarFilter car={data.car} {href} plateLookup={data.plateLookup} />
			</div>
		</section>
		<RateCard cards={data.cards} carMake={data.car?.make ?? null} />
	</div>

	<StationList
		stations={data.stations}
		mode={data.mode}
		connector={data.connector}
		networks={data.networks}
		networkDefaults={data.networkDefaults}
		networkOptions={data.networkOptions}
		hidden={data.hidden}
		car={data.car}
		search={data.search}
	/>
{/if}

<style>
	.top {
		display: grid;
		gap: 1.5rem;
	}
	.hero h1 {
		margin-bottom: 1rem;
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 28rem;
	}

	/* side by side once there is room: what to do on the left, the prices on the right */
	@media (min-width: 900px) {
		.top {
			grid-template-columns: minmax(0, 1fr) minmax(0, 27rem);
			align-items: start;
			gap: 2.5rem;
		}
		.hero {
			padding-top: 1.5rem;
		}
	}
</style>
