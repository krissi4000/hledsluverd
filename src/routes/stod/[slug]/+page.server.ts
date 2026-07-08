import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { stationDetail, trendSeries } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	let station = await stationDetail(db, params.slug);
	if (!station) error(404, 'Stöð finnst ekki');
	// one station, one call, never throws: worth the small wait for live availability
	if (env.TOMTOM_API_KEY && station.tomtomId) {
		const n = await refreshAvailability(
			db,
			[
				{
					stationId: station.id,
					tomtomId: station.tomtomId,
					fetchedAt: station.availability?.fetchedAt ?? null
				}
			],
			{ key: env.TOMTOM_API_KEY, maxCalls: 1 }
		);
		if (n > 0) station = (await stationDetail(db, params.slug))!;
	}
	const mode = station.connectors.some((c) => c.type !== 'Type2')
		? ('DC' as const)
		: ('AC' as const);
	const series = (await trendSeries(db, mode)).filter(
		(s) => s.networkSlug === station!.network.slug
	);
	return { station, series, now: Date.now() };
};
