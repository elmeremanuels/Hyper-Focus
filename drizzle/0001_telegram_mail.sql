CREATE TYPE "public"."delivery_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."preferred_channel" AS ENUM('telegram', 'email');--> statement-breakpoint
ALTER TABLE "wa_usage" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "wa_usage" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_phone_e164_unique";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."message_channel";--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('telegram', 'email', 'web');--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "channel" SET DATA TYPE "public"."message_channel" USING "channel"::"public"."message_channel";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."message_type";--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'button', 'audio', 'email', 'action_link');--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "type" SET DATA TYPE "public"."message_type" USING "type"::"public"."message_type";--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."task_source";--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('telegram', 'voice', 'email', 'engine', 'web', 'seed');--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "source" SET DATA TYPE "public"."task_source" USING "source"::"public"."task_source";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "source" SET DATA TYPE "public"."task_source" USING "source"::"public"."task_source";--> statement-breakpoint
DROP INDEX "messages_wa_message_id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_user_id" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_channel" "preferred_channel" DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_status" "delivery_status";--> statement-breakpoint
CREATE UNIQUE INDEX "messages_channel_external_id" ON "messages" USING btree ("channel","external_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "phone_e164";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "whatsapp_opt_in_at";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "wa_message_id";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id");