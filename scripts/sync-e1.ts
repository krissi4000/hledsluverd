import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { connectors, networks, stations } from '../src/lib/server/db/schema';
import { ntfy } from '../src/lib/server/scrapers/runner';
import { slugify } from '../src/lib/server/slug';
import { planSiteSync } from '../src/lib/server/site-sync';
import {
	E1_MATCH_M,
	E1_PUBLIC_MAP_URL,
	e1StationName,
	parseE1Locations
} from '../src/lib/server/e1map';

// Adds stations missing from OCM for networks that run on e1's platform (seeds/networks.json
// `e1PartnerIds`) and replaces their connectors with e1's, which come from the chargers
// themselves. Run after seed:ocm (which would overwrite the connectors again).
// `npm run sync:e1 -- --dry-run` prints the plan without writing.
// Runs daily on the server (hledsluverd-sync.timer); what needs a human goes to ntfy.
const dryRun = process.argv.includes('--dry-run');
const notices: string[] = [];

const seedNetworks: { slug: string; e1PartnerIds?: number[] }[] = JSON.parse(
	readFileSync(new URL('../seeds/networks.json', import.meta.url), 'utf8')
);
const targets = seedNetworks.filter((n) => n.e1PartnerIds?.length);

const res = await fetch(E1_PUBLIC_MAP_URL);
if (!res.ok) throw new Error(`e1 publicMap fetch failed: HTTP ${res.status}`);
const json: unknown = await res.json();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);

for (const target of targets) {
	const [net] = await db.select().from(networks).where(eq(networks.slug, target.slug));
	if (!net) throw new Error(`${target.slug} network missing — run seed:networks`);
	const locations = parseE1Locations(json, target.e1PartnerIds!);
	const ours = await db.select().from(stations).where(eq(stations.networkId, net.id));
	const plan = planSiteSync(
		locations,
		ours.map((s) => ({ ...s, lat: s.location.y, lng: s.location.x })),
		(s) => s.externalIds.e1,
		E1_MATCH_M
	);
	console.log(
		`\n${net.name}: ${locations.length} e1 locations, ${ours.length} stations of ours${dryRun ? ' (dry run)' : ''}`
	);

	const describe = (cs: { type: string; powerKw: number; count: number }[]) =>
		cs.map((c) => `${c.count}×${c.type} ${c.powerKw} kW`).join(', ') || 'no usable connectors';

	for (const { site, station, distanceM } of plan.matched) {
		console.log(
			`MATCH  ${station.name}  ←→  ${site.name} (e1 ${site.id}, ${Math.round(distanceM)} m) — ${describe(site.connectors)}`
		);
		if (dryRun) continue;
		await db.transaction(async (tx) => {
			await tx
				.update(stations)
				.set({ externalIds: { ...station.externalIds, e1: site.id } })
				.where(eq(stations.id, station.id));
			if (site.connectors.length === 0) return; // keep OCM's rather than leave none
			await tx.delete(connectors).where(eq(connectors.stationId, station.id));
			await tx
				.insert(connectors)
				.values(site.connectors.map((c) => ({ stationId: station.id, ...c })));
		});
	}

	for (const site of plan.toInsert) {
		const name = e1StationName(site, net.name);
		console.log(`ADD    ${name} — ${site.address} (e1 ${site.id}) — ${describe(site.connectors)}`);
		notices.push(`Ný stöð: ${name} (verð kemur með næstu skröpun)`);
		if (dryRun) continue;
		await db.transaction(async (tx) => {
			let slug = slugify(name);
			const clash = await tx
				.select({ id: stations.id })
				.from(stations)
				.where(eq(stations.slug, slug));
			if (clash.length > 0) slug = `${slug}-e1-${site.id}`;
			const [row] = await tx
				.insert(stations)
				.values({
					networkId: net.id,
					slug,
					name,
					address: site.address || null,
					location: { x: site.lng, y: site.lat },
					externalIds: { e1: site.id }
				})
				.returning({ id: stations.id });
			if (site.connectors.length > 0) {
				await tx
					.insert(connectors)
					.values(site.connectors.map((c) => ({ stationId: row.id, ...c })));
			}
		});
	}

	// deactivated stations are already reviewed
	for (const s of plan.unclaimed.filter((u) => u.isActive)) {
		notices.push(`Athuga: ${s.name} — ekki á korti e1. Lokuð? Slökktu á henni á /admin`);
		console.log(
			`REVIEW ${s.name} — not on e1's map (closed or no longer ${net.name}? deactivate on /admin)`
		);
	}
}

await db.$client.end();
if (!dryRun && notices.length > 0 && process.env.NTFY_TOPIC) {
	await ntfy(process.env.NTFY_TOPIC, `Stöðvar frá e1:\n${notices.join('\n')}`);
}
