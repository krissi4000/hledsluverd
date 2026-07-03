import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type Db } from '../../src/lib/server/db/client';

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;

export async function setupTestDb(): Promise<Db> {
	const db = createDb(TEST_DB_URL!);
	await migrate(db, { migrationsFolder: './drizzle' });
	return db;
}

export async function truncateAll(db: Db) {
	await db.execute(sql`
		TRUNCATE scrape_runs, availability, prices, connectors, stations, cars, networks
		RESTART IDENTITY CASCADE
	`);
}

export async function closeTestDb(db: Db) {
	await db.$client.end();
}
