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
