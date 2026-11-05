import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { networks, stations } from '../src/lib/server/db/schema';
import { N1_UA, N1_URL, matchN1Location, parseN1Locations } from '../src/lib/server/scrapers/n1';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);

const res = await fetch(N1_URL, { headers: N1_UA });
if (!res.ok) throw new Error(`N1 fetch failed: HTTP ${res.status}`);
const locations = parseN1Locations(await res.text());
const usable = locations.filter((l) => /_(service|self)$/.test(l.value));
console.log(`N1 locations: ${locations.length} total, ${usable.length} service/self`);

const [n1] = await db.select().from(networks).where(eq(networks.slug, 'n1'));
if (!n1) throw new Error('n1 network missing — run seed:networks');
const ours = await db.select().from(stations).where(eq(stations.networkId, n1.id));

for (const s of ours) {
	const m = matchN1Location(s, locations);
	if (m.kind === 'match') {
		await db
			.update(stations)
			.set({ externalIds: { ...s.externalIds, n1: m.location.value } })
			.where(eq(stations.id, s.id));
		console.log(`${s.name}  ←→  ${m.location.label} (${m.location.value}, via ${m.via})`);
	} else if (m.kind === 'unmatched') {
		console.log(`UNMATCHED (ours): ${s.name} — ${s.address ?? ''}`);
	} else {
		console.log(
			`AMBIGUOUS (skipped, via ${m.via}): ${s.name} → ${m.candidates.map((c) => c.label).join(' | ')}`
		);
	}
}
console.log('Review the lines above; fix any wrong stamp with psql (external_ids is plain jsonb).');
await db.$client.end();
