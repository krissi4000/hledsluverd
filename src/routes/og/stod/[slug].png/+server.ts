import { db } from '$lib/server/db';
import { stationDetail } from '$lib/server/db/queries';
import { stationOgModel } from '$lib/server/og/model';
import { ogImageResponse } from '$lib/server/og/respond';
import type { RequestHandler } from './$types';

// og:image for /stod/[slug]. Reads cached availability-free station data only:
// no TomTom call, since crawlers fetch this.
export const GET: RequestHandler = (event) =>
	ogImageResponse(event, async (ctx) => {
		const st = await stationDetail(db, event.params.slug);
		return st && stationOgModel(st, ctx);
	});
