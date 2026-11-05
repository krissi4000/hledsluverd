// Kept apart from cars.ts (which globs logo files through Vite) so plain-Node scripts
// and the silhouette code can use it too.

/** "Škoda" → "skoda", "Mercedes-Benz" → "mercedes-benz", "MG Motor" → "mg-motor" */
export function carMakeKey(make: string): string {
	return make
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}
