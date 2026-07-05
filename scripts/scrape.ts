import 'dotenv/config';
import { createDb } from '../src/lib/server/db/client';
import { allScrapers } from '../src/lib/server/scrapers';
import { runScrapers } from '../src/lib/server/scrapers/runner';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const summaries = await runScrapers(db, allScrapers, {
	ntfyTopic: process.env.NTFY_TOPIC || undefined
});
for (const s of summaries) console.log(`${s.networkSlug}: ${s.status} — ${s.message}`);
await db.$client.end();
if (summaries.some((s) => s.status === 'failed')) process.exitCode = 1;
