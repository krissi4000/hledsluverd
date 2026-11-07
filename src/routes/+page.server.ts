import { db } from '$lib/server/db';
import { rateCard, stationList } from '$lib/server/db/queries';
import { carBySlug } from '$lib/server/db/cars';
import { carPlugForMode, carStationEstimate, effectiveKw } from '$lib/ev';
import { haversineKm } from '$lib/geo';
import {
	NEAR_PARAM,
	SEARCH_PARAM,
	matchesSearch,
	parseNear,
	parseSearch,
	sortStations
} from '$lib/station-list';
import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';
import { NETWORK_PARAM, defaultNetworks, parseShown } from '$lib/filter-params';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const mode = url.searchParams.get('afl') === 'AC' ? ('AC' as const) : ('DC' as const);
	const tengi = url.searchParams.get('tengi');
	const connector = (CONNECTOR_TYPES as readonly string[]).includes(tengi ?? '')
		? (tengi as ConnectorType)
		: null;
	const carSlug = url.searchParams.get('bill');
	const search = parseSearch(url.searchParams.get(SEARCH_PARAM));
	// the visitor's position, only ever present after they pressed "Nálægt mér"
	const near = parseNear(url.searchParams.get(NEAR_PARAM));

	const [cards, allStations, car] = await Promise.all([
		rateCard(db),
		stationList(db, mode),
		carSlug ? carBySlug(db, carSlug) : null
	]);
	// the car only fits a row through its plug for the mode whose price the row shows
	const carPlug = car ? carPlugForMode(car, mode) : null;

	// filter options come from the stations in view, not the rate card — most networks
	// have stations long before they have verified prices
	const networkOptions = [...new Map(allStations.map((s) => [s.networkSlug, s.networkName]))]
		.map(([slug, name]) => ({ slug, name }))
		.sort((a, b) => a.name.localeCompare(b.name, 'is'));
	const slugs = networkOptions.map((n) => n.slug);
	const networkDefaults = defaultNetworks(slugs, car?.make);
	const networks = parseShown(url.searchParams.get(NETWORK_PARAM), slugs, networkDefaults);

	const filtered = allStations
		.filter(
			(s) =>
				(!connector || s.connectors.some((c) => c.type === connector)) &&
				networks.includes(s.networkSlug) &&
				(!car || s.connectors.some((c) => c.type === carPlug)) &&
				matchesSearch(search, [s.name, s.address])
		)
		.map((s) => {
			const fitting = s.connectors.filter((c) => c.type === carPlug);
			const est =
				car && s.price !== null
					? carStationEstimate(mode, car, fitting, {
							priceIskPerKwh: s.price,
							minuteFeeIsk: s.minuteFeeIsk,
							minuteFeeAfterMin: s.minuteFeeAfterMin
						})
					: null;
			return {
				...s,
				// charging speed this car actually gets here: min(car max, connector power)
				carKw: car ? effectiveKw(car, fitting) : null,
				effectivePrice: est?.effectivePrice ?? null,
				effectiveApprox: est?.effectiveApprox ?? false,
				session: est?.session ?? null,
				distanceKm: near ? haversineKm(near, s) : null
			};
		});
	const stations = sortStations(filtered, near ? 'distance' : car ? 'effective' : 'price');

	return {
		mode,
		connector,
		networks,
		networkDefaults,
		search,
		near,
		car: car && {
			slug: car.slug,
			make: car.make,
			model: car.model,
			variant: car.variant,
			batteryNetKwh: car.batteryNetKwh
		},
		cards,
		stations,
		networkOptions
	};
};
