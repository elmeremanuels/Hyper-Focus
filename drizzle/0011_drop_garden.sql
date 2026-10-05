DROP TABLE "garden_events" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "garden_growth";--> statement-breakpoint
DROP TYPE "public"."garden_event_kind";