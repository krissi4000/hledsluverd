import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { and, eq, ne } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { connectors, networks, stations } from '../src/lib/server/db/schema';
import { ntfy } from '../src/lib/server/scrapers/runner';
import { VIRTA_BASE, virtaFetch } from '../src/lib/server/scrapers/isorka';
import { slugify } from '../src/lib/server/slug';
import {
	VIRTA_TILES,
	parseVirtaClassification,
	parseVirtaList,
	planVirtaSync
} from '../src/lib/server/virta';

// Adds the Virta sites seeds/virta-sites.json classifies as "own" or "host" as Ísorka
// stations, sets their host_priced flag and replaces their connectors with Virta's.
// Prices come with the next scrape (the isorka scraper prices every stamped station).
// Run after seed:ocm (which would overwrite the connectors again).
// `npm run sync:virta -- --dry-run` prints the plan without writing.
// Runs daily on the server (hledsluverd-sync.timer); what needs a human goes to ntfy.
const dryRun = process.argv.includes('--dry-run');
const notices: string[] = [];

const classes = parseVirtaClassification(
	JSON.parse(readFileSync(new URL('../seeds/virta-sites.json', import.meta.url), 'utf8'))
);

const tiles: unknown[] = [];
for (const t of VIRTA_TILES) {
	const url = `${VIRTA_BASE}/stations?latMin=${t.latMin}&latMax=${t.latMax}&longMin=${t.longMin}&longMax=${t.longMax}`;
	const res = await virtaFetch(url);
	if (!res.ok) throw new Error(`Virta list fetch failed: HTTP ${res.status} for ${url}`);
	tiles.push(await res.json());
}
const sites = parseVirtaList(tiles);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const [net] = await db.select().from(networks).where(eq(networks.slug, 'isorka'));
if (!net) throw new Error('isorka network missing — run seed:networks');
const withLatLng = <S extends { location: { x: number; y: number } }>(s: S) => ({
	...s,
	lat: s.location.y,
	lng: s.location.x
});
const ours = (await db.select().from(stations).where(eq(stations.networkId, net.id))).map(
	withLatLng
);
const others = (
	await db
		.select()
		.from(stations)
		.where(and(ne(stations.networkId, net.id), eq(stations.isActive, true)))
).map(withLatLng);
const plan = planVirtaSync(sites, classes, ours, others);

console.log(
	`Virta: ${sites.length} live public sites, ${ours.length} Ísorka stations of ours${dryRun ? ' (dry run)' : ''}`
);
const describe = (cs: { type: string; powerKw: number; count: number }[]) =>
	cs.map((c) => `${c.count}×${c.type} ${c.powerKw} kW`).join(', ') || 'no usable connectors';
const label = (siteId: number) => classes.get(siteId)?.status ?? 'unclassified';

for (const { site, station, distanceM, hostPriced } of plan.matched) {
	const flag =
		hostPriced != null && hostPriced !== station.hostPriced
			? ` [host_priced ${station.hostPriced} → ${hostPriced}]`
			: '';
	const was =
		station.externalIds.virta != null && station.externalIds.virta !== site.id
			? ` [was virta ${station.externalIds.virta}]`
			: '';
	console.log(
		`MATCH  ${station.name}  ←→  ${site.name} (virta ${site.id}, ${Math.round(distanceM)} m, ${label(site.id)})${flag}${was} — ${describe(site.connectors)}`
	);
	if (classes.get(site.id)?.status === 'skip') {
		console.log(
			`  ↳ classified skip but stamped on our station — wrong stamp? fix with psql, or deactivate on /admin`
		);
	}
	if (dryRun) continue;
	await db.transaction(async (tx) => {
		await tx
			.update(stations)
			.set({
				externalIds: { ...station.externalIds, virta: site.id },
				...(hostPriced != null ? { hostPriced } : {})
			})
			.where(eq(stations.id, station.id));
		if (site.connectors.length === 0) return; // keep OCM's rather than leave none
		await tx.delete(connectors).where(eq(connectors.stationId, station.id));
		await tx
			.insert(connectors)
			.values(site.connectors.map((c) => ({ stationId: station.id, ...c })));
	});
}

for (const { site, hostPriced } of plan.toInsert) {
	console.log(
		`ADD    ${site.name} — ${site.address} (virta ${site.id}, ${label(site.id)}) — ${describe(site.connectors)}`
	);
	notices.push(`Ný stöð: ${site.name} (verð kemur með næstu skröpun)`);
	if (dryRun) continue;
	await db.transaction(async (tx) => {
		let slug = slugify(site.name);
		const clash = await tx
			.select({ id: stations.id })
			.from(stations)
			.where(eq(stations.slug, slug));
		if (clash.length > 0) slug = `${slug}-virta-${site.id}`;
		const [row] = await tx
			.insert(stations)
			.values({
				networkId: net.id,
				slug,
				name: site.name,
				address: site.address || null,
				location: { x: site.lng, y: site.lat },
				externalIds: { virta: site.id },
				hostPriced
			})
			.returning({ id: stations.id });
		if (site.connectors.length > 0) {
			await tx.insert(connectors).values(site.connectors.map((c) => ({ stationId: row.id, ...c })));
		}
	});
}

for (const { site, station, distanceM } of plan.conflicts) {
	console.log(
		`CONFLICT ${site.name} (virta ${site.id}, ${label(site.id)}) — ${Math.round(distanceM)} m from ${station.name} of another network; not added. Wrong network on our station?`
	);
	notices.push(`Athuga: ${site.name} (Virta) er ofan á ${station.name} — rangt net á stöðinni?`);
}

for (const site of plan.unclassified) {
	console.log(
		`NEW    ${site.name} — ${site.address} (virta ${site.id}) — not in seeds/virta-sites.json; classify own/host/skip`
	);
	notices.push(`Ný Virta-stöð: ${site.name} (${site.id}) — flokka í seeds/virta-sites.json`);
}

for (const s of plan.vanished) {
	console.log(
		`REVIEW ${s.name} — virta ${s.externalIds.virta} is gone from Virta's map (deactivate on /admin?)`
	);
	notices.push(`Athuga: ${s.name} — horfin af korti Virta. Lokuð? Slökktu á henni á /admin`);
}

await db.$client.end();
if (!dryRun && notices.length > 0 && process.env.NTFY_TOPIC) {
	await ntfy(process.env.NTFY_TOPIC, `Stöðvar frá Virta (Ísorka):\n${notices.join('\n')}`);
}
