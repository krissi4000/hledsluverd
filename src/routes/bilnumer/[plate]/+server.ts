import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { carSearchList } from '$lib/server/db/cars';
import { lookupPlate } from '$lib/server/plate-lookup';
import { matchRegistryVehicle } from '$lib/server/plate-match';
import { normalizePlate } from '$lib/server/vehicle-registry';
import type { PlateResult } from '$lib/plate';
import type { RequestHandler } from './$types';

// Plate → the cars it could be, for the homepage car search. Off unless PLATE_LOOKUP=island
// (see docs/deploy.md: the registry is public, but reuse by a website is a grey area).
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	const reply = (body: PlateResult, status = 200) =>
		json(body, { status, headers: { 'cache-control': 'private, no-store' } });

	if (env.PLATE_LOOKUP !== 'island') return reply({ status: 'disabled' }, 404);
	const plate = normalizePlate(params.plate);
	if (!plate) return reply({ status: 'invalid' }, 400);

	let lookup;
	try {
		lookup = await lookupPlate(plate, { client: getClientAddress() });
	} catch (e) {
		// the plate itself is not logged
		console.error('plate lookup failed:', e instanceof Error ? e.message : e);
		return reply({ status: 'error' }, 502);
	}
	if (lookup.status === 'busy') return reply({ status: 'busy' }, 429);
	const vehicle = lookup.vehicle;
	if (!vehicle) return reply({ status: 'not-found' });

	return reply({
		status: 'found',
		vehicle: {
			plate: vehicle.plate,
			make: vehicle.make,
			commercialName: vehicle.commercialName,
			color: vehicle.color,
			firstRegYear: vehicle.firstRegYear,
			deregistered: vehicle.deregistered
		},
		match: matchRegistryVehicle(vehicle, await carSearchList(db))
	});
};
