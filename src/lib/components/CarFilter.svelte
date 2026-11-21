<script lang="ts" module>
	/** the car currently filtering the list */
	export interface CarPill {
		slug: string;
		make: string;
		model: string;
		variant: string | null;
		yearFrom: number | null;
		yearTo: number | null;
	}
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import CarLogo from '$lib/components/CarLogo.svelte';
	import CarSilhouette from '$lib/components/CarSilhouette.svelte';
	import ConnectorIcon from '$lib/components/ConnectorIcon.svelte';
	import { searchCars } from '$lib/car-search';
	import { carFullName, carVariantLabel } from '$lib/car-name';
	import { couldBePlate, looksLikePlate, type PlateResult } from '$lib/plate';
	import type { CarSearchRow } from '$lib/server/db/cars';

	/** the car's plugs, fast charging first, each with its top speed when known */
	function plugs(c: CarSearchRow) {
		const out: { type: NonNullable<CarSearchRow['dcConnector']>; kw: number | null }[] = [];
		if (c.dcConnector) out.push({ type: c.dcConnector, kw: c.maxDcKw });
		if (c.acConnector) out.push({ type: c.acConnector, kw: c.maxAcKw });
		return out;
	}

	let {
		car,
		href,
		plateLookup = false
	}: {
		car: CarPill | null;
		/** builds a link to the current page with the given query params changed */
		href: (params: Record<string, string | null>) => string;
		/** offer looking a registration plate up in the vehicle registry */
		plateLookup?: boolean;
	} = $props();

	let cars = $state<CarSearchRow[] | null>(null);
	let loading = false;
	let search = $state('');
	let open = $state(false);
	let box = $state<HTMLDivElement>();
	/** the plate being looked up and, once back, what the registry said */
	let plate = $state<{ plate: string; result: PlateResult | null } | null>(null);

	// the list is several hundred cars, so it is fetched on first focus instead of shipping
	// with the page
	async function load() {
		if (cars || loading) return;
		loading = true;
		try {
			const res = await fetch('/bilar.json');
			if (res.ok) cars = await res.json();
		} finally {
			loading = false;
		}
	}

	const hits = $derived(cars ? searchCars(cars, search) : []);
	const typedPlate = $derived(search.replace(/[\s-]/g, '').toUpperCase());
	// a standard plate always gets the lookup row; a personalised one only when no car matches
	const offerPlate = $derived(
		plateLookup &&
			(looksLikePlate(search) || (couldBePlate(search) && cars !== null && hits.length === 0))
	);

	async function lookUp(p: string) {
		// the lookup row is about to disappear; keep focus (and the dropdown) in the box
		box?.querySelector('input')?.focus();
		plate = { plate: p, result: null };
		open = true;
		let result: PlateResult;
		try {
			const res = await fetch(`/bilnumer/${encodeURIComponent(p)}`);
			result = await res.json();
		} catch {
			result = { status: 'error' };
		}
		if (plate?.plate !== p) return; // the visitor typed something else meanwhile
		const only =
			result.status === 'found' &&
			result.match.kind === 'model' &&
			result.match.candidates.length === 1
				? result.match.candidates[0]
				: null;
		if (only) {
			// the registry and the year leave one car: pick it
			plate = null;
			open = false;
			goto(href({ bill: only.slug }), { noScroll: true });
		} else {
			plate = { plate: p, result };
		}
	}

	function onfocusout(e: FocusEvent) {
		if (!box?.contains(e.relatedTarget as Node | null)) open = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
		} else if (e.key === 'Enter' && offerPlate) {
			e.preventDefault();
			lookUp(typedPlate);
		} else if (e.key === 'Enter' && hits.length > 0 && !plate) {
			e.preventDefault();
			goto(href({ bill: hits[0].slug }), { noScroll: true });
		} else if (e.key === 'ArrowDown') {
			const first = box?.querySelector<HTMLElement>('.hits a, .hits button');
			if (first) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	// arrow/escape handling once focus is on a result
	function onlistkeydown(e: KeyboardEvent) {
		const items = [...(box?.querySelectorAll<HTMLElement>('.hits a, .hits button') ?? [])];
		const i = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown' && i < items.length - 1) {
			e.preventDefault();
			items[i + 1].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (i > 0) items[i - 1].focus();
			else box?.querySelector('input')?.focus();
		} else if (e.key === 'Escape') {
			open = false;
			box?.querySelector('input')?.focus();
		}
	}
</script>

{#snippet carRow(c: CarSearchRow)}
	<li>
		<a
			href={href({ bill: c.slug })}
			data-sveltekit-noscroll
			onkeydown={onlistkeydown}
			onclick={() => {
				open = false;
				plate = null;
			}}
			><CarLogo make={c.make} size={22} /><span class="hit-text"
				><span class="hit-name"
					><strong>{c.make}</strong>
					{c.model} <span class="variant">{carVariantLabel(c)}</span></span
				>
				<span class="plugs" data-testid="car-hit-plugs">
					{#each plugs(c) as p (p.type)}
						<span class="plug"
							><ConnectorIcon type={p.type} size={14} />{p.type}{#if p.kw !== null}<span class="kw"
									>{Math.round(p.kw)} kW</span
								>{/if}</span
						>
					{/each}
				</span></span
			><CarSilhouette car={c} width={88} /></a
		>
	</li>
{/snippet}

{#if car}
	<span class="pills">
		<a
			class="pill active has-logo"
			href={href({ bill: null })}
			data-sveltekit-noscroll
			aria-label={m.car_remove({ car: carFullName(car) })}
			data-testid="chosen-car"
		>
			<CarLogo make={car.make} size={20} />
			<span class="car-name"
				><strong>{car.make}</strong>
				{car.model}
				{#if carVariantLabel(car)}<span class="variant">{carVariantLabel(car)}</span>{/if}</span
			>
			<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
				><path
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					d="M6 6l12 12M18 6 6 18"
				/></svg
			>
		</a>
	</span>
{:else}
	<div class="search" bind:this={box} {onfocusout}>
		<svg class="glass" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
			><path
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
			/></svg
		>
		<input
			type="search"
			placeholder={plateLookup ? m.finder_search_plate() : m.finder_search()}
			aria-label={m.filter_car()}
			autocomplete="off"
			bind:value={search}
			onfocus={() => {
				open = true;
				load();
			}}
			oninput={() => {
				open = true;
				plate = null;
			}}
			{onkeydown}
			data-testid="car-search"
		/>
		{#if open && plate}
			<ul class="hits" data-testid="plate-result">
				{#if !plate.result}
					<li class="note" role="status">{m.plate_loading({ plate: plate.plate })}</li>
				{:else if plate.result.status === 'found'}
					{@const v = plate.result.vehicle}
					{@const match = plate.result.match}
					<li class="note registry" role="status">
						<span class="registry-car"
							><strong>{v.plate}</strong> · {v.make}
							{v.commercialName}{#if v.firstRegYear}{' '}· {v.firstRegYear}{/if}{#if v.color}{' '}·
								{v.color}{/if}{#if v.deregistered}{' '}· {m.plate_deregistered()}{/if}</span
						>
						<span class="source"
							>{m.plate_source()}{#if match.kind === 'model'}. {m.plate_variant_source()}{/if}</span
						>
					</li>
					{#if match.kind === 'model'}
						<li class="note">{m.plate_pick()}</li>
						{#each match.candidates as c (c.slug)}{@render carRow(c)}{/each}
					{:else if match.kind === 'make'}
						<li class="note">{m.plate_make_only({ model: v.commercialName })}</li>
						{#each match.candidates as c (c.slug)}{@render carRow(c)}{/each}
					{:else if match.kind === 'plug-in-hybrid'}
						<li class="note">{m.plate_phev()}</li>
					{:else if match.kind === 'not-electric'}
						<li class="note">{m.plate_not_electric()}</li>
					{:else}
						<li class="note">{m.plate_unknown({ make: v.make })}</li>
					{/if}
				{:else if plate.result.status === 'not-found'}
					<li class="note" role="status">{m.plate_not_found({ plate: plate.plate })}</li>
				{:else if plate.result.status === 'invalid'}
					<li class="note" role="status">{m.plate_invalid()}</li>
				{:else if plate.result.status === 'busy'}
					<li class="note" role="status">{m.plate_busy()}</li>
				{:else}
					<li class="note" role="status">{m.plate_error()}</li>
				{/if}
			</ul>
		{:else if open && (hits.length > 0 || offerPlate)}
			<ul class="hits" data-testid="car-hits">
				{#if offerPlate}
					<li>
						<button
							type="button"
							class="plate-row"
							onkeydown={onlistkeydown}
							onclick={() => lookUp(typedPlate)}
							data-testid="plate-lookup"
							><span class="plate" aria-hidden="true">{typedPlate}</span>{m.plate_lookup({
								plate: typedPlate
							})}</button
						>
					</li>
				{/if}
				{#each hits as c (c.slug)}{@render carRow(c)}{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.search {
		position: relative;
		flex: 1 1 16rem;
		max-width: 24rem;
		color: var(--muted);
	}
	.glass {
		position: absolute;
		left: 0.7rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}
	input[type='search'] {
		width: 100%;
		min-height: 2rem;
		padding-left: 2.1rem;
		border-radius: 999px;
		font-size: 0.875rem;
	}
	.hits {
		position: absolute;
		top: calc(100% + 0.3rem);
		left: 0;
		/* a little wider than the search box, room for the plugs and the car's side view */
		width: max(100%, min(28rem, calc(100vw - 2rem)));
		z-index: 30;
		list-style: none;
		margin: 0;
		padding: 0.25rem;
		max-height: 24rem;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
	}
	.hits a,
	.plate-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.45rem 0.55rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 0.9rem;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.hits a:hover,
	.hits a:focus-visible,
	.plate-row:hover,
	.plate-row:focus-visible {
		background: var(--accent-soft);
		outline: none;
	}
	.plate {
		flex: none;
		padding: 0.05rem 0.4rem;
		border: 1.5px solid currentColor;
		border-radius: 4px;
		font-weight: 700;
		letter-spacing: 0.04em;
		font-variant-numeric: tabular-nums;
	}
	.note {
		padding: 0.45rem 0.55rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.registry {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		color: var(--text);
		border-bottom: 1px solid var(--border);
	}
	.source {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.hit-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.plugs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.6rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.plug {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		white-space: nowrap;
	}
	.kw {
		font-variant-numeric: tabular-nums;
	}
	.kw::before {
		content: '· ';
	}
	.hits :global(.car-silhouette) {
		margin-left: auto;
	}
	.variant {
		color: var(--muted);
	}
	.pill.active .variant {
		color: inherit;
		opacity: 0.75;
	}
	.car-name {
		white-space: normal;
	}
	.pill svg {
		opacity: 0.7;
	}
</style>
