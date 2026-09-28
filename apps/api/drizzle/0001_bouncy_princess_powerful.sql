ALTER TABLE "app_user" ADD COLUMN "login_id" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_login_id_key" UNIQUE("login_id");