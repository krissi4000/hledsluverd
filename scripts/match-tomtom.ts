import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { stations } from '../src/lib/server/db/schema';
import { haversineKm } from '../src/lib/geo';

const KEY = process.env.TOMTOM_API_KEY;
const MAX_DIST_M = 120;

interface NearbyResult {
	poi?: { name?: string };
	position: { lat: number; lon: number };
	dataSources?: { chargingAvailability?: { id: string } };
}

async function nearby(lat: number, lon: number): Promise<NearbyResult[]> {
	const url =
		`https://api.tomtom.com/search/2/nearbySearch/.json?key=${encodeURIComponent(KEY!)}` +
		`&lat=${lat}&lon=${lon}&radius=300&limit=20`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`nearbySearch HTTP ${res.status}`);
	const body = (await res.json()) as { results?: NearbyResult[] };
	return body.results ?? [];
}

async function main() {
	if (!KEY) throw new Error('TOMTOM_API_KEY missing from .env');
	const db = createDb(process.env.DATABASE_URL!);
	const sts = await db.select().from(stations).where(eq(stations.isActive, true));
	let stamped = 0;
	let kept = 0;
	let unmatched = 0;
	let ambiguous = 0;
	for (const s of sts) {
		if (s.externalIds.tomtom) {
			kept++;
			continue;
		}
		const here = { lat: s.location.y, lng: s.location.x };
		// only EV-charging POIs carry a chargingAvailability dataSource — that filter
		// self-selects chargers, no category id needed
		const candidates = (await nearby(here.lat, here.lng))
			.filter((r) => r.dataSources?.chargingAvailability?.id)
			.map((r) => ({
				id: r.dataSources!.chargingAvailability!.id,
				name: r.poi?.name ?? '?',
				distM: Math.round(haversineKm(here, { lat: r.position.lat, lng: r.position.lon }) * 1000)
			}))
			.filter((c) => c.distM <= MAX_DIST_M);
		if (candidates.length === 1) {
			await db
				.update(stations)
				.set({ externalIds: { ...s.externalIds, tomtom: candidates[0].id } })
				.where(eq(stations.id, s.id));
			console.log(
				`STAMP ${s.slug} ← ${candidates[0].id} (${candidates[0].distM} m, "${candidates[0].name}")`
			);
			stamped++;
		} else if (candidates.length === 0) {
			console.log(`UNMATCHED ${s.slug} — no charging POI within ${MAX_DIST_M} m`);
			unmatched++;
		} else {
			console.log(
				`AMBIGUOUS ${s.slug} — ${candidates.length} charging POIs within ${MAX_DIST_M} m:`
			);
			for (const c of candidates) console.log(`   ${c.id}  ${c.distM} m  "${c.name}"`);
			ambiguous++;
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	console.log(
		`\n${stamped} stamped, ${kept} already stamped, ${unmatched} unmatched, ` +
			`${ambiguous} ambiguous — of ${sts.length} active stations`
	);
	await db.$client.end();
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
