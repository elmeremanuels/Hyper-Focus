ALTER TYPE "public"."content_media_source" ADD VALUE 'pexels';--> statement-breakpoint
ALTER TYPE "public"."content_media_source" ADD VALUE 'ai';--> statement-breakpoint
ALTER TYPE "public"."content_media_source" ADD VALUE 'upload';--> statement-breakpoint
ALTER TYPE "public"."content_media_source" ADD VALUE 'edit';--> statement-breakpoint
ALTER TYPE "public"."content_media_source" ADD VALUE 'textcard';--> statement-breakpoint
ALTER TYPE "public"."conversation_mode" ADD VALUE 'post_image';--> statement-breakpoint
CREATE TABLE "content_post_images" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_post_images_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"source" "content_media_source" NOT NULL,
	"url" text,
	"source_url" text,
	"prompt" text,
	"credit" text,
	"credit_url" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"chosen" boolean DEFAULT false NOT NULL,
	"shown" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "ai_image_budget_cents" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "image_sources" text[] DEFAULT ARRAY['drive','pexels','textcard']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "image_style" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "brand_colors" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "content_post_images" ADD CONSTRAINT "content_post_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_post_images" ADD CONSTRAINT "content_post_images_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_post_images_post_idx" ON "content_post_images" USING btree ("post_id");