// The station's Street View photo for the nearby cards: a redirect to a signed Google
// URL, so the browser loads the image from Google (Google's terms allow no caching of
// imagery). 404 when there is no key, no such station, no panorama near it, Google
// can't be asked right now, or today's budget is spent; the card then keeps its logo.
// Terms: never show this image on or next to a map (see $lib/server/streetview).
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { stationLocation } from '$lib/server/db/queries';
import { DEFAULT_DAILY_BUDGET, dailyBudget, hasPanorama, photoUrl } from '$lib/server/streetview';
import type { RequestHandler } from './$types';

const DAY = 'private, max-age=86400';
const SOON = 'private, max-age=600';

let budget: ReturnType<typeof dailyBudget> | null = null;

const none = (cacheControl: string) =>
	new Response(null, { status: 404, headers: { 'cache-control': cacheControl } });

export const GET: RequestHandler = async ({ params }) => {
	const key = env.GOOGLE_MAPS_API_KEY;
	if (!key) return none(SOON);
	const at = await stationLocation(db, params.slug);
	if (!at) return none(DAY);
	const cfg = { key, signingSecret: env.GOOGLE_MAPS_SIGNING_SECRET || undefined };
	try {
		if (!(await hasPanorama(at, cfg))) return none(DAY);
	} catch {
		// bad key, quota, network: best-effort like availability, never an error page
		return none(SOON);
	}
	budget ??= dailyBudget(Number(env.GOOGLE_STREETVIEW_DAILY_BUDGET) || DEFAULT_DAILY_BUDGET);
	if (!budget.take()) return none(SOON);
	return new Response(null, {
		status: 302,
		headers: { location: photoUrl(at, cfg), 'cache-control': DAY }
	});
};
