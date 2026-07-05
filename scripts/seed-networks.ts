import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createDb } from '../src/lib/server/db/client';
import { networks } from '../src/lib/server/db/schema';

const data: { name: string; slug: string; websiteUrl: string; scraperId?: string }[] = JSON.parse(
	readFileSync(new URL('../seeds/networks.json', import.meta.url), 'utf8')
);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
for (const n of data) {
	await db
		.insert(networks)
		.values({
			name: n.name,
			slug: n.slug,
			websiteUrl: n.websiteUrl,
			scraperId: n.scraperId ?? null
		})
		.onConflictDoUpdate({
			target: networks.slug,
			set: { name: n.name, websiteUrl: n.websiteUrl, scraperId: n.scraperId ?? null }
		});
}
console.log(`Seeded ${data.length} networks.`);
await db.$client.end();
