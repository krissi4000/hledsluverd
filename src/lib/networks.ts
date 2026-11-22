// Brand assets per network, keyed by networks.slug. Logos live in
// src/lib/assets/networks/<slug>.svg — drop a file there and it is picked up.
// A network without a logo gets a lettered badge (NetworkLogo), never a broken image.

const logoFiles = import.meta.glob<string>('./assets/networks/*.svg', {
	eager: true,
	query: '?url',
	import: 'default'
});

const LOGOS: Record<string, string> = Object.fromEntries(
	Object.entries(logoFiles).map(([path, url]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), url])
);

/** Brand colours, for chart lines and fallback badges. Tesla's red is too close
 * to N1's, so it gets its dark brand grey instead. */
const COLORS: Record<string, string> = {
	on: '#ff6e00',
	isorka: '#3565d2',
	n1: '#ee313a',
	e1: '#009345',
	orkan: '#f4058e',
	tesla: '#3e4047'
};

const FALLBACK_COLORS = ['#0f766e', '#7c3aed', '#b45309', '#0369a1', '#be123c'];

export function networkLogo(slug: string): string | null {
	return LOGOS[slug] ?? null;
}

export function networkColor(slug: string, index = 0): string {
	return COLORS[slug] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/** "Orka náttúrunnar" → "ON", "Ísorka" → "ÍS" — for networks without a logo file. */
export function networkInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** Networks whose shown price is the member price for their own brand's cars
 * (Tesla's app price). Other cars may pay more, so the UI labels it. */
const OWN_BRAND_PRICED = new Set(['tesla']);

export function ownBrandPriceOnly(slug: string): boolean {
	return OWN_BRAND_PRICED.has(slug);
}

/**
 * The network that gets the "cheapest" claim: lowest DC price among networks every
 * car can pay. Own-brand-only prices (Tesla's app price) never win: they are not a
 * price most drivers can get. Ties go to the earlier entry, so on the rate card's
 * sorted list this is the first eligible card. Used by the rate card badge, the meta
 * descriptions and the share images, so they always name the same network.
 */
export function cheapestDc<T extends { networkSlug: string; dc: number | null }>(
	cards: readonly T[]
): T | null {
	let best: T | null = null;
	for (const c of cards) {
		if (c.dc === null || ownBrandPriceOnly(c.networkSlug)) continue;
		if (best === null || c.dc < best.dc!) best = c;
	}
	return best;
}
