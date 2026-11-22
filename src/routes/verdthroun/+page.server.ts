import { db } from '$lib/server/db';
import { rateCard, trendSeries } from '$lib/server/db/queries';
import { shareContext } from '$lib/server/share-context';
import { homeOgImage } from '$lib/server/og/model';
import * as m from '$lib/paraglide/messages';
import type { SeoMeta } from '$lib/seo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const mode = url.searchParams.get('afl') === 'AC' ? ('AC' as const) : ('DC' as const);
	const [series, cards] = await Promise.all([trendSeries(db, mode), rateCard(db)]);
	const seo: SeoMeta = {
		title: `${m.trends_title()} — ${m.site_title()}`,
		description: m.seo_trends_description(),
		image: homeOgImage(cards, shareContext())
	};
	return { mode, series, now: Date.now(), seo };
};
