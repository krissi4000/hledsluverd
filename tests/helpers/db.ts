import 'dotenv/config';
import { getTableName, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../src/lib/server/db/schema';
import { createDb, type Db } from '../../src/lib/server/db/client';

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;

export async function setupTestDb(): Promise<Db> {
	if (!TEST_DB_URL) {
		throw new Error('DATABASE_URL_TEST not set — guard suites with describe.skipIf(!TEST_DB_URL)');
	}
	if (!/test/i.test(TEST_DB_URL)) {
		throw new Error(`Refusing destructive test helpers against non-test database: ${TEST_DB_URL}`);
	}
	const db = createDb(TEST_DB_URL);
	await migrate(db, { migrationsFolder: './drizzle' });
	return db;
}

export async function truncateAll(db: Db) {
	const tables = Object.values(schema)
		.filter((t) => t instanceof PgTable)
		.map((t) => `"${getTableName(t as any)}"`);
	await db.execute(sql.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`));
}

export async function closeTestDb(db: Db) {
	await db.$client.end();
}
