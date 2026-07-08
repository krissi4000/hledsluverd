import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createDb } from '../src/lib/server/db/client';
import { cars } from '../src/lib/server/db/schema';
import { parseOpenEvData, type OpenEvVehicle } from '../src/lib/server/cars-import';

// Pinned release — bump deliberately, re-run to refresh (upserts by slug).
const DATASET_URL =
	'https://github.com/open-ev-data/open-ev-data-dataset/releases/download/v1.24.0/open-ev-data-v1.24.0.json';

async function loadDataset(): Promise<{ vehicles: OpenEvVehicle[] }> {
	const localPath = process.argv[2];
	if (localPath) return JSON.parse(readFileSync(localPath, 'utf8'));
	const res = await fetch(DATASET_URL, { redirect: 'follow' });
	if (!res.ok) throw new Error(`dataset download failed: HTTP ${res.status}`);
	return (await res.json()) as { vehicles: OpenEvVehicle[] };
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL missing');
	const db = createDb(url);
	const parsed = parseOpenEvData(await loadDataset());
	let upserted = 0;
	let conflicts = 0;
	for (const c of parsed.cars) {
		try {
			await db
				.insert(cars)
				.values(c)
				.onConflictDoUpdate({ target: cars.slug, set: { ...c } });
			upserted++;
		} catch (e) {
			// The slug conflict is handled by onConflictDoUpdate, so the only expected
			// throw is the (make, model, variant) unique violation (SQLSTATE 23505) —
			// a duplicate across distinct unique_codes. Skip those, keep the first.
			// Anything else is a real failure: fail loud rather than exit 0 silently.
			if ((e as { code?: string }).code !== '23505') throw e;
			conflicts++;
			console.warn(`SKIP ${c.slug}: duplicate (make, model, variant)`);
		}
	}
	for (const w of parsed.warnings) console.warn(`WARN ${w}`);
	console.log(
		`cars: ${upserted} upserted, ${conflicts} constraint conflicts skipped, ` +
			`${parsed.skippedNonEuropean} non-European skipped, ` +
			`${parsed.skippedNoMappedPorts} without usable ports skipped`
	);
	await db.$client.end();
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
