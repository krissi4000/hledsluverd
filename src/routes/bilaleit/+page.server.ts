import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { carList } from '$lib/server/db/cars';
import { mapStations } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [cars, stations] = await Promise.all([carList(db), mapStations(db)]);
	if (env.TOMTOM_API_KEY) {
		const targets = stations
			.filter((s) => s.tomtomId)
			.map((s) => ({ stationId: s.id, tomtomId: s.tomtomId!, fetchedAt: s.availabilityFetchedAt }));
		refreshAvailability(db, targets, { key: env.TOMTOM_API_KEY }).catch(() => {});
	}
	return { cars, stations };
};
