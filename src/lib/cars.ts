// Manufacturer logos for the car finder, keyed by the slugified make name.
// Logos live in src/lib/assets/cars/<key>.svg — drop a file there and it is picked up.
// A make without a logo gets a lettered badge (CarLogo), never a broken image.

const logoFiles = import.meta.glob<string>('./assets/cars/*.svg', {
	eager: true,
	query: '?url',
	import: 'default'
});

const LOGOS: Record<string, string> = Object.fromEntries(
	Object.entries(logoFiles).map(([path, url]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), url])
);

/** "Škoda" → "skoda", "Mercedes-Benz" → "mercedes-benz", "MG Motor" → "mg-motor" */
export function carMakeKey(make: string): string {
	return make
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function carLogo(make: string): string | null {
	return LOGOS[carMakeKey(make)] ?? null;
}

/** "Mercedes-Benz" → "MB", "BYD" → "BY", "Zeekr" → "ZE" */
export function carInitials(make: string): string {
	const words = make
		.trim()
		.split(/[\s-]+/)
		.filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}
