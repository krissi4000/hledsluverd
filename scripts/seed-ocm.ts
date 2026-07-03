import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { connectors, networks, stations } from '../src/lib/server/db/schema';
import { parseOcm, type NetworkMatcher } from '../src/lib/server/ocm';
import { slugify } from '../src/lib/server/slug';

const key = process.env.OCM_API_KEY;
if (!key) throw new Error('OCM_API_KEY missing — register free at openchargemap.org');

// compact=false: compact mode strips nested OperatorInfo (only a top-level OperatorID
// remains), which breaks operator matching and the matched/skipped review reports.
const res = await fetch(
	`https://api.openchargemap.io/v3/poi?countrycode=IS&maxresults=2000&compact=false&verbose=false&key=${key}`
);
if (!res.ok) throw new Error(`OCM request failed: ${res.status}`);
const pois = await res.json();
if (!Array.isArray(pois))
	throw new Error(`OCM response is not a POI array: ${JSON.stringify(pois).slice(0, 200)}`);
if (pois.length >= 2000)
	throw new Error('OCM result truncated at maxresults=2000 — raise the limit');

const seedNetworks: (NetworkMatcher & { name: string })[] = JSON.parse(
	readFileSync(new URL('../seeds/networks.json', import.meta.url), 'utf8')
);
const { drafts, skipped, matched, titleMatched, duplicates } = parseOcm(pois, seedNetworks);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const dbNetworks = await db.select().from(networks);
const idBySlug = new Map(dbNetworks.map((n) => [n.slug, n.id]));

let inserted = 0,
	updated = 0;
for (const d of drafts) {
	const networkId = idBySlug.get(d.networkSlug);
	if (!networkId) throw new Error(`Network not seeded: ${d.networkSlug} (run seed:networks first)`);

	// One transaction per station so a mid-run failure can't leave a station without connectors.
	await db.transaction(async (tx) => {
		const existing = await tx
			.select({ id: stations.id })
			.from(stations)
			.where(sql`${stations.externalIds}->>'ocm' = ${String(d.ocmId)}`);

		let stationId: number;
		if (existing.length > 0) {
			stationId = existing[0].id;
			await tx
				.update(stations)
				.set({
					name: d.name,
					address: d.address,
					location: { x: d.lng, y: d.lat }
				})
				.where(eq(stations.id, stationId));
			updated++;
		} else {
			let slug = slugify(`${d.name}-${d.networkSlug}`);
			const clash = await tx
				.select({ id: stations.id })
				.from(stations)
				.where(eq(stations.slug, slug));
			if (clash.length > 0) slug = `${slug}-${d.ocmId}`;
			const [row] = await tx
				.insert(stations)
				.values({
					networkId,
					slug,
					name: d.name,
					address: d.address,
					location: { x: d.lng, y: d.lat },
					externalIds: { ocm: d.ocmId }
				})
				.returning({ id: stations.id });
			stationId = row.id;
			inserted++;
		}

		await tx.delete(connectors).where(eq(connectors.stationId, stationId));
		if (d.connectors.length > 0) {
			await tx.insert(connectors).values(d.connectors.map((c) => ({ stationId, ...c })));
		}
	});
}

console.log(`OCM seed: ${inserted} inserted, ${updated} updated, ${drafts.length} total.`);
console.log('Matched operators (verify each mapping; backfill ids for ones matched via title):');
for (const m of matched)
	console.log(`  ${m.operator} (OCM id ${m.operatorId}) → ${m.slug} [${m.via}]`);
console.log(
	'Station-title matches on unattributed POIs (verify each station belongs to its network):'
);
for (const t of titleMatched) console.log(`  ${t.station} (OCM ${t.ocmId}) → ${t.slug}`);
console.log('Re-import duplicates dropped (same network, title and coordinates):');
for (const d of duplicates)
	console.log(`  ${d.station} → kept OCM ${d.keptOcmId}, dropped ${d.droppedOcmIds.join(', ')}`);
console.log(
	'Skipped operators (review — add ids/matchers to seeds/networks.json if any belong to our networks):'
);
for (const s of skipped.sort((a, b) => b.count - a.count))
	console.log(`  ${s.count}× ${s.operator}`);
await db.$client.end();
