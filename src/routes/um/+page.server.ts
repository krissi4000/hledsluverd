import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { networks } from '$lib/server/db/schema';
import { priceSources } from '$lib/server/price-sources';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const nets = await db.select().from(networks);
	return {
		// derived from networks.scraper_id + the registered scrapers, not hand-written
		sources: priceSources(nets),
		// CONTACT_EMAIL in .env; unset = the page points only to the report form
		contactEmail: env.CONTACT_EMAIL?.trim() || null
	};
};
