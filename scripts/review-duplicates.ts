import 'dotenv/config';
import { createDb } from '../src/lib/server/db/client';
import { ntfy } from '../src/lib/server/scrapers/runner';
import { duplicateCandidates, markNotified } from '../src/lib/server/stations-admin';

// Lists likely duplicate stations (same network, same spot or name; see duplicates.ts) and
// pushes the ones no note has mentioned yet to ntfy. Nothing is merged here: a human
// merges or dismisses each pair on /admin. Runs daily after the syncs (sync-stations.sh).
// `npm run review:duplicates -- --dry-run` lists without notifying.
const dryRun = process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const candidates = await duplicateCandidates(db);

const why = (c: (typeof candidates)[number]) =>
	c.reasons
		.map((r) =>
			r.kind === 'shared-id'
				? `sama ${r.key}-auðkenni`
				: r.kind === 'same-name'
					? 'sama nafn'
					: r.kind === 'similar-name'
						? 'líkt nafn'
						: 'sami staður'
		)
		.join(', ');
const line = (c: (typeof candidates)[number]) =>
	`${c.a.name} (#${c.a.id}) ↔ ${c.b.name} (#${c.b.id}), ${Math.round(c.distanceM)} m: ${why(c)}`;

console.log(`${candidates.length} likely duplicate pair(s)${dryRun ? ' (dry run)' : ''}`);
for (const c of candidates) console.log(`${c.notified ? '      ' : 'NEW   '}${line(c)}`);

const fresh = candidates.filter((c) => !c.notified);
if (!dryRun && fresh.length > 0) {
	if (process.env.NTFY_TOPIC) {
		await ntfy(
			process.env.NTFY_TOPIC,
			`Mögulega tvískráðar stöðvar — sameinaðu eða hafnaðu á /admin:\n${fresh.map(line).join('\n')}`
		);
	}
	await markNotified(
		db,
		fresh.map((c) => [c.a.id, c.b.id])
	);
}
await db.$client.end();
