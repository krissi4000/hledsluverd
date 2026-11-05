<script lang="ts">
	import { carProfile, PROFILE_HEIGHT, PROFILE_WIDTH, type CarShape } from '$lib/car-profile';

	// Side view of the car, shaped by its body style and drawn to scale from its real
	// dimensions. Always decorative: the make and model are printed next to it.
	let { car, width = 64 }: { car: CarShape; width?: number } = $props();

	const p = $derived(carProfile(car));
</script>

<svg
	class="car-silhouette"
	viewBox="0 0 {PROFILE_WIDTH} {PROFILE_HEIGHT}"
	{width}
	height={(width * PROFILE_HEIGHT) / PROFILE_WIDTH}
	aria-hidden="true"
>
	<path class="body" d={p.body} />
	<path class="glass" d={p.glass} />
	{#if p.pillar}
		<rect
			class="body"
			x={p.pillar.x}
			y={p.pillar.y}
			width={p.pillar.width}
			height={p.pillar.height}
		/>
	{/if}
	{#each p.wheels as w, i (i)}
		<circle class="tyre" cx={w.cx} cy={w.cy} r={w.r} />
		<circle class="hub" cx={w.cx} cy={w.cy} r={w.r * 0.45} />
	{/each}
</svg>

<style>
	.car-silhouette {
		flex: none;
		display: block;
		color: var(--muted);
	}
	.body {
		fill: currentColor;
	}
	.glass {
		fill: var(--surface);
		opacity: 0.6;
	}
	.tyre {
		fill: currentColor;
		/* the ring cuts a wheel arch out of the body */
		stroke: var(--surface);
		stroke-width: 0.9;
	}
	.hub {
		fill: var(--surface);
		opacity: 0.7;
	}
</style>
