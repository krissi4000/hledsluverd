import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { networks, stations } from '../src/lib/server/db/schema';
import {
	VIRTA_BASE as BASE,
	matchVirtaStation,
	type VirtaListStation
} from '../src/lib/server/scrapers/isorka';

const HEADERS = { Accept: 'application/json', 'X-Brand': 'isorka', 'X-Source': 'isorka-web-map' };
// the API rejects bboxes much larger than ~2°×6°
const TILES = [
	{ latMin: 63.2, latMax: 65.2, longMin: -24.6, longMax: -18.6 },
	{ latMin: 63.2, latMax: 65.2, longMin: -18.6, longMax: -13.4 },
	{ latMin: 65.2, latMax: 66.8, longMin: -24.6, longMax: -18.6 },
	{ latMin: 65.2, latMax: 66.8, longMin: -18.6, longMax: -13.4 }
];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);

const virta: VirtaListStation[] = [];
for (const t of TILES) {
	const url = `${BASE}/stations?latMin=${t.latMin}&latMax=${t.latMax}&longMin=${t.longMin}&longMax=${t.longMax}`;
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) throw new Error(`Virta list fetch failed: HTTP ${res.status} for ${url}`);
	virta.push(...((await res.json()) as VirtaListStation[]));
}
console.log(
	`Virta list: ${virta.length} stations, ${virta.filter((v) => v.provider === 'Virta').length} provider=Virta`
);

const [isorka] = await db.select().from(networks).where(eq(networks.slug, 'isorka'));
if (!isorka) throw new Error('isorka network missing — run seed:networks');
const ours = await db.select().from(stations).where(eq(stations.networkId, isorka.id));

let matched = 0;
const claimed = new Set<number>();
for (const s of ours) {
	const m = matchVirtaStation({ name: s.name, lat: s.location.y, lng: s.location.x }, virta);
	if (m.kind === 'unmatched') {
		const hint = m.nearby
			.map((n) => `#${n.station.id} ${n.station.name} (${Math.round(n.distanceM)} m)`)
			.join(' | ');
		console.log(`UNMATCHED (ours): ${s.name}${hint ? ` — nearby: ${hint}` : ''}`);
		if (s.externalIds.virta != null) {
			console.log(
				`  ↳ still stamped virta ${s.externalIds.virta} from an earlier run — remove with psql if wrong`
			);
		}
		continue;
	}
	if (claimed.has(m.station.id)) {
		console.log(`DUPLICATE: ${s.name} → virta ${m.station.id} already given to another station`);
	}
	claimed.add(m.station.id);
	await db
		.update(stations)
		.set({ externalIds: { ...s.externalIds, virta: m.station.id } })
		.where(eq(stations.id, s.id));
	matched++;
	const was =
		s.externalIds.virta != null && s.externalIds.virta !== m.station.id
			? ` [was ${s.externalIds.virta}]`
			: '';
	console.log(
		`${s.name}  ←→  ${m.station.name} (virta ${m.station.id}, ${Math.round(m.distanceM)} m, via ${m.via})${was}`
	);
}
console.log(`Stamped externalIds.virta on ${matched}/${ours.length} Ísorka stations.`);
await db.$client.end();
