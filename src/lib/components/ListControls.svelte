<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { CONNECTOR_TYPES } from '$lib/types';
	import { NETWORK_PARAM, isDefault } from '$lib/filter-params';
	import { withParams } from '$lib/url';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';
	import NetworkToggles from '$lib/components/NetworkToggles.svelte';
	import StationSearch from '$lib/components/StationSearch.svelte';

	// The row above a station list: fast/slow switch, optional text search, and the rarer
	// filters (connector, networks) folded away under "Síur". Every control is a link or
	// a GET form, so the list itself works without JS.
	let {
		mode,
		connector,
		networks,
		networkDefaults,
		networkOptions,
		search = null
	}: {
		mode: 'AC' | 'DC';
		connector: string | null;
		/** slugs of the networks shown */
		networks: string[];
		networkDefaults: string[];
		networkOptions: { slug: string; name: string }[];
		/** the text search, or null for no search box */
		search?: string | null;
	} = $props();

	const href = (params: Record<string, string | null>) => withParams(page.url, params);
	const active = $derived(
		Number(connector !== null) + Number(!isDefault(networks, networkDefaults))
	);
	// a filter in use opens the panel (on arrival too), so what narrows the list is in view
	let open = $state(untrack(() => active > 0));
	$effect.pre(() => {
		if (active > 0) open = true;
	});
</script>

<svelte:head>
	<!-- without JS the toggle can't open the panel, so it is simply always open -->
	<noscript
		><style>
			#list-filters[hidden] {
				display: flex;
			}
		</style></noscript
	>
</svelte:head>

<div class="controls">
	<div class="bar">
		<!-- phones get the short labels, so the switch and "Síur" share a line -->
		<span class="seg" role="group" aria-label={m.filter_mode()}>
			<a
				href={href({ afl: null })}
				class:active={mode === 'DC'}
				aria-current={mode === 'DC' ? 'page' : undefined}
				data-sveltekit-noscroll
				><span class="full">{m.mode_dc()}</span><span class="short">{m.mode_dc_short()}</span></a
			>
			<a
				href={href({ afl: 'AC' })}
				class:active={mode === 'AC'}
				aria-current={mode === 'AC' ? 'page' : undefined}
				data-sveltekit-noscroll
				><span class="full">{m.mode_ac()}</span><span class="short">{m.mode_ac_short()}</span></a
			>
		</span>
		{#if search !== null}<div class="search-slot"><StationSearch {search} /></div>{/if}
		<button
			type="button"
			class="btn btn-sm toggle"
			class:on={open}
			aria-expanded={open}
			aria-controls="list-filters"
			data-testid="filters-toggle"
			onclick={() => (open = !open)}
		>
			<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
				><path
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					d="M4 6h16M7 12h10M10 18h4"
				/></svg
			>
			{m.filters()}
			{#if active > 0}<span class="count" title={m.filters_active({ n: active })}>{active}</span
				>{/if}
		</button>
	</div>

	<div
		class="panel surface"
		id="list-filters"
		hidden={!open}
		data-testid="list-filters"
		data-sveltekit-noscroll
		data-sveltekit-keepfocus
	>
		<div class="group">
			<span class="label" aria-hidden="true">{m.th_connectors()}</span>
			<span class="pills" role="group" aria-label={m.th_connectors()}>
				{#each CONNECTOR_TYPES as t (t)}
					<a
						class="pill"
						href={href({ tengi: connector === t ? null : t })}
						class:active={connector === t}
						aria-current={connector === t ? 'page' : undefined}
						><ConnectorIcon type={t} size={18} />{t}</a
					>
				{/each}
			</span>
		</div>
		<div class="group">
			<span class="label" aria-hidden="true">{m.th_network()}</span>
			<NetworkToggles
				options={networkOptions}
				shown={networks}
				defaults={networkDefaults}
				href={(v) => href({ [NETWORK_PARAM]: v })}
			/>
		</div>
		{#if active > 0}
			<a
				class="btn btn-ghost btn-sm reset"
				href={href({ tengi: null, [NETWORK_PARAM]: null })}
				data-testid="filters-reset">{m.filter_reset()}</a
			>
		{/if}
	</div>
</div>

<style>
	.controls {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-bottom: 0.9rem;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	/* phones: switch and "Síur" on the first line, the search under them */
	.seg {
		flex: 1 1 auto;
	}
	.full {
		display: none;
	}
	.search-slot {
		order: 3;
		flex: 1 1 100%;
		display: flex;
	}
	.toggle {
		flex: none;
		margin-left: auto;
	}
	@media (min-width: 640px) {
		.seg {
			flex: none;
		}
		.full {
			display: inline;
		}
		.short {
			display: none;
		}
		.search-slot {
			order: 0;
			flex: 1 1 12rem;
		}
	}
	.toggle.on {
		border-color: var(--accent);
		color: var(--accent-text);
	}
	.count {
		display: grid;
		place-items: center;
		min-width: 1.2rem;
		height: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-size: 0.72rem;
		font-weight: 700;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
	}
	.panel[hidden] {
		display: none;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
	}
	.reset {
		align-self: flex-start;
	}
</style>
