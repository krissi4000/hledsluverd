import { asc } from 'drizzle-orm';
import type { ConnectorType } from '$lib/types';
import type { Db } from './client';
import { cars } from './schema';

export interface CarRow {
	slug: string;
	make: string;
	model: string;
	variant: string | null;
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

/** Every car, ordered for the finder's search list (shipped to the client as JSON). */
export async function carList(db: Db): Promise<CarRow[]> {
	const rows = await db
		.select()
		.from(cars)
		.orderBy(asc(cars.make), asc(cars.model), asc(cars.variant));
	return rows.map((c) => ({
		slug: c.slug,
		make: c.make,
		model: c.model,
		variant: c.variant,
		acConnector: c.acConnector,
		maxAcKw: c.maxAcKw,
		dcConnector: c.dcConnector,
		maxDcKw: c.maxDcKw
	}));
}
