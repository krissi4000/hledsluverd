import {
	pgTable,
	pgEnum,
	serial,
	text,
	integer,
	boolean,
	doublePrecision,
	timestamp,
	jsonb,
	geometry,
	index,
	primaryKey,
	unique,
	type AnyPgColumn
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
		networkId: integer('network_id')
			.notNull()
			.references(() => networks.id),
		slug: text('slug').notNull().unique(),
		name: text('name').notNull(),
		address: text('address'),
		location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
		externalIds: jsonb('external_ids')
			.$type<{
				ocm?: number;
				tomtom?: string;
				virta?: number;
				n1?: string;
				supercharge?: number;
				e1?: number;
				/** Google Maps place ID (npm run match:google), for the map card's photos */
				google?: string;
			}>()
			.notNull()
			.default({}),
		isActive: boolean('is_active').notNull().default(true),
		// The site's owner (hotel, shop, landlord) sets this station's price, not the network.
		// Its prices show on the station but stay out of the network's rate card and trend.
		hostPriced: boolean('host_priced').notNull().default(false),
		// Not open yet ("Í uppsetningu"): listed with a badge, but no price and no availability.
		// NULL = detect from the name (isUnderConstructionName); true/false = an admin's call.
		underConstruction: boolean('under_construction'),
		// Set when an admin merged this duplicate into another station (it is then inactive).
		// Its /stod/ slug redirects to the survivor. It keeps its OCM id, so seed:ocm and the
		// syncs keep recognising it and never re-create the duplicate.
		mergedIntoId: integer('merged_into_id').references((): AnyPgColumn => stations.id),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [index('stations_location_idx').using('gist', t.location)]
);

/** Old /stod/ slugs of renamed stations → the station, so old links keep working. */
export const stationSlugRedirects = pgTable('station_slug_redirects', {
	oldSlug: text('old_slug').primaryKey(),
	stationId: integer('station_id')
		.notNull()
		.references(() => stations.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Human corrections to upstream data we can't fix at the source (OCM typos, a wrong
 * operator, wrong connectors). Edited on /admin. seed:ocm and the syncs never overwrite
 * an overridden field. NULL field = no override.
 */
export const stationOverrides = pgTable('station_overrides', {
	stationId: integer('station_id')
		.primaryKey()
		.references(() => stations.id, { onDelete: 'cascade' }),
	name: text('name'),
	networkId: integer('network_id').references(() => networks.id),
	connectors:
		jsonb('connectors').$type<{ type: ConnectorType; powerKw: number; count: number }[]>(),
	note: text('note'),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
});

/**
 * Duplicate-candidate pairs already seen (stationAId < stationBId): notifiedAt keeps the
 * daily ntfy note to new pairs only, dismissedAt hides a pair a human judged distinct.
 */
export const stationDuplicateReviews = pgTable(
	'station_duplicate_reviews',
	{
		stationAId: integer('station_a_id')
			.notNull()
			.references(() => stations.id, { onDelete: 'cascade' }),
		stationBId: integer('station_b_id')
			.notNull()
			.references(() => stations.id, { onDelete: 'cascade' }),
		notifiedAt: timestamp('notified_at', { withTimezone: true }),
		dismissedAt: timestamp('dismissed_at', { withTimezone: true })
	},
	(t) => [primaryKey({ columns: [t.stationAId, t.stationBId] })]
);

export const connectors = pgTable('connectors', {
	id: serial('id').primaryKey(),
	stationId: integer('station_id')
		.notNull()
		.references(() => stations.id, { onDelete: 'cascade' }),
	type: connectorTypeEnum('type').notNull(),
	powerKw: doublePrecision('power_kw').notNull(),
	count: integer('count').notNull().default(1)
});

export const prices = pgTable(
	'prices',
	{
		id: serial('id').primaryKey(),
		networkId: integer('network_id')
			.notNull()
			.references(() => networks.id),
		stationId: integer('station_id').references(() => stations.id, { onDelete: 'restrict' }), // NULL = network-wide; price history blocks hard deletes — use is_active
		tariffKey: text('tariff_key', { enum: TARIFF_KEYS }).notNull(),
		priceIskPerKwh: doublePrecision('price_isk_per_kwh').notNull(),
		minuteFeeIsk: doublePrecision('minute_fee_isk'),
		// Minutes of charging before minute_fee_isk starts to apply (Ísorka free period,
		// Orkan biðgjald). NULL = the fee runs from the first minute (ON).
		minuteFeeAfterMin: integer('minute_fee_after_min'),
		validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
		source: text('source', { enum: ['scraper', 'manual'] }).notNull(),
		verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('prices_current_idx').on(t.networkId, t.tariffKey, t.validFrom)]
);

export const availability = pgTable('availability', {
	stationId: integer('station_id')
		.primaryKey()
		.references(() => stations.id, { onDelete: 'cascade' }),
	freeCount: integer('free_count'),
	totalCount: integer('total_count'),
	perType:
		jsonb('per_type').$type<Partial<Record<ConnectorType, { free: number; total: number }>>>(),
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
		maxDcKw: doublePrecision('max_dc_kw'),
		// European model years this charging spec was sold; yearTo null = still on sale.
		// The plate lookup narrows a registered car's candidates by these.
		yearFrom: integer('year_from'),
		yearTo: integer('year_to'),
		/** usable battery, kWh — helps owners recognise their variant */
		batteryKwh: doublePrecision('battery_kwh'),
		// body style ("sedan", "crossover", "van", …) and exterior size, used to draw the
		// car's side-view silhouette. Null when unknown.
		bodyStyle: text('body_style'),
		lengthMm: integer('length_mm'),
		heightMm: integer('height_mm'),
		wheelbaseMm: integer('wheelbase_mm')
	},
	(t) => [
		unique('cars_make_model_variant_year_idx')
			.on(t.make, t.model, t.variant, t.yearFrom)
			.nullsNotDistinct()
	]
);

export const scrapeRuns = pgTable('scrape_runs', {
	id: serial('id').primaryKey(),
	networkId: integer('network_id')
		.notNull()
		.references(() => networks.id),
	startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
	status: text('status', { enum: ['ok', 'changed', 'failed'] }).notNull(),
	message: text('message')
});

export const REPORT_KINDS = ['price', 'closed', 'availability', 'other'] as const;
export const REPORT_STATUSES = ['open', 'resolved'] as const;

/** Visitor reports from the station page ("Tilkynna rangt verð"); worked off in /admin. */
export const reports = pgTable(
	'reports',
	{
		id: serial('id').primaryKey(),
		stationId: integer('station_id')
			.notNull()
			.references(() => stations.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: REPORT_KINDS }).notNull(),
		/** the price the visitor says is right, kr/kWh (optional) */
		correctPriceIsk: doublePrecision('correct_price_isk'),
		comment: text('comment'),
		/** optional, only so an admin can reply; never shown publicly */
		email: text('email'),
		status: text('status', { enum: REPORT_STATUSES }).notNull().default('open'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true })
	},
	(t) => [index('reports_status_idx').on(t.status, t.createdAt)]
);
