import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing — copy .env.example to .env');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL! },
	// PostGIS bookkeeping tables must not be dropped/managed by drizzle
	extensionsFilters: ['postgis'],
	tablesFilter: ['!spatial_ref_sys']
});
