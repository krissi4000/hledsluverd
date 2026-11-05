<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	// The grey "?/14" next to a live count that covers only part of a site (see
	// $lib/availability). Renders nothing when every stall has a live status.
	let { unknown, total }: { unknown: number; total: number } = $props();

	const explain = $derived(m.avail_partial({ total, all: total + unknown, unknown }));
</script>

{#if unknown > 0}
	<span class="unknown-stalls num" data-testid="unknown-stalls" title={explain}
		><span aria-hidden="true">?/{unknown}</span><span class="visually-hidden">{explain}</span></span
	>
{/if}

<style>
	.unknown-stalls {
		display: inline-block;
		margin-left: 0.25rem;
		padding: 0 0.45rem;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.875rem;
		font-weight: 650;
		vertical-align: middle;
		cursor: help;
	}
</style>
