CREATE TABLE "code" (
	"id" text PRIMARY KEY NOT NULL,
	"group_key" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "code_group_key_code_key" UNIQUE("group_key","code")
);
--> statement-breakpoint
CREATE TABLE "code_group" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "is_business_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "level1_code_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "level2_code_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "code" ADD CONSTRAINT "code_group_key_code_group_key_fk" FOREIGN KEY ("group_key") REFERENCES "public"."code_group"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant" ADD CONSTRAINT "assistant_level1_code_id_code_id_fk" FOREIGN KEY ("level1_code_id") REFERENCES "public"."code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant" ADD CONSTRAINT "assistant_level2_code_id_code_id_fk" FOREIGN KEY ("level2_code_id") REFERENCES "public"."code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant" DROP COLUMN "level1";--> statement-breakpoint
ALTER TABLE "assistant" DROP COLUMN "level2";