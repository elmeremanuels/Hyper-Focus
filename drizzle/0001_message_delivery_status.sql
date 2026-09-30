CREATE TYPE "public"."delivery_status" AS ENUM('sent', 'delivered', 'read', 'failed');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_status" "delivery_status";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_status_at" timestamp with time zone;