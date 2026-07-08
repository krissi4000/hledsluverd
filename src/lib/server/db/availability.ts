import type { ConnectorType } from '$lib/types';
import type { Db } from './client';
import { availability } from './schema';

export interface AvailabilityEntry {
	stationId: number;
	freeCount: number | null;
	totalCount: number | null;
	perType: Partial<Record<ConnectorType, { free: number; total: number }>> | null;
	fetchedAt: Date;
	source: string;
}

/** Latest-only cache: one row per station, overwritten on every refresh. */
export async function upsertAvailability(
	db: Db,
	entry: Omit<AvailabilityEntry, 'fetchedAt'> & { fetchedAt?: Date }
): Promise<void> {
	const row = { ...entry, fetchedAt: entry.fetchedAt ?? new Date() };
	await db
		.insert(availability)
		.values(row)
		.onConflictDoUpdate({
			target: availability.stationId,
			set: {
				freeCount: row.freeCount,
				totalCount: row.totalCount,
				perType: row.perType,
				fetchedAt: row.fetchedAt,
				source: row.source
			}
		});
}

export async function availabilityAll(db: Db): Promise<AvailabilityEntry[]> {
	const rows = await db.select().from(availability);
	return rows.map((r) => ({
		stationId: r.stationId,
		freeCount: r.freeCount,
		totalCount: r.totalCount,
		perType: r.perType,
		fetchedAt: r.fetchedAt,
		source: r.source
	}));
}
