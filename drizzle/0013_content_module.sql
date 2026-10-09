CREATE TYPE "public"."content_media_source" AS ENUM('drive', 'meme', 'generated', 'none');--> statement-breakpoint
CREATE TYPE "public"."content_post_status" AS ENUM('draft', 'pending_approval', 'approved', 'scheduled', 'sent', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."conversation_mode" ADD VALUE 'post_edit';--> statement-breakpoint
CREATE TABLE "client_channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"buffer_channel_id" text NOT NULL,
	"service" text NOT NULL,
	"name" text NOT NULL,
	"days" smallint[] DEFAULT ARRAY[]::smallint[] NOT NULL,
	"post_time" time DEFAULT '10:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_posts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"text" text NOT NULL,
	"media_url" text,
	"media_source" "content_media_source" DEFAULT 'none' NOT NULL,
	"reason" text,
	"due_at" timestamp with time zone,
	"status" "content_post_status" DEFAULT 'pending_approval' NOT NULL,
	"buffer_post_id" text,
	"error" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "content_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "profile" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "socials_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "buffer_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "photo_folder_url" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "memes_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "client_channels" ADD CONSTRAINT "client_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_channels" ADD CONSTRAINT "client_channels_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_channel_id_client_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."client_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_channels_unique" ON "client_channels" USING btree ("client_id","buffer_channel_id");--> statement-breakpoint
CREATE INDEX "client_channels_user_idx" ON "client_channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "content_posts_user_status_idx" ON "content_posts" USING btree ("user_id","status");