CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text,
	"assistant_id" text,
	"sr_id" text,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"sso_subject" text,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"initials" text NOT NULL,
	"color" text NOT NULL,
	"is_system_owner" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_sso_subject_key" UNIQUE("sso_subject")
);
--> statement-breakpoint
CREATE TABLE "assistant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"level1" text NOT NULL,
	"level2" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"model_id" text,
	"link1" text,
	"doc_url" text,
	"owner_id" text NOT NULL,
	"status" text NOT NULL,
	"usage_example" text DEFAULT '' NOT NULL,
	"image_file_id" text,
	"color" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_status_check" CHECK ("assistant"."status" in ('open', 'developing', 'testing', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "assistant_checklist_template" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_expected_io" (
	"assistant_id" text NOT NULL,
	"direction" text NOT NULL,
	"sort_order" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "assistant_expected_io_assistant_id_direction_sort_order_pk" PRIMARY KEY("assistant_id","direction","sort_order"),
	CONSTRAINT "assistant_expected_io_direction_check" CHECK ("assistant_expected_io"."direction" in ('input', 'output'))
);
--> statement-breakpoint
CREATE TABLE "chat_request" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"reply_message_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"retry_of" text,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"transport" text NOT NULL,
	"model" text NOT NULL,
	"bytes" integer NOT NULL,
	"limit_bytes" integer NOT NULL,
	"error" text,
	"snapshot" jsonb,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "chat_request_reply_message_id_key" UNIQUE("reply_message_id"),
	CONSTRAINT "chat_request_status_check" CHECK ("chat_request"."status" in ('pending', 'streaming', 'succeeded', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "chat_request_provider_check" CHECK ("chat_request"."provider" in ('mock', 'live')),
	CONSTRAINT "chat_request_transport_check" CHECK ("chat_request"."transport" in ('inline', 'openwebui'))
);
--> statement-breakpoint
CREATE TABLE "chat_request_input" (
	"request_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"weight" text NOT NULL,
	"file_id" text,
	"file_version" integer,
	"source_label" text,
	"one_shot" boolean DEFAULT false NOT NULL,
	"delivery" text,
	"remote_id" text,
	"source_task_id" text,
	"snapshot_id" text,
	"mode" text,
	"message_count" integer,
	"bytes" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "chat_request_input_request_id_seq_pk" PRIMARY KEY("request_id","seq"),
	CONSTRAINT "chat_request_input_kind_check" CHECK ("chat_request_input"."kind" in ('file', 'conversation')),
	CONSTRAINT "chat_request_input_weight_check" CHECK ("chat_request_input"."weight" in ('main', 'reference')),
	CONSTRAINT "chat_request_input_delivery_check" CHECK ("chat_request_input"."delivery" in ('attached', 'inline', 'metadata_only', 'failed')),
	CONSTRAINT "chat_request_input_mode_check" CHECK ("chat_request_input"."mode" in ('full', 'messages', 'summary')),
	CONSTRAINT "chat_request_input_check" CHECK (("chat_request_input"."kind" = 'file') = ("chat_request_input"."file_id" is not null)),
	CONSTRAINT "chat_request_input_check1" CHECK (("chat_request_input"."kind" = 'conversation') = ("chat_request_input"."snapshot_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "checklist_item" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"template_item_id" text,
	"sort_order" integer NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_by" text,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "checklist_review" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"by_user" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"met" integer NOT NULL,
	"total" integer NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "checklist_review_source_check" CHECK ("checklist_review"."source" in ('ai', 'rule'))
);
--> statement-breakpoint
CREATE TABLE "checklist_review_item" (
	"review_id" text NOT NULL,
	"item_id" text NOT NULL,
	"met" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "checklist_review_item_review_id_item_id_pk" PRIMARY KEY("review_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "context_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"source_task_id" text NOT NULL,
	"mode" text NOT NULL,
	"up_to_message_id" text,
	"summary_text" text,
	"summary_source" text,
	"summary_model" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_snapshot_mode_check" CHECK ("context_snapshot"."mode" in ('full', 'messages', 'summary')),
	CONSTRAINT "context_snapshot_summary_source_check" CHECK ("context_snapshot"."summary_source" in ('ai', 'rule')),
	CONSTRAINT "context_snapshot_check" CHECK (("context_snapshot"."mode" = 'summary') = ("context_snapshot"."summary_text" is not null))
);
--> statement-breakpoint
CREATE TABLE "context_snapshot_message" (
	"snapshot_id" text NOT NULL,
	"message_id" text NOT NULL,
	"seq" integer NOT NULL,
	CONSTRAINT "context_snapshot_message_snapshot_id_message_id_pk" PRIMARY KEY("snapshot_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_input" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"source_task_id" text NOT NULL,
	"weight" text NOT NULL,
	"mode" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"selected_by" text NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_input_task_id_source_task_id_key" UNIQUE("task_id","source_task_id"),
	CONSTRAINT "conversation_input_weight_check" CHECK ("conversation_input"."weight" in ('main', 'reference')),
	CONSTRAINT "conversation_input_mode_check" CHECK ("conversation_input"."mode" in ('full', 'messages', 'summary')),
	CONSTRAINT "conversation_input_check" CHECK ("conversation_input"."task_id" <> "conversation_input"."source_task_id")
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"origin_task_id" text,
	"origin_sr_id" text,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" text NOT NULL,
	"source" text NOT NULL,
	"is_output" boolean DEFAULT false NOT NULL,
	"version" integer NOT NULL,
	"previous_id" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_object_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "file_object_kind_check" CHECK ("file_object"."kind" in ('task_file', 'sr_attachment', 'assistant_image')),
	CONSTRAINT "file_object_source_check" CHECK ("file_object"."source" in ('upload', 'assistant')),
	CONSTRAINT "file_object_version_check" CHECK ("file_object"."version" >= 1),
	CONSTRAINT "file_object_check" CHECK (not "file_object"."is_output" or "file_object"."kind" = 'task_file'),
	CONSTRAINT "file_object_check1" CHECK (("file_object"."kind" = 'sr_attachment') = ("file_object"."origin_sr_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "file_remote_ref" (
	"file_id" text NOT NULL,
	"scope_hash" text NOT NULL,
	"remote_id" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_remote_ref_file_id_scope_hash_pk" PRIMARY KEY("file_id","scope_hash")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"role" text NOT NULL,
	"kind" text,
	"content" text NOT NULL,
	"author_id" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_thread_id_seq_key" UNIQUE("thread_id","seq"),
	CONSTRAINT "message_role_check" CHECK ("message"."role" in ('system', 'user', 'assistant')),
	CONSTRAINT "message_kind_check" CHECK ("message"."kind" in ('discussion')),
	CONSTRAINT "message_status_check" CHECK ("message"."status" in ('streaming', 'done', 'error'))
);
--> statement-breakpoint
CREATE TABLE "message_attachment" (
	"message_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "message_attachment_message_id_file_id_pk" PRIMARY KEY("message_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_attachment" (
	"note_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "note_attachment_note_id_file_id_pk" PRIMARY KEY("note_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_request" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text,
	"requester_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"title_source" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_code_key" UNIQUE("code"),
	CONSTRAINT "service_request_title_source_check" CHECK ("service_request"."title_source" in ('default', 'ai', 'manual')),
	CONSTRAINT "service_request_status_check" CHECK ("service_request"."status" in ('draft', 'submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "shared_result" (
	"id" text PRIMARY KEY NOT NULL,
	"sr_id" text NOT NULL,
	"task_id" text,
	"text" text DEFAULT '' NOT NULL,
	"by_user" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_result_file" (
	"result_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "shared_result_file_result_id_file_id_pk" PRIMARY KEY("result_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_kind_check" CHECK ("tag"."kind" in ('sr', 'keyword'))
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"assistant_id" text NOT NULL,
	"title" text NOT NULL,
	"title_source" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"owner_id" text NOT NULL,
	"priority" text NOT NULL,
	"due_date" date,
	"model_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	CONSTRAINT "task_code_key" UNIQUE("code"),
	CONSTRAINT "task_title_source_check" CHECK ("task"."title_source" in ('default', 'ai', 'manual')),
	CONSTRAINT "task_status_check" CHECK ("task"."status" in ('todo', 'in_progress', 'on_hold', 'done')),
	CONSTRAINT "task_priority_check" CHECK ("task"."priority" in ('low', 'normal', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE "task_assignee" (
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "task_assignee_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_feedback" (
	"task_id" text PRIMARY KEY NOT NULL,
	"rating" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"by_user" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_feedback_rating_check" CHECK ("task_feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "task_input" (
	"task_id" text NOT NULL,
	"file_id" text NOT NULL,
	"weight" text NOT NULL,
	"sort_order" integer NOT NULL,
	"selected_by" text NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_input_task_id_file_id_pk" PRIMARY KEY("task_id","file_id"),
	CONSTRAINT "task_input_weight_check" CHECK ("task_input"."weight" in ('main', 'reference'))
);
--> statement-breakpoint
CREATE TABLE "task_tag" (
	"task_id" text NOT NULL,
	"tag_key" text NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_tag_task_id_tag_key_pk" PRIMARY KEY("task_id","tag_key")
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"sr_id" text,
	"title" text NOT NULL,
	"model_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_task_id_key" UNIQUE("task_id"),
	CONSTRAINT "thread_sr_id_key" UNIQUE("sr_id"),
	CONSTRAINT "thread_check" CHECK (("thread"."task_id" is null) <> ("thread"."sr_id" is null))
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_sr_id_service_request_id_fk" FOREIGN KEY ("sr_id") REFERENCES "public"."service_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session" ADD CONSTRAINT "app_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant" ADD CONSTRAINT "assistant_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant" ADD CONSTRAINT "assistant_image_file_id_file_object_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant" ADD CONSTRAINT "assistant_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_checklist_template" ADD CONSTRAINT "assistant_checklist_template_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_expected_io" ADD CONSTRAINT "assistant_expected_io_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request" ADD CONSTRAINT "chat_request_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request" ADD CONSTRAINT "chat_request_user_message_id_message_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request" ADD CONSTRAINT "chat_request_reply_message_id_message_id_fk" FOREIGN KEY ("reply_message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request" ADD CONSTRAINT "chat_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request" ADD CONSTRAINT "chat_request_retry_of_chat_request_id_fk" FOREIGN KEY ("retry_of") REFERENCES "public"."chat_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request_input" ADD CONSTRAINT "chat_request_input_request_id_chat_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."chat_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request_input" ADD CONSTRAINT "chat_request_input_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request_input" ADD CONSTRAINT "chat_request_input_source_task_id_task_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_request_input" ADD CONSTRAINT "chat_request_input_snapshot_id_context_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."context_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_template_item_id_assistant_checklist_template_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."assistant_checklist_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_checked_by_app_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_review" ADD CONSTRAINT "checklist_review_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_review" ADD CONSTRAINT "checklist_review_by_user_app_user_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_review_item" ADD CONSTRAINT "checklist_review_item_review_id_checklist_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."checklist_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_review_item" ADD CONSTRAINT "checklist_review_item_item_id_checklist_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_snapshot" ADD CONSTRAINT "context_snapshot_source_task_id_task_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_snapshot" ADD CONSTRAINT "context_snapshot_up_to_message_id_message_id_fk" FOREIGN KEY ("up_to_message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_snapshot" ADD CONSTRAINT "context_snapshot_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_snapshot_message" ADD CONSTRAINT "context_snapshot_message_snapshot_id_context_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."context_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_snapshot_message" ADD CONSTRAINT "context_snapshot_message_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_input" ADD CONSTRAINT "conversation_input_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_input" ADD CONSTRAINT "conversation_input_source_task_id_task_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_input" ADD CONSTRAINT "conversation_input_snapshot_id_context_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."context_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_input" ADD CONSTRAINT "conversation_input_selected_by_app_user_id_fk" FOREIGN KEY ("selected_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_origin_task_id_task_id_fk" FOREIGN KEY ("origin_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_origin_sr_id_service_request_id_fk" FOREIGN KEY ("origin_sr_id") REFERENCES "public"."service_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_previous_id_file_object_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_remote_ref" ADD CONSTRAINT "file_remote_ref_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachment" ADD CONSTRAINT "message_attachment_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachment" ADD CONSTRAINT "message_attachment_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachment" ADD CONSTRAINT "note_attachment_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachment" ADD CONSTRAINT "note_attachment_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_requester_id_app_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_result" ADD CONSTRAINT "shared_result_sr_id_service_request_id_fk" FOREIGN KEY ("sr_id") REFERENCES "public"."service_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_result" ADD CONSTRAINT "shared_result_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_result" ADD CONSTRAINT "shared_result_by_user_app_user_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_result_file" ADD CONSTRAINT "shared_result_file_result_id_shared_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."shared_result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_result_file" ADD CONSTRAINT "shared_result_file_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_completed_by_app_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_by_user_app_user_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_input" ADD CONSTRAINT "task_input_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_input" ADD CONSTRAINT "task_input_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_input" ADD CONSTRAINT "task_input_selected_by_app_user_id_fk" FOREIGN KEY ("selected_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tag" ADD CONSTRAINT "task_tag_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tag" ADD CONSTRAINT "task_tag_tag_key_tag_key_fk" FOREIGN KEY ("tag_key") REFERENCES "public"."tag"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tag" ADD CONSTRAINT "task_tag_added_by_app_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_sr_id_service_request_id_fk" FOREIGN KEY ("sr_id") REFERENCES "public"."service_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_by_task" ON "activity_log" USING btree ("task_id","at");--> statement-breakpoint
CREATE INDEX "app_session_user" ON "app_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_request_one_active" ON "chat_request" USING btree ("thread_id") WHERE "chat_request"."status" in ('pending', 'streaming');--> statement-breakpoint
CREATE INDEX "conversation_input_by_source" ON "conversation_input" USING btree ("source_task_id");--> statement-breakpoint
CREATE INDEX "file_object_origin_task" ON "file_object" USING btree ("origin_task_id");--> statement-breakpoint
CREATE INDEX "file_object_origin_sr" ON "file_object" USING btree ("origin_sr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_version" ON "file_object" USING btree (coalesce("origin_task_id", "origin_sr_id"),"original_name","version") WHERE "file_object"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notification_unread" ON "notification" USING btree ("user_id") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "task_assistant" ON "task" USING btree ("assistant_id");--> statement-breakpoint
CREATE INDEX "task_last_activity" ON "task" USING btree ("last_activity_at" desc);--> statement-breakpoint
CREATE INDEX "task_input_by_file" ON "task_input" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "task_tag_by_tag" ON "task_tag" USING btree ("tag_key");