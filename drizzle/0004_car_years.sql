ALTER TABLE "cars" DROP CONSTRAINT "cars_make_model_variant_idx";--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "year_from" integer;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "year_to" integer;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "battery_kwh" double precision;--> statement-breakpoint
ALTER TABLE "cars" ADD CONSTRAINT "cars_make_model_variant_year_idx" UNIQUE NULLS NOT DISTINCT("make","model","variant","year_from");