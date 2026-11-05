import { asc, eq } from 'drizzle-orm';
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

/** What the car search needs: enough to find and label a car, show its plugs and draw it. */
export interface CarSearchRow extends CarRow {
	bodyStyle: string | null;
	lengthMm: number | null;
	heightMm: number | null;
	wheelbaseMm: number | null;
}

export async function carSearchList(db: Db): Promise<CarSearchRow[]> {
	return db
		.select({
			slug: cars.slug,
			make: cars.make,
			model: cars.model,
			variant: cars.variant,
			acConnector: cars.acConnector,
			maxAcKw: cars.maxAcKw,
			dcConnector: cars.dcConnector,
			maxDcKw: cars.maxDcKw,
			bodyStyle: cars.bodyStyle,
			lengthMm: cars.lengthMm,
			heightMm: cars.heightMm,
			wheelbaseMm: cars.wheelbaseMm
		})
		.from(cars)
		.orderBy(asc(cars.make), asc(cars.model), asc(cars.variant));
}

export async function carBySlug(db: Db, slug: string): Promise<CarRow | null> {
	const [c] = await db.select().from(cars).where(eq(cars.slug, slug)).limit(1);
	if (!c) return null;
	return {
		slug: c.slug,
		make: c.make,
		model: c.model,
		variant: c.variant,
		acConnector: c.acConnector,
		maxAcKw: c.maxAcKw,
		dcConnector: c.dcConnector,
		maxDcKw: c.maxDcKw
	};
}
