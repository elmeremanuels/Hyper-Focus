ALTER TABLE "user_settings" ADD COLUMN "work_days" smallint[] DEFAULT ARRAY[1,2,3,4,5]::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "work_start" time DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "work_end" time DEFAULT '17:00' NOT NULL;