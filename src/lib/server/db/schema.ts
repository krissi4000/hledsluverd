import {
	pgTable, pgEnum, serial, text, integer, boolean, doublePrecision,
	timestamp, jsonb, geometry, index, unique
} from 'drizzle-orm/pg-core';
import { CONNECTOR_TYPES, TARIFF_KEYS, type ConnectorType } from '$lib/types';

export const connectorTypeEnum = pgEnum('connector_type', CONNECTOR_TYPES);

export const networks = pgTable('networks', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	websiteUrl: text('website_url'),
	scraperId: text('scraper_id')
});

export const stations = pgTable(
	'stations',
	{
		id: serial('id').primaryKey(),
		networkId: integer('network_id').notNull().references(() => networks.id),
		slug: text('slug').notNull().unique(),
		name: text('name').notNull(),
		address: text('address'),
		location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
		externalIds: jsonb('external_ids').$type<{ ocm?: number; tomtom?: string }>().notNull().default({}),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())
	},
	(t) => [index('stations_location_idx').using('gist', t.location)]
);

export const connectors = pgTable('connectors', {
	id: serial('id').primaryKey(),
	stationId: integer('station_id').notNull().references(() => stations.id, { onDelete: 'cascade' }),
	type: connectorTypeEnum('type').notNull(),
	powerKw: doublePrecision('power_kw').notNull(),
	count: integer('count').notNull().default(1)
});

export const prices = pgTable(
	'prices',
	{
		id: serial('id').primaryKey(),
		networkId: integer('network_id').notNull().references(() => networks.id),
		stationId: integer('station_id').references(() => stations.id, { onDelete: 'restrict' }), // NULL = network-wide; price history blocks hard deletes — use is_active
		tariffKey: text('tariff_key', { enum: TARIFF_KEYS }).notNull(),
		priceIskPerKwh: doublePrecision('price_isk_per_kwh').notNull(),
		minuteFeeIsk: doublePrecision('minute_fee_isk'),
		validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
		source: text('source', { enum: ['scraper', 'manual'] }).notNull(),
		verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('prices_current_idx').on(t.networkId, t.tariffKey, t.validFrom)]
);

export const availability = pgTable('availability', {
	stationId: integer('station_id').primaryKey().references(() => stations.id, { onDelete: 'cascade' }),
	freeCount: integer('free_count'),
	totalCount: integer('total_count'),
	perType: jsonb('per_type').$type<Partial<Record<ConnectorType, { free: number; total: number }>>>(),
	fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
	source: text('source').notNull() // free text until Phase 3 pins the source set
});

export const cars = pgTable(
	'cars',
	{
		id: serial('id').primaryKey(),
		make: text('make').notNull(),
		model: text('model').notNull(),
		variant: text('variant'),
		slug: text('slug').notNull().unique(),
		acConnector: connectorTypeEnum('ac_connector'),
		maxAcKw: doublePrecision('max_ac_kw'),
		dcConnector: connectorTypeEnum('dc_connector'),
		maxDcKw: doublePrecision('max_dc_kw')
	},
	(t) => [unique('cars_make_model_variant_idx').on(t.make, t.model, t.variant).nullsNotDistinct()]
);

export const scrapeRuns = pgTable('scrape_runs', {
	id: serial('id').primaryKey(),
	networkId: integer('network_id').notNull().references(() => networks.id),
	startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
	status: text('status', { enum: ['ok', 'changed', 'failed'] }).notNull(),
	message: text('message')
});
