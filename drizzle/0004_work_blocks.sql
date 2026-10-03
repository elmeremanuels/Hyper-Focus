CREATE TYPE "public"."focus_block_outcome" AS ENUM('completed', 'extended', 'stopped', 'expired');--> statement-breakpoint
CREATE TYPE "public"."garden_event_kind" AS ENUM('block', 'on_time_return');--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'block_end';--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'return_reminder';--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'pause_close';--> statement-breakpoint
ALTER TYPE "public"."nudge_kind" ADD VALUE 'hyperfocus_break';--> statement-breakpoint
CREATE TABLE "focus_blocks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "focus_blocks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"task_id" integer,
	"step_id" integer,
	"planned_minutes" smallint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" "focus_block_outcome",
	"extended_minutes" smallint DEFAULT 0 NOT NULL,
	"hyperfocus_prompts" smallint DEFAULT 0 NOT NULL,
	"pause_mission" text,
	"pause_started_at" timestamp with time zone,
	"pause_due_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"reward_token_hash" text,
	"reward_opened_at" timestamp with time zone,
	"reward_finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_blocks_planned_minutes" CHECK ("focus_blocks"."planned_minutes" IN (15, 25, 45))
);
--> statement-breakpoint
CREATE TABLE "garden_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "garden_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"block_id" integer,
	"kind" "garden_event_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "rewards_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "garden_growth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_blocks" ADD CONSTRAINT "focus_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_blocks" ADD CONSTRAINT "focus_blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_blocks" ADD CONSTRAINT "focus_blocks_step_id_tasks_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garden_events" ADD CONSTRAINT "garden_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garden_events" ADD CONSTRAINT "garden_events_block_id_focus_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."focus_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "focus_blocks_user_started_idx" ON "focus_blocks" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "focus_blocks_reward_token" ON "focus_blocks" USING btree ("reward_token_hash");--> statement-breakpoint
CREATE INDEX "garden_events_user_created_idx" ON "garden_events" USING btree ("user_id","created_at");