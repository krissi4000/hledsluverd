import { db } from '$lib/server/db';
import { rateCard, stationList } from '$lib/server/db/queries';
import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const mode = url.searchParams.get('afl') === 'AC' ? ('AC' as const) : ('DC' as const);
	const tengi = url.searchParams.get('tengi');
	const connector = (CONNECTOR_TYPES as readonly string[]).includes(tengi ?? '')
		? (tengi as ConnectorType)
		: null;
	const rawNetwork = url.searchParams.get('fyrirtaeki');

	const [cards, allStations] = await Promise.all([rateCard(db), stationList(db, mode)]);

	// filter options come from the stations in view, not the rate card — most networks
	// have stations long before they have verified prices
	const networkOptions = [...new Map(allStations.map((s) => [s.networkSlug, s.networkName]))]
		.map(([slug, name]) => ({ slug, name }))
		.sort((a, b) => a.name.localeCompare(b.name, 'is'));
	const network = networkOptions.some((n) => n.slug === rawNetwork) ? rawNetwork : null;

	const stations = allStations.filter(
		(s) =>
			(!connector || s.connectors.some((c) => c.type === connector)) &&
			(!network || s.networkSlug === network)
	);

	return {
		mode,
		connector,
		network,
		cards,
		stations,
		networkOptions
	};
};
