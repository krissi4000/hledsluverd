import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { connectors, networks, stations } from '../src/lib/server/db/schema';
import { likelyDuplicateOf, type DuplicateStation } from '../src/lib/server/duplicates';
import { parseOcm, type NetworkMatcher } from '../src/lib/server/ocm';
import { slugify } from '../src/lib/server/slug';
import { applyOverride, overridesByStation } from '../src/lib/server/stations-admin';

// Optional local POI dump (`npm run seed:ocm -- path/to/pois.json`): CI seeds the E2E
// database from e2e/fixtures/ocm-pois.json so it never depends on the live OCM API.
async function loadPois(): Promise<unknown> {
	const localPath = process.argv[2];
	if (localPath) return JSON.parse(readFileSync(localPath, 'utf8'));
	const key = process.env.OCM_API_KEY;
	if (!key) throw new Error('OCM_API_KEY missing — register free at openchargemap.org');
	// compact=false: compact mode strips nested OperatorInfo (only a top-level OperatorID
	// remains), which breaks operator matching and the matched/skipped review reports.
	const res = await fetch(
		`https://api.openchargemap.io/v3/poi?countrycode=IS&maxresults=2000&compact=false&verbose=false&key=${key}`
	);
	if (!res.ok) throw new Error(`OCM request failed: ${res.status}`);
	return res.json();
}

const pois = await loadPois();
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

const overrides = await overridesByStation(db);
// Active stations, for the duplicate guard on new POIs: OCM re-files a charger under a new
// POI id with drifted coordinates or a new title, and an exact match can't see that.
const live: DuplicateStation[] = (
	await db
		.select()
		.from(stations)
		.where(and(eq(stations.isActive, true), isNull(stations.mergedIntoId)))
).map((s) => ({ ...s, lat: s.location.y, lng: s.location.x }));

let inserted = 0,
	updated = 0,
	untouched = 0;
const held: string[] = [];
const dupes: string[] = [];
for (const d of drafts) {
	const networkId = idBySlug.get(d.networkSlug);
	if (!networkId) throw new Error(`Network not seeded: ${d.networkSlug} (run seed:networks first)`);

	// One transaction per station so a mid-run failure can't leave a station without connectors.
	await db.transaction(async (tx) => {
		const existing = await tx
			.select({ id: stations.id, mergedIntoId: stations.mergedIntoId })
			.from(stations)
			.where(sql`${stations.externalIds}->>'ocm' = ${String(d.ocmId)}`);

		let stationId: number;
		let write = d.connectors;
		if (existing.length > 0) {
			stationId = existing[0].id;
			// a duplicate merged on /admin: its OCM id only keeps it from being added again
			if (existing[0].mergedIntoId !== null) {
				untouched++;
				return;
			}
			const o = applyOverride(d, overrides.get(stationId));
			if (o.kept.length) held.push(`  ${o.name} (OCM ${d.ocmId}): kept ${o.kept.join(', ')}`);
			write = o.connectors;
			await tx
				.update(stations)
				.set({
					name: o.name,
					address: d.address,
					location: { x: d.lng, y: d.lat }
				})
				.where(eq(stations.id, stationId));
			updated++;
		} else {
			const dup = likelyDuplicateOf(
				{ id: -1, networkId, name: d.name, lat: d.lat, lng: d.lng, externalIds: { ocm: d.ocmId } },
				live
			);
			if (dup) {
				const why = dup.reasons.map((r) => (r.kind === 'shared-id' ? r.key : r.kind)).join(', ');
				dupes.push(
					`  ${d.name} (OCM ${d.ocmId}) ≈ ${dup.station.name} (#${dup.station.id}, ${Math.round(dup.distanceM)} m: ${why})`
				);
				return;
			}
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
			live.push({
				id: row.id,
				networkId,
				name: d.name,
				lat: d.lat,
				lng: d.lng,
				externalIds: { ocm: d.ocmId }
			});
			inserted++;
		}

		await tx.delete(connectors).where(eq(connectors.stationId, stationId));
		if (write.length > 0) {
			await tx.insert(connectors).values(write.map((c) => ({ stationId, ...c })));
		}
	});
}

console.log(
	`OCM seed: ${inserted} inserted, ${updated} updated, ${untouched} merged left alone, ${dupes.length} likely duplicates skipped, ${drafts.length} total.`
);
if (held.length) {
	console.log('Admin overrides kept (station_overrides; edit on /admin):');
	for (const h of held) console.log(h);
}
if (dupes.length) {
	console.log(
		'New OCM POIs not added — they look like a station we have (if one is really a separate site, add it by hand):'
	);
	for (const x of dupes) console.log(x);
}
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
