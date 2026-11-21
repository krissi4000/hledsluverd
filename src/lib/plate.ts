// What /bilnumer/[plate] answers, shared by the endpoint and the car search box.

import type { CarSearchRow } from '$lib/server/db/cars';

export interface PlateVehicle {
	plate: string;
	make: string;
	commercialName: string;
	color: string | null;
	firstRegYear: number | null;
	deregistered: boolean;
}

export type PlateResult =
	| { status: 'invalid' | 'not-found' | 'busy' | 'error' | 'disabled' }
	| {
			status: 'found';
			vehicle: PlateVehicle;
			match:
				| { kind: 'model' | 'make'; candidates: CarSearchRow[] }
				| { kind: 'plug-in-hybrid' | 'not-electric' | 'unknown' };
	  };

/**
 * Does a search look like a plate? Standard plates: 2 letters, a letter or digit, 2 digits
 * ("AB123", "ABC12"); spaces and dashes are ignored. Personalised plates can be any 2–6
 * letters or digits, so the search box also offers a lookup when no car matches.
 */
export function looksLikePlate(query: string): boolean {
	return /^[A-ZÁÐÉÍÓÚÝÞÆÖ]{2}[A-ZÁÐÉÍÓÚÝÞÆÖ0-9][0-9]{2}$/i.test(query.replace(/[\s-]/g, ''));
}

export function couldBePlate(query: string): boolean {
	return /^[A-ZÁÐÉÍÓÚÝÞÆÖ0-9]{2,6}$/i.test(query.replace(/[\s-]/g, ''));
}
