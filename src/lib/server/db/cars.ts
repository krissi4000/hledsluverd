import { asc, desc, eq } from 'drizzle-orm';
import type { ConnectorType } from '$lib/types';
import type { Db } from './client';
import { cars } from './schema';

export interface CarRow {
	slug: string;
	make: string;
	model: string;
	variant: string | null;
	yearFrom: number | null;
	yearTo: number | null;
	batteryKwh: number | null;
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

const carRowColumns = {
	slug: cars.slug,
	make: cars.make,
	model: cars.model,
	variant: cars.variant,
	yearFrom: cars.yearFrom,
	yearTo: cars.yearTo,
	batteryKwh: cars.batteryKwh,
	acConnector: cars.acConnector,
	maxAcKw: cars.maxAcKw,
	dcConnector: cars.dcConnector,
	maxDcKw: cars.maxDcKw
};

// by make and model, newest generation first within a model
const listOrder = [asc(cars.make), asc(cars.model), desc(cars.yearFrom), asc(cars.variant)];

/** Every car, in the order the search lists them. */
export async function carList(db: Db): Promise<CarRow[]> {
	return db
		.select(carRowColumns)
		.from(cars)
		.orderBy(...listOrder);
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
			...carRowColumns,
			bodyStyle: cars.bodyStyle,
			lengthMm: cars.lengthMm,
			heightMm: cars.heightMm,
			wheelbaseMm: cars.wheelbaseMm
		})
		.from(cars)
		.orderBy(...listOrder);
}

export async function carBySlug(db: Db, slug: string): Promise<CarRow | null> {
	const [c] = await db.select(carRowColumns).from(cars).where(eq(cars.slug, slug)).limit(1);
	return c ?? null;
}
