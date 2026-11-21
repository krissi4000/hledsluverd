import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { notInArray } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { cars } from '../src/lib/server/db/schema';
import { parseCarSeeds } from '../src/lib/server/car-seeds';

// Syncs the cars table with seeds/cars.json: upserts every entry by slug and deletes cars
// no longer in the file. Idempotent; re-run after editing the file.
async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL missing');
	const seeds = parseCarSeeds(
		JSON.parse(readFileSync(new URL('../seeds/cars.json', import.meta.url), 'utf8'))
	);
	const db = createDb(url);
	const removed = await db.transaction(async (tx) => {
		for (const c of seeds) {
			await tx.insert(cars).values(c).onConflictDoUpdate({ target: cars.slug, set: c });
		}
		return tx
			.delete(cars)
			.where(
				notInArray(
					cars.slug,
					seeds.map((c) => c.slug)
				)
			)
			.returning({ slug: cars.slug });
	});
	for (const r of removed) console.log(`REMOVED ${r.slug}`);
	console.log(`cars: ${seeds.length} upserted, ${removed.length} removed`);
	await db.$client.end();
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
