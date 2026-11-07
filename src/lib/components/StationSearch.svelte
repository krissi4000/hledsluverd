<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { NEAR_PARAM, SEARCH_MAX_LENGTH, SEARCH_PARAM, formatNear } from '$lib/station-list';

	let {
		search,
		near,
		href
	}: {
		/** the current text search ('' = none) */
		search: string;
		/** set when the list is sorted by distance from the visitor */
		near: { lat: number; lng: number } | null;
		/** builds a link to the current page with the given query params changed */
		href: (params: Record<string, string | null>) => string;
	} = $props();

	// "Nálægt mér" needs JS (the Geolocation API); until hydration the button stays inert
	let ready = $state(false);
	onMount(() => (ready = true));
	let locating = $state(false);
	let geoError = $state<string | null>(null);

	// the GET form must carry the other filters along, or searching would reset them
	const kept = $derived([...page.url.searchParams].filter(([k]) => k !== SEARCH_PARAM));

	// Only ever called from a click: the browser asks for permission then, never on load.
	function locate() {
		geoError = null;
		if (!('geolocation' in navigator)) {
			geoError = m.near_unsupported();
			return;
		}
		locating = true;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				locating = false;
				// rounded to ~100 m before it goes into the URL (and so into any server log)
				const value = formatNear({ lat: pos.coords.latitude, lng: pos.coords.longitude });
				goto(href({ [NEAR_PARAM]: value }), { noScroll: true, keepFocus: true });
			},
			(err) => {
				locating = false;
				geoError = err.code === 1 ? m.near_denied() : m.near_unavailable();
			},
			{ enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 }
		);
	}
</script>

<div class="filter-row">
	<span class="filter-label" aria-hidden="true">{m.filter_search()}</span>
	<div class="search-row">
		<form method="GET" action={page.url.pathname} role="search" class="search">
			{#each kept as [k, v], i (i)}<input type="hidden" name={k} value={v} />{/each}
			<input
				type="search"
				name={SEARCH_PARAM}
				value={search}
				maxlength={SEARCH_MAX_LENGTH}
				placeholder={m.search_placeholder()}
				aria-label={m.search_label()}
				data-testid="station-search"
			/>
			<button class="btn btn-sm">{m.search_submit()}</button>
			{#if search}<a class="filter-reset" href={href({ [SEARCH_PARAM]: null })}
					>{m.search_clear()}</a
				>{/if}
		</form>

		{#if near}
			<a
				class="pill active"
				href={href({ [NEAR_PARAM]: null })}
				aria-label={m.near_clear()}
				data-testid="near-active"
				>{m.near_me()}
				<span aria-hidden="true">×</span></a
			>
		{:else}
			<button
				type="button"
				class="pill"
				onclick={locate}
				disabled={!ready || locating}
				data-testid="near-me">{locating ? m.near_locating() : m.near_me()}</button
			>
		{/if}
	</div>
	{#if geoError}<p class="geo-error" role="alert">{geoError}</p>{/if}
</div>

<style>
	.search-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
	}
	.search input[type='search'] {
		width: 14rem;
		max-width: 60vw;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: 0.9rem;
	}
	button.pill {
		font: inherit;
		font-size: inherit;
		cursor: pointer;
	}
	button.pill:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.geo-error {
		flex-basis: 100%;
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: var(--danger);
	}
</style>
