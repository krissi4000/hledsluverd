<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { SEARCH_MAX_LENGTH, SEARCH_PARAM } from '$lib/station-list';
	import { withParams } from '$lib/url';

	// A plain GET form, so it works without JS; Enter submits it.
	let { search }: { /** the current text search ('' = none) */ search: string } = $props();

	// the form must carry the other filters along, or searching would reset them
	const kept = $derived([...page.url.searchParams].filter(([k]) => k !== SEARCH_PARAM));
</script>

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
	<button class="go" aria-label={m.search_submit()} title={m.search_submit()}>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
			><path
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
			/></svg
		>
	</button>
	{#if search}
		<a
			class="clear"
			href={withParams(page.url, { [SEARCH_PARAM]: null })}
			aria-label={m.search_clear()}
			title={m.search_clear()}
			data-testid="search-clear"
			><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
				><path
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					d="M6 6l12 12M18 6 6 18"
				/></svg
			></a
		>
	{/if}
</form>

<style>
	.search {
		position: relative;
		display: flex;
		flex: 1 1 14rem;
		margin: 0;
		min-width: 0;
	}
	input[type='search'] {
		width: 100%;
		min-height: var(--control-h-sm);
		padding-left: 2.4rem;
		padding-right: 2.4rem;
	}
	/* the browser's own clear button would sit next to ours */
	input[type='search']::-webkit-search-cancel-button {
		display: none;
	}
	.go,
	.clear {
		position: absolute;
		top: 50%;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--muted);
		transform: translateY(-50%);
		cursor: pointer;
	}
	.go {
		left: 0.25rem;
	}
	.clear {
		right: 0.25rem;
	}
	.go:hover,
	.clear:hover {
		background: var(--surface-2);
		color: var(--text);
	}
</style>
