// Looks a registration plate up in the Icelandic vehicle registry (ökutækjaskrá) through
// island.is's public vehicle search, the same no-login lookup as
// https://island.is/uppfletting-i-oekutaekjaskra. Browsers cannot call it from another
// site (its CORS preflight allows no content-type header, and its GraphQL server rejects
// requests without one), so the lookup runs on our server.
//
// What the public lookup returns (all 18 fields of its PublicVehicleInfoDto): plate and
// permanent number, VIN, make, commercial name, colour, first and Icelandic registration
// dates, status, next inspection, NEDC/WLTP CO2 and weighted CO2, mass, laden mass, CO and a
// "type number" (the VIN's first 8 characters plus a 4-digit type-record number). There is
// no fuel type, trim, battery or motor power. We ask only for what the car match needs. The
// VIN's prefix and the registration date are what tell the variant (plate-variants.ts); the
// VIN's serial number is dropped as soon as the answer is parsed.

import { vinKey } from './plate-variants';

const ENDPOINT = 'https://island.is/api/graphql';
const QUERY = `query publicVehicleSearch($input: GetPublicVehicleSearchInput!) {
  publicVehicleSearch(input: $input) {
    permno vin make vehicleCommercialName color firstRegDate newRegDate vehicleStatus
    co2 weightedCo2 co2WLTP weightedCo2WLTP
  }
}`;

export interface RegistryVehicle {
	plate: string;
	/** as registered, upper case: "KIA", "MERCEDES-BENZ" */
	make: string;
	/** as registered, upper case and often shorter than the marketing name: "XC40", "2008" */
	commercialName: string;
	color: string | null;
	/** year of first registration anywhere (imports keep their foreign date) */
	firstRegYear: number | null;
	/** date it was registered in Iceland as a new car (YYYY-MM-DD); null for a used import */
	registeredNewOn: string | null;
	/** first 8 VIN characters + the model-year character; the rest of the VIN is not kept */
	vinKey: string | null;
	deregistered: boolean;
	/** WLTP figure, else NEDC; null when none is recorded (electric cars, and very old cars) */
	co2: number | null;
	/** plug-in hybrids only */
	weightedCo2: number | null;
}

/**
 * "ab 123" / "AB-123" → "AB123". Standard plates are 2 letters + a letter or digit + 2
 * digits; personalised plates (einkanúmer) are 2–6 letters or digits. Null if neither.
 */
export function normalizePlate(input: string): string | null {
	const plate = input.toUpperCase().replace(/[\s-]/g, '');
	return /^[A-ZÁÐÉÍÓÚÝÞÆÖ0-9]{2,6}$/.test(plate) ? plate : null;
}

function int(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Parses the GraphQL response; null = no such plate. Throws on anything unexpected. */
export function parseRegistryResponse(body: unknown): RegistryVehicle | null {
	const b = body as {
		errors?: { message?: string }[];
		data?: { publicVehicleSearch?: Record<string, unknown> | null };
	};
	if (b?.errors?.length) throw new Error(`island.is: ${b.errors[0]?.message ?? 'error'}`);
	if (!b?.data || !('publicVehicleSearch' in b.data)) {
		throw new Error('island.is: unexpected response shape');
	}
	const v = b.data.publicVehicleSearch;
	if (!v) return null;
	if (typeof v.permno !== 'string' || typeof v.make !== 'string') {
		throw new Error('island.is: vehicle without plate or make');
	}
	const first = typeof v.firstRegDate === 'string' ? v.firstRegDate.slice(0, 10) : '';
	const year = Number(first.slice(0, 4));
	// newRegDate is the registration in Iceland; it equals firstRegDate unless the car came
	// to Iceland used
	const inIceland = typeof v.newRegDate === 'string' ? v.newRegDate.slice(0, 10) : '';
	return {
		plate: v.permno,
		make: v.make.trim(),
		commercialName:
			typeof v.vehicleCommercialName === 'string' ? v.vehicleCommercialName.trim() : '',
		color: typeof v.color === 'string' && v.color.trim() ? v.color.trim() : null,
		firstRegYear: Number.isInteger(year) && year > 1900 ? year : null,
		registeredNewOn:
			/^\d{4}-\d{2}-\d{2}$/.test(inIceland) && inIceland === first ? inIceland : null,
		vinKey: typeof v.vin === 'string' ? vinKey(v.vin) : null,
		deregistered: v.vehicleStatus === 'Afskráð',
		co2: int(v.co2WLTP) ?? int(v.co2),
		weightedCo2: int(v.weightedCo2WLTP) ?? int(v.weightedCo2)
	};
}

export async function fetchRegistryVehicle(
	plate: string,
	fetchFn: typeof fetch = fetch
): Promise<RegistryVehicle | null> {
	const res = await fetchFn(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({
			operationName: 'publicVehicleSearch',
			query: QUERY,
			variables: { input: { search: plate } }
		}),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`island.is: HTTP ${res.status}`);
	return parseRegistryResponse(await res.json());
}
