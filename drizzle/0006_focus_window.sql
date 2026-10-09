CREATE TYPE "public"."focus_pref" AS ENUM('morning', 'afternoon', 'evening', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."focus_window_source" AS ENUM('pref', 'learned', 'manual');--> statement-breakpoint
CREATE TYPE "public"."focus_window_status" AS ENUM('planned', 'used', 'missed', 'moved');--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'window_heads_up';--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'window_quiet_check';--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'soft_landing';--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'window_missed';--> statement-breakpoint
CREATE TABLE "focus_windows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "focus_windows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" "focus_window_source" NOT NULL,
	"task_id" integer,
	"started_block_id" integer,
	"status" "focus_window_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rhythm_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rhythm_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"window_start" time NOT NULL,
	"minutes" smallint DEFAULT 90 NOT NULL,
	"confidence" real NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "focus_blocks" DROP CONSTRAINT "focus_blocks_planned_minutes";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "focus_pref" "focus_pref";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "focus_window_start" time;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "focus_window_minutes" smallint DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_blocks" ADD COLUMN "in_window" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_windows" ADD CONSTRAINT "focus_windows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_windows" ADD CONSTRAINT "focus_windows_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_windows" ADD CONSTRAINT "focus_windows_started_block_id_focus_blocks_id_fk" FOREIGN KEY ("started_block_id") REFERENCES "public"."focus_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rhythm_profiles" ADD CONSTRAINT "rhythm_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focus_windows_user_date_start" ON "focus_windows" USING btree ("user_id","date","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rhythm_profiles_user_weekday" ON "rhythm_profiles" USING btree ("user_id","weekday");--> statement-breakpoint
ALTER TABLE "focus_blocks" ADD CONSTRAINT "focus_blocks_planned_minutes" CHECK ("focus_blocks"."planned_minutes" IN (15, 25, 45, 60, 90));