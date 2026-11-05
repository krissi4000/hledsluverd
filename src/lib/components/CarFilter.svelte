<script lang="ts">
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import CarLogo from '$lib/components/CarLogo.svelte';

	interface Car {
		slug: string;
		make: string;
		model: string;
		variant: string | null;
	}

	let {
		car,
		href
	}: {
		/** the car currently filtering the list, if any */
		car: Car | null;
		/** builds a link to the current page with the given query params changed */
		href: (params: Record<string, string | null>) => string;
	} = $props();

	let cars = $state<Car[] | null>(null);
	let loading = false;
	let search = $state('');
	let open = $state(false);
	let box = $state<HTMLDivElement>();

	// the list is ~1500 cars, so it is fetched on first focus instead of shipping with the page
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

	const hits = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!cars || q.length < 2) return [];
		return cars
			.filter((c) => `${c.make} ${c.model} ${c.variant ?? ''}`.toLowerCase().includes(q))
			.slice(0, 30);
	});

	function onfocusout(e: FocusEvent) {
		if (!box?.contains(e.relatedTarget as Node | null)) open = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
		} else if (e.key === 'Enter' && hits.length > 0) {
			e.preventDefault();
			goto(href({ bill: hits[0].slug }), { noScroll: true });
		} else if (e.key === 'ArrowDown' && hits.length > 0) {
			e.preventDefault();
			box?.querySelector<HTMLAnchorElement>('.hits a')?.focus();
		}
	}

	// arrow/escape handling once focus is on a result
	function onlistkeydown(e: KeyboardEvent) {
		const links = [...(box?.querySelectorAll<HTMLAnchorElement>('.hits a') ?? [])];
		const i = links.indexOf(document.activeElement as HTMLAnchorElement);
		if (e.key === 'ArrowDown' && i < links.length - 1) {
			e.preventDefault();
			links[i + 1].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (i > 0) links[i - 1].focus();
			else box?.querySelector('input')?.focus();
		} else if (e.key === 'Escape') {
			open = false;
			box?.querySelector('input')?.focus();
		}
	}
</script>

{#if car}
	<span class="pills">
		<a
			class="pill active has-logo"
			href={href({ bill: null })}
			data-sveltekit-noscroll
			aria-label={m.car_remove({ car: `${car.make} ${car.model} ${car.variant ?? ''}`.trim() })}
			data-testid="chosen-car"
		>
			<CarLogo make={car.make} size={20} />
			<span class="car-name"
				><strong>{car.make}</strong>
				{car.model}
				{#if car.variant}<span class="variant">{car.variant}</span>{/if}</span
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
			placeholder={m.finder_search()}
			aria-label={m.filter_car()}
			autocomplete="off"
			bind:value={search}
			onfocus={() => {
				open = true;
				load();
			}}
			oninput={() => (open = true)}
			{onkeydown}
			data-testid="car-search"
		/>
		{#if open && hits.length > 0}
			<ul class="hits" data-testid="car-hits">
				{#each hits as c (c.slug)}
					<li>
						<a
							href={href({ bill: c.slug })}
							data-sveltekit-noscroll
							onkeydown={onlistkeydown}
							onclick={() => (open = false)}
							><CarLogo make={c.make} size={22} /><span
								><strong>{c.make}</strong>
								{c.model} <span class="variant">{c.variant ?? ''}</span></span
							></a
						>
					</li>
				{/each}
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
		right: 0;
		z-index: 30;
		list-style: none;
		margin: 0;
		padding: 0.25rem;
		max-height: 20rem;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
	}
	.hits a {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.55rem;
		border-radius: 6px;
		color: var(--text);
		font-size: 0.9rem;
		text-decoration: none;
	}
	.hits a:hover,
	.hits a:focus-visible {
		background: var(--accent-soft);
		outline: none;
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
