import { db } from '$lib/server/db';
import { rateCard } from '$lib/server/db/queries';
import { homeOgModel } from '$lib/server/og/model';
import { ogImageResponse } from '$lib/server/og/respond';
import type { RequestHandler } from './$types';

// og:image for /, /kort and /verdthroun: the cheapest DC price per network today.
export const GET: RequestHandler = (event) =>
	ogImageResponse(event, async (ctx) => homeOgModel(await rateCard(db), ctx));
