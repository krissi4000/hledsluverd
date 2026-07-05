import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { networks, stations } from '../src/lib/server/db/schema';

const BASE = 'https://isorka.poweredbyvirta.com/api/core/v4';
const HEADERS = { Accept: 'application/json', 'X-Brand': 'isorka', 'X-Source': 'isorka-web-map' };
// the API rejects bboxes much larger than ~2°×6°
const TILES = [
	{ latMin: 63.2, latMax: 65.2, longMin: -24.6, longMax: -18.6 },
	{ latMin: 63.2, latMax: 65.2, longMin: -18.6, longMax: -13.4 },
	{ latMin: 65.2, latMax: 66.8, longMin: -24.6, longMax: -18.6 },
	{ latMin: 65.2, latMax: 66.8, longMin: -18.6, longMax: -13.4 }
];
const MAX_DISTANCE_M = 150;

interface VirtaListStation {
	id: number;
	latitude: number;
	longitude: number;
	name: string;
	provider: string;
	isRemoved?: boolean;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);

const virta: VirtaListStation[] = [];
for (const t of TILES) {
	const url = `${BASE}/stations?latMin=${t.latMin}&latMax=${t.latMax}&longMin=${t.longMin}&longMax=${t.longMax}`;
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) throw new Error(`Virta list fetch failed: HTTP ${res.status} for ${url}`);
	virta.push(...((await res.json()) as VirtaListStation[]));
}
// roaming partners (provider "Hubject" etc.) return zeroed pricing — Ísorka network only
const own = virta.filter((v) => v.provider === 'Virta' && !v.isRemoved);
console.log(`Virta list: ${virta.length} stations, ${own.length} provider=Virta`);

const [isorka] = await db.select().from(networks).where(eq(networks.slug, 'isorka'));
if (!isorka) throw new Error('isorka network missing — run seed:networks');
const ours = await db.select().from(stations).where(eq(stations.networkId, isorka.id));

let matched = 0;
for (const s of ours) {
	let best: { v: VirtaListStation; d: number } | null = null;
	for (const v of own) {
		const d = haversineM(s.location.y, s.location.x, v.latitude, v.longitude);
		if (d <= MAX_DISTANCE_M && (!best || d < best.d)) best = { v, d };
	}
	if (!best) {
		console.log(`UNMATCHED (ours): ${s.name} — no Virta station within ${MAX_DISTANCE_M} m`);
		continue;
	}
	await db
		.update(stations)
		.set({ externalIds: { ...s.externalIds, virta: best.v.id } })
		.where(eq(stations.id, s.id));
	matched++;
	console.log(`${s.name}  ←→  ${best.v.name} (virta ${best.v.id}, ${Math.round(best.d)} m)`);
}
console.log(`Stamped externalIds.virta on ${matched}/${ours.length} Ísorka stations.`);
await db.$client.end();
