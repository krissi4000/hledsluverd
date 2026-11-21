// Stamps each station's Google Maps place ID (externalIds.google), for the Google photos
// on the /kort station card. Searches only stations without one, so re-running after new
// stations sync in is cheap; stamps (by this script or by hand) are never overwritten.
//
//   npm run match:google -- --dry-run   # print what it would stamp, write nothing
//   npm run match:google
//
// Needs GOOGLE_PLACES_API_KEY (Places API (New)). Matching is by distance alone, see
// src/lib/server/google-places.ts for why. Settle AMBIGUOUS and CLASH lines by hand
// (docs/deploy.md): open the links, pick the right place, stamp it with psql.
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { stations } from '../src/lib/server/db/schema';
import {
	MATCH_RADIUS_M,
	chargingPlacesNear,
	exclusivePicks,
	mapsLink,
	pickPlace,
	type PlaceCandidate
} from '../src/lib/server/google-places';

const KEY = process.env.GOOGLE_PLACES_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

const where = (c: PlaceCandidate) => `${c.id}  ${c.distM} m  ${mapsLink(c)}`;

async function main() {
	if (!KEY) throw new Error('GOOGLE_PLACES_API_KEY missing from .env');
	const db = createDb(process.env.DATABASE_URL!);
	try {
		await matchAll(db, KEY);
	} finally {
		await db.$client.end();
	}
}

async function matchAll(db: ReturnType<typeof createDb>, key: string) {
	const sts = await db.select().from(stations).where(eq(stations.isActive, true));
	const stamped = new Map(
		sts.flatMap((s) => (s.externalIds.google ? [[s.externalIds.google, s.slug] as const] : []))
	);
	const todo = sts.filter((s) => !s.externalIds.google);

	const picks: { id: number; slug: string; placeId: string; line: string }[] = [];
	let unmatched = 0;
	let ambiguous = 0;
	for (const s of todo) {
		const here = { lat: s.location.y, lng: s.location.x };
		const m = pickPlace(here, await chargingPlacesNear(here, key));
		if (m.kind === 'match') {
			const why = m.why === 'only' ? 'the only one' : 'clearly the nearest';
			picks.push({
				id: s.id,
				slug: s.slug,
				placeId: m.place.id,
				line: `${where(m.place)} (${why})`
			});
		} else if (m.kind === 'none') {
			console.log(`UNMATCHED ${s.slug} — no Google charging place within ${MATCH_RADIUS_M} m`);
			unmatched++;
		} else {
			console.log(`AMBIGUOUS ${s.slug} — ${m.candidates.length} Google charging places:`);
			for (const c of m.candidates) console.log(`   ${where(c)}`);
			ambiguous++;
		}
		await new Promise((r) => setTimeout(r, 100));
	}

	const { stamp, clash } = exclusivePicks(picks, stamped);
	for (const p of clash) {
		console.log(`CLASH ${p.slug} — its place is also ${p.with.join(', ')}'s: ${p.line}`);
	}
	for (const p of stamp) {
		if (!DRY_RUN) {
			await db
				.update(stations)
				// merged in SQL, so ids another script stamped meanwhile survive
				.set({
					externalIds: sql`${stations.externalIds} || jsonb_build_object('google', ${p.placeId}::text)`
				})
				.where(eq(stations.id, p.id));
		}
		console.log(`${DRY_RUN ? 'WOULD STAMP' : 'STAMP'} ${p.slug} ← ${p.line}`);
	}
	console.log(
		`\n${stamp.length} ${DRY_RUN ? 'to stamp (dry run, nothing written)' : 'stamped'}, ` +
			`${sts.length - todo.length} already stamped, ${unmatched} unmatched, ${ambiguous} ambiguous, ` +
			`${clash.length} clashing — of ${sts.length} active stations`
	);
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
