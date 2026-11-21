import { error, fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as m from '$lib/paraglide/messages';
import { stationDetail, trendSeries } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import { ntfy } from '$lib/server/scrapers/runner';
import { createRateLimiter, submitReport } from '$lib/server/reports';
import { stationDescription } from '$lib/server/share';
import { shareContext } from '$lib/server/share-context';
import { stationOgImage } from '$lib/server/og/model';
import type { SeoMeta } from '$lib/seo';
import type { Actions, PageServerLoad } from './$types';

// In-process limits (one node process): 5 reports an hour per IP, 60 an hour in total.
// Behind Caddy the client IP comes from X-Forwarded-For (ADDRESS_HEADER in the unit).
const perIp = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
const global = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });

export const load: PageServerLoad = async ({ params }) => {
	let station = await stationDetail(db, params.slug);
	if (!station) error(404, m.station_not_found());
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
	// the network's trend says nothing about a price the site's owner sets
	const series = station.hostPriced
		? []
		: (await trendSeries(db, mode)).filter((s) => s.networkSlug === station!.network.slug);
	const ctx = shareContext();
	const seo: SeoMeta = {
		title: `${station.name} — ${m.site_title()}`,
		description: stationDescription(station, ctx),
		image: stationOgImage(station, ctx)
	};
	return { station, series, now: Date.now(), seo };
};

export const actions: Actions = {
	report: async ({ request, params, getClientAddress }) => {
		const res = await submitReport(db, params.slug, await request.formData(), getClientAddress(), {
			perIp,
			global,
			ntfyTopic: env.NTFY_TOPIC || undefined,
			notify: ntfy
		});
		if (res === 'ok') return { reported: true };
		if (res === 'not_found') error(404, 'Stöð finnst ekki');
		return fail(res === 'rate_limited' ? 429 : 400, { reportError: res });
	}
};
