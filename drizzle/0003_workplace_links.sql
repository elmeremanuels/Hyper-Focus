CREATE TYPE "public"."work_type" AS ENUM('invoicing', 'email', 'calendar', 'content', 'website', 'docs');--> statement-breakpoint
CREATE TABLE "user_tools" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_tools_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"work_type" "work_type" NOT NULL,
	"tool_key" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "work_type" "work_type";--> statement-breakpoint
ALTER TABLE "user_tools" ADD CONSTRAINT "user_tools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_tools_user_work_type" ON "user_tools" USING btree ("user_id","work_type");