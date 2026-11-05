<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import RateCard from '$lib/components/RateCard.svelte';
	import StationTable from '$lib/components/StationTable.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { data } = $props();

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

<svelte:head>
	<title>{m.site_title()} — {m.site_tagline()}</title>
	<meta name="description" content={m.site_tagline()} />
</svelte:head>

<RateCard cards={data.cards} />
<StationTable
	stations={data.stations}
	mode={data.mode}
	connector={data.connector}
	network={data.network}
	networkOptions={data.networkOptions}
	car={data.car}
/>
