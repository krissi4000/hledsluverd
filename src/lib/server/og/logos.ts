// Network logos as data URIs for the og:images, from the same files the site uses
// (src/lib/assets/networks/<slug>.svg). A network without one gets the lettered badge.

const files = import.meta.glob<string>('../../assets/networks/*.svg', {
	eager: true,
	query: '?raw',
	import: 'default'
});

const LOGOS: Record<string, string> = Object.fromEntries(
	Object.entries(files).map(([path, svg]) => [
		path.replace(/^.*\/(.+)\.svg$/, '$1'),
		`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
	])
);

export function logoDataUri(slug: string): string | null {
	return LOGOS[slug] ?? null;
}
