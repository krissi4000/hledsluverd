import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(url: string) {
	// idle_timeout releases idle pool connections (dev SSR reloads orphan pools otherwise)
	const client = postgres(url, { idle_timeout: 20, max_lifetime: 60 * 30 });
	return drizzle(client, { schema });
}
export type Db = ReturnType<typeof createDb>;
