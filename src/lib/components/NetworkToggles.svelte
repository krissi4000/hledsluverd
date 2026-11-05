<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import NetworkLogo from '$lib/components/NetworkLogo.svelte';
	import { isDefault, toggleParam } from '$lib/filter-params';

	// Each network is a toggle: green = its stations are shown, grey = hidden.
	// Plain links carrying the next URL state, so they work without JS too.
	let {
		options,
		shown,
		defaults,
		href,
		reset = true
	}: {
		options: { slug: string; name: string }[];
		shown: string[];
		defaults: string[];
		/** URL for a new param value; null drops the param (= the defaults) */
		href: (value: string | null) => string;
		/** render the "reset" control after the pills */
		reset?: boolean;
	} = $props();

	const slugs = $derived(options.map((o) => o.slug));
</script>

<span class="pills" role="group" aria-label={m.th_network()}>
	{#each options as n (n.slug)}
		{@const on = shown.includes(n.slug)}
		<a
			class="pill has-logo"
			class:active={on}
			class:off={!on}
			href={href(toggleParam(shown, n.slug, slugs, defaults))}
			data-testid="network-toggle"
			data-network={n.slug}
			data-on={on}
			data-sveltekit-noscroll
			data-sveltekit-keepfocus
			><NetworkLogo slug={n.slug} name={n.name} size={22} />{n.name}<span class="visually-hidden"
				>, {on ? m.filter_on() : m.filter_off()}</span
			></a
		>
	{/each}
</span>
{#if reset}
	{#if isDefault(shown, defaults)}
		<span class="filter-reset" aria-disabled="true">{m.filter_reset()}</span>
	{:else}
		<a
			class="filter-reset"
			href={href(null)}
			data-testid="network-reset"
			data-sveltekit-noscroll
			data-sveltekit-keepfocus>{m.filter_reset()}</a
		>
	{/if}
{/if}
