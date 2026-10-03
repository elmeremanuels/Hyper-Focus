CREATE TYPE "public"."day_energy" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TABLE "day_reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "day_reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"energy" "day_energy",
	"completed_at" timestamp with time zone,
	"skipped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deferred_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "day_reviews" ADD CONSTRAINT "day_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_reviews_user_date" ON "day_reviews" USING btree ("user_id","date");