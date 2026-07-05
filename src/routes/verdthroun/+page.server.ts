import { db } from '$lib/server/db';
import { trendSeries } from '$lib/server/db/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const mode = url.searchParams.get('afl') === 'AC' ? ('AC' as const) : ('DC' as const);
	return { mode, series: await trendSeries(db, mode), now: Date.now() };
};
