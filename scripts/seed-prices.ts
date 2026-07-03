import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createDb } from '../src/lib/server/db/client';
import { networks } from '../src/lib/server/db/schema';
import { insertPriceIfChanged, type PriceReading } from '../src/lib/server/db/prices';
import type { TariffKey } from '../src/lib/types';

const rows: {
	network: string;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk?: number;
}[] = JSON.parse(readFileSync(new URL('../seeds/prices-initial.json', import.meta.url), 'utf8'));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const nets = await db.select().from(networks);
const idBySlug = new Map(nets.map((n) => [n.slug, n.id]));

for (const r of rows) {
	const networkId = idBySlug.get(r.network);
	if (!networkId) throw new Error(`Unknown network slug: ${r.network}`);
	const reading: PriceReading = {
		networkId,
		tariffKey: r.tariffKey,
		priceIskPerKwh: r.priceIskPerKwh,
		minuteFeeIsk: r.minuteFeeIsk ?? null,
		source: 'manual'
	};
	console.log(`${r.network}/${r.tariffKey}: ${await insertPriceIfChanged(db, reading)}`);
}
await db.$client.end();
