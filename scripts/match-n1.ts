import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { networks, stations } from '../src/lib/server/db/schema';

const N1_URL = 'https://n1.is/is/verdtafla';
const UA = { 'User-Agent': 'Mozilla/5.0 (hledsluverd.is price comparison)' };

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);

const res = await fetch(N1_URL, { headers: UA });
if (!res.ok) throw new Error(`N1 fetch failed: HTTP ${res.status}`);
const html = await res.text();
const m = html.match(/\\"locations\\":(\[.*?\]),\\"defaultLocation/);
if (!m) throw new Error('N1 locations blob not found — page layout changed?');
const locations: { value: string; label: string }[] = JSON.parse(m[1].replace(/\\"/g, '"'));
const usable = locations.filter((l) => /_(service|self)$/.test(l.value));
console.log(`N1 locations: ${locations.length} total, ${usable.length} service/self`);

/** 6-char lowercase stem survives Icelandic declension: blönduós→blöndu ⊂ "n1 blönduósi" */
function stem(word: string): string | null {
	const w = word.toLowerCase().replace(/[^a-záðéíóúýþæö]/g, '');
	return w.length >= 4 ? w.slice(0, 6) : null;
}

const [n1] = await db.select().from(networks).where(eq(networks.slug, 'n1'));
if (!n1) throw new Error('n1 network missing — run seed:networks');
const ours = await db.select().from(stations).where(eq(stations.networkId, n1.id));

for (const s of ours) {
	// name stem first; address stems only as fallback — address words like
	// "norðurlandsvegur" stem to "norður" and would match half the country
	const nameStem = stem(
		s.name
			.replace(/\(N1\)/i, '')
			.trim()
			.split(/\s+/)[0] ?? ''
	);
	const addressStems = (s.address ?? '')
		.split(/[\s,]+/)
		.map(stem)
		.filter((x): x is string => x !== null);
	const byStems = (stems: string[]) =>
		usable.filter((l) => stems.some((c) => l.label.toLowerCase().includes(c)));
	const hits =
		nameStem && byStems([nameStem]).length > 0 ? byStems([nameStem]) : byStems(addressStems);
	const uniqueIds = [...new Set(hits.map((h) => h.value))];
	if (uniqueIds.length === 1) {
		await db
			.update(stations)
			.set({ externalIds: { ...s.externalIds, n1: uniqueIds[0] } })
			.where(eq(stations.id, s.id));
		console.log(`${s.name}  ←→  ${hits[0].label} (${uniqueIds[0]})`);
	} else if (uniqueIds.length === 0) {
		console.log(`UNMATCHED (ours): ${s.name} — ${s.address ?? ''}`);
	} else {
		console.log(`AMBIGUOUS (skipped): ${s.name} → ${hits.map((h) => h.label).join(' | ')}`);
	}
}
console.log('Review the lines above; fix any wrong stamp with psql (external_ids is plain jsonb).');
await db.$client.end();
