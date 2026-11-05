import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { carSearchList } from '$lib/server/db/cars';
import type { RequestHandler } from './$types';

// The homepage car filter fetches this once, on first focus of the search box, so the
// ~1500-car list is not shipped with every homepage load.
export const GET: RequestHandler = async () => {
	return json(await carSearchList(db), {
		headers: { 'cache-control': 'public, max-age=3600' }
	});
};
