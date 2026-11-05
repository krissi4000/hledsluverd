import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { connectors, networks, stations } from '../src/lib/server/db/schema';
import { ntfy } from '../src/lib/server/scrapers/runner';
import { slugify } from '../src/lib/server/slug';
import {
	SUPERCHARGE_INFO_URL,
	parseSuperchargeSites,
	planSuperchargerSync,
	superchargerDisplayName
} from '../src/lib/server/supercharge';

// Adds Iceland's Tesla Superchargers that OCM lacks and refreshes stall counts from
// supercharge.info. Run after seed:ocm (which would overwrite the connector counts).
// `npm run sync:superchargers -- --dry-run` prints the plan without writing.
// Runs daily on the server (hledsluverd-sync.timer); what needs a human goes to ntfy.
const dryRun = process.argv.includes('--dry-run');
const notices: string[] = [];

const res = await fetch(SUPERCHARGE_INFO_URL, { headers: { 'User-Agent': 'hledsluverd.is' } });
if (!res.ok) throw new Error(`supercharge.info fetch failed: HTTP ${res.status}`);
const json: unknown = await res.json();
if (!Array.isArray(json) || json.length < 1000) {
	throw new Error('supercharge.info: fewer than 1000 sites worldwide — truncated response?');
}
const sites = parseSuperchargeSites(json);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const [tesla] = await db.select().from(networks).where(eq(networks.slug, 'tesla'));
if (!tesla) throw new Error('tesla network missing — run seed:networks');
const ours = await db.select().from(stations).where(eq(stations.networkId, tesla.id));
const ourConnectors = ours.length
	? await db
			.select()
			.from(connectors)
			.where(
				inArray(
					connectors.stationId,
					ours.map((s) => s.id)
				)
			)
	: [];

const plan = planSuperchargerSync(
	sites,
	ours.map((s) => ({
		id: s.id,
		name: s.name,
		lat: s.location.y,
		lng: s.location.x,
		superchargeId: s.externalIds.supercharge
	}))
);

console.log(
	`supercharge.info: ${sites.length} open Icelandic Superchargers${dryRun ? ' (dry run)' : ''}`
);

const stallsFor = (site: (typeof sites)[number]) =>
	site.powerKw > 0 && site.stallCount > 0
		? [{ type: 'CCS2' as const, powerKw: site.powerKw, count: site.stallCount }]
		: null;

for (const { site, station, distanceM } of plan.matched) {
	const st = ours.find((s) => s.id === station.id)!;
	console.log(`MATCH  ${st.name}  ←→  ${site.name} (#${site.id}, ${Math.round(distanceM)} m)`);
	if (dryRun) continue;
	await db.transaction(async (tx) => {
		await tx
			.update(stations)
			.set({ externalIds: { ...st.externalIds, supercharge: site.id } })
			.where(eq(stations.id, st.id));
		const stalls = stallsFor(site);
		if (stalls) {
			await tx
				.delete(connectors)
				.where(and(eq(connectors.stationId, st.id), eq(connectors.type, 'CCS2')));
			await tx.insert(connectors).values(stalls.map((c) => ({ stationId: st.id, ...c })));
		}
	});
}

for (const site of plan.toInsert) {
	const name = superchargerDisplayName(site);
	console.log(
		`ADD    ${name} — ${site.street}, ${site.city} (${site.stallCount}×${site.powerKw} kW)`
	);
	notices.push(`Ný stöð: ${name} — Tesla hefur engan skrapara, settu verð á /admin`);
	if (dryRun) continue;
	await db.transaction(async (tx) => {
		let slug = slugify(`${name}-tesla`);
		const clash = await tx
			.select({ id: stations.id })
			.from(stations)
			.where(eq(stations.slug, slug));
		if (clash.length > 0) slug = `${slug}-${site.id}`;
		const [row] = await tx
			.insert(stations)
			.values({
				networkId: tesla.id,
				slug,
				name,
				address: [site.street, site.city].filter(Boolean).join(', '),
				location: { x: site.lng, y: site.lat },
				externalIds: { supercharge: site.id }
			})
			.returning({ id: stations.id });
		const stalls = stallsFor(site);
		if (stalls)
			await tx.insert(connectors).values(stalls.map((c) => ({ stationId: row.id, ...c })));
	});
}

// Destination chargers are expected here; a ≥100 kW CCS2 station means a closed or moved site.
// Deactivated stations are already reviewed.
for (const s of plan.unclaimed) {
	const fast = ourConnectors.some(
		(c) => c.stationId === s.id && c.type === 'CCS2' && c.powerKw >= 100
	);
	const active = ours.find((o) => o.id === s.id)!.isActive;
	const review = fast && active;
	console.log(
		`${review ? 'REVIEW (Supercharger with no open site — closed? deactivate on /admin)' : 'skip  '} ${s.name}`
	);
	if (review)
		notices.push(
			`Athuga: ${s.name} — ekki lengur á supercharge.info. Lokuð? Slökktu á henni á /admin`
		);
}
await db.$client.end();
if (!dryRun && notices.length > 0 && process.env.NTFY_TOPIC) {
	await ntfy(process.env.NTFY_TOPIC, `Tesla-stöðvar:\n${notices.join('\n')}`);
}
