ALTER TABLE "chat_request" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "chat_request" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_request" ADD CONSTRAINT "chat_request_thread_id_idempotency_key_key" UNIQUE("thread_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_idempotency_key_key" UNIQUE("idempotency_key");