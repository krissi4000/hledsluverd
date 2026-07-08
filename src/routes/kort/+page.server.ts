import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { mapStations } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const sts = await mapStations(db);
	// Fire-and-forget: serve the cache now (age-labeled), refresh stale entries for
	// the next viewer. refreshAvailability never throws; the catch is belt-and-braces.
	if (env.TOMTOM_API_KEY) {
		const targets = sts
			.filter((s) => s.tomtomId)
			.map((s) => ({ stationId: s.id, tomtomId: s.tomtomId!, fetchedAt: s.availabilityFetchedAt }));
		refreshAvailability(db, targets, { key: env.TOMTOM_API_KEY }).catch(() => {});
	}
	return { stations: sts };
};
