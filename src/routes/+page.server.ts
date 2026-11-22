import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { rateCard, stationList } from '$lib/server/db/queries';
import { carBySlug } from '$lib/server/db/cars';
import {
	carPlugForMode,
	carStationEstimate,
	effectiveKw,
	estimateFullCharge,
	fullChargeSpeed,
	maxConnectorKw,
	modeConnectors
} from '$lib/ev';
import { haversineKm } from '$lib/geo';
import { BATTERY_PARAM, parseBattery, rankNearby } from '$lib/nearby';
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
import { homeDescription } from '$lib/server/share';
import { shareContext } from '$lib/server/share-context';
import { homeOgImage } from '$lib/server/og/model';
import type { SeoMeta } from '$lib/seo';
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
	// a battery size typed in on the nearby list, for when no car (or no car data) gives one
	const typedBattery = parseBattery(url.searchParams.get(BATTERY_PARAM));

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

	// the full charge on the nearby list: the car's battery, else the size typed in
	const battery = car?.batteryKwh ?? typedBattery;
	const carMaxKw = car ? (mode === 'AC' ? car.maxAcKw : car.maxDcKw) : null;

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
			const tariff =
				s.price !== null
					? {
							priceIskPerKwh: s.price,
							minuteFeeIsk: s.minuteFeeIsk,
							minuteFeeAfterMin: s.minuteFeeAfterMin
						}
					: null;
			const est = car && tariff ? carStationEstimate(mode, car, fitting, tariff) : null;
			// 0→100 % at the plug the car (or, without one, the mode) would use
			const plugs = car ? fitting : modeConnectors(s.connectors, mode, connector);
			const speed = near ? fullChargeSpeed(mode, carMaxKw, maxConnectorKw(plugs), battery) : null;
			const fullCharge =
				speed && tariff ? estimateFullCharge(mode, tariff, speed.avgKw, battery) : null;
			return {
				...s,
				// charging speed this car actually gets here: min(car max, connector power)
				carKw: car ? effectiveKw(car, fitting) : null,
				effectivePrice: est?.effectivePrice ?? null,
				effectiveApprox: est?.effectiveApprox ?? false,
				session: est?.session ?? null,
				distanceKm: near ? haversineKm(near, s) : null,
				fullCharge,
				/** what sets the full charge's time, for the card's explanation */
				fullChargeSpeed: fullCharge ? speed : null
			};
		});
	const stations = sortStations(filtered, near ? 'distance' : car ? 'effective' : 'price');

	// With a position the page shows the nearby cards instead of the table: the nearest
	// stations, ranked by distance and price (fees folded in where the charge is known).
	const nearby = near
		? rankNearby(
				filtered.map((s) => ({
					...s,
					distanceKm: s.distanceKm!,
					rankPrice: s.fullCharge ? s.fullCharge.costIsk / s.fullCharge.billedKwh : s.price
				}))
			)
		: null;

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
			yearFrom: car.yearFrom,
			yearTo: car.yearTo,
			batteryKwh: car.batteryKwh
		},
		plateLookup: env.PLATE_LOOKUP === 'island',
		cards,
		// the table is not shown next to the nearby cards, so don't ship it
		stations: nearby ? [] : stations,
		nearby,
		battery: {
			kwh: battery,
			/** true when the size comes from the chosen car (no battery field then) */
			fromCar: car?.batteryKwh != null,
			typed: typedBattery
		},
		// the nearby cards show Google Street View photos only when a key is configured
		streetView: Boolean(env.GOOGLE_MAPS_API_KEY),
		networkOptions,
		seo: seoFor(cards)
	};
};

// Filters (?bill=, ?afl=, …) are views of the same page: the share card describes the
// whole comparison, and the canonical URL stays /.
function seoFor(cards: Awaited<ReturnType<typeof rateCard>>): SeoMeta {
	const ctx = shareContext();
	return { description: homeDescription(cards, ctx), image: homeOgImage(cards, ctx) };
}
