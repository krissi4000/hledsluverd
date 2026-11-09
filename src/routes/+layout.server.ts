import { db } from '$lib/server/db';
import { lastPriceFetch } from '$lib/server/db/queries';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	// Footer line only: a failure here must never take a page down with it.
	let lastFetch: Date | null = null;
	try {
		lastFetch = await lastPriceFetch(db);
	} catch {
		lastFetch = null;
	}
	return { lastPriceFetch: lastFetch };
};
