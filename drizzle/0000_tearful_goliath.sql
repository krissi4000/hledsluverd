CREATE TYPE "public"."connector_type" AS ENUM('CCS2', 'CHAdeMO', 'Type2');--> statement-breakpoint
CREATE TABLE "availability" (
	"station_id" integer PRIMARY KEY NOT NULL,
	"free_count" integer,
	"total_count" integer,
	"per_type" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cars" (
	"id" serial PRIMARY KEY NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"variant" text,
	"slug" text NOT NULL,
	"ac_connector" "connector_type",
	"max_ac_kw" double precision,
	"dc_connector" "connector_type",
	"max_dc_kw" double precision,
	CONSTRAINT "cars_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"type" "connector_type" NOT NULL,
	"power_kw" double precision NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website_url" text,
	"scraper_id" text,
	CONSTRAINT "networks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" integer NOT NULL,
	"station_id" integer,
	"tariff_key" text NOT NULL,
	"price_isk_per_kwh" double precision NOT NULL,
	"minute_fee_isk" double precision,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"location" geometry(point) NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cars_make_model_variant_idx" ON "cars" USING btree ("make","model","variant");--> statement-breakpoint
CREATE INDEX "prices_current_idx" ON "prices" USING btree ("network_id","tariff_key","valid_from");--> statement-breakpoint
CREATE INDEX "stations_location_idx" ON "stations" USING gist ("location");