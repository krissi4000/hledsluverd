import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { mapStations, rateCard } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import { shareContext } from '$lib/server/share-context';
import { homeOgImage } from '$lib/server/og/model';
import * as m from '$lib/paraglide/messages';
import type { SeoMeta } from '$lib/seo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [sts, cards] = await Promise.all([mapStations(db), rateCard(db)]);
	// Fire-and-forget: serve the cache now (age-labeled), refresh stale entries for
	// the next viewer. refreshAvailability never throws; the catch is belt-and-braces.
	if (env.TOMTOM_API_KEY) {
		const targets = sts
			.filter((s) => s.tomtomId)
			.map((s) => ({ stationId: s.id, tomtomId: s.tomtomId!, fetchedAt: s.availabilityFetchedAt }));
		refreshAvailability(db, targets, { key: env.TOMTOM_API_KEY }).catch(() => {});
	}
	const seo: SeoMeta = {
		title: `${m.map_title()} — ${m.site_title()}`,
		description: m.seo_map_description(),
		image: homeOgImage(cards, shareContext())
	};
	return {
		stations: sts,
		// browser key for the station card's Google photos (Places UI Kit); null = none
		googleMapsKey: env.GOOGLE_MAPS_BROWSER_KEY || null,
		seo
	};
};
