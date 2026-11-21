CREATE TABLE "station_duplicate_reviews" (
	"station_a_id" integer NOT NULL,
	"station_b_id" integer NOT NULL,
	"notified_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "station_duplicate_reviews_station_a_id_station_b_id_pk" PRIMARY KEY("station_a_id","station_b_id")
);
--> statement-breakpoint
CREATE TABLE "station_overrides" (
	"station_id" integer PRIMARY KEY NOT NULL,
	"name" text,
	"network_id" integer,
	"connectors" jsonb,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_slug_redirects" (
	"old_slug" text PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "under_construction" boolean;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "merged_into_id" integer;--> statement-breakpoint
ALTER TABLE "station_duplicate_reviews" ADD CONSTRAINT "station_duplicate_reviews_station_a_id_stations_id_fk" FOREIGN KEY ("station_a_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_duplicate_reviews" ADD CONSTRAINT "station_duplicate_reviews_station_b_id_stations_id_fk" FOREIGN KEY ("station_b_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_overrides" ADD CONSTRAINT "station_overrides_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_overrides" ADD CONSTRAINT "station_overrides_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_slug_redirects" ADD CONSTRAINT "station_slug_redirects_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_merged_into_id_stations_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;