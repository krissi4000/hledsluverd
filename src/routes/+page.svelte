<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import RateCard from '$lib/components/RateCard.svelte';
	import StationTable from '$lib/components/StationTable.svelte';

	let { data } = $props();
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
/>
