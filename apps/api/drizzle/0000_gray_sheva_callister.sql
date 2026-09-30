CREATE TABLE `activity_log` (
	`id` varchar(191) NOT NULL,
	`type` text NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`task_id` varchar(191),
	`assistant_id` varchar(191),
	`sr_id` varchar(191),
	`payload` json NOT NULL DEFAULT '{}',
	`at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_session` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`expires_at` datetime(6) NOT NULL,
	CONSTRAINT `app_session_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_setting` (
	`key` varchar(191) NOT NULL,
	`value` json NOT NULL,
	CONSTRAINT `app_setting_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `app_user` (
	`id` varchar(191) NOT NULL,
	`sso_subject` varchar(512),
	`name` text NOT NULL,
	`role` text NOT NULL DEFAULT (''),
	`initials` text NOT NULL,
	`color` text NOT NULL,
	`is_system_owner` boolean NOT NULL DEFAULT false,
	`is_business_owner` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`login_id` varchar(191),
	`password_hash` text,
	CONSTRAINT `app_user_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_user_sso_subject_key` UNIQUE(`sso_subject`),
	CONSTRAINT `app_user_login_id_key` UNIQUE(`login_id`)
);
--> statement-breakpoint
CREATE TABLE `assistant` (
	`id` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`level1_code_id` varchar(191) NOT NULL,
	`level2_code_id` varchar(191) NOT NULL,
	`summary` longtext NOT NULL DEFAULT '',
	`sort_order` int NOT NULL,
	`model_id` text,
	`link1` text,
	`doc_url` text,
	`owner_id` varchar(191) NOT NULL,
	`status` text NOT NULL,
	`usage_example` longtext NOT NULL DEFAULT '',
	`image_file_id` varchar(191),
	`color` text NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	`created_by` varchar(191) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `assistant_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_status_check` CHECK(`assistant`.`status` in ('open', 'developing', 'testing', 'retired'))
);
--> statement-breakpoint
CREATE TABLE `assistant_checklist_template` (
	`id` varchar(191) NOT NULL,
	`assistant_id` varchar(191) NOT NULL,
	`sort_order` int NOT NULL,
	`label` text NOT NULL,
	`required` boolean NOT NULL DEFAULT false,
	CONSTRAINT `assistant_checklist_template_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assistant_expected_io` (
	`assistant_id` varchar(191) NOT NULL,
	`direction` varchar(191) NOT NULL,
	`sort_order` int NOT NULL,
	`label` text NOT NULL,
	CONSTRAINT `assistant_expected_io_assistant_id_direction_sort_order_pk` PRIMARY KEY(`assistant_id`,`direction`,`sort_order`),
	CONSTRAINT `assistant_expected_io_direction_check` CHECK(`assistant_expected_io`.`direction` in ('input', 'output'))
);
--> statement-breakpoint
CREATE TABLE `chat_request` (
	`id` varchar(191) NOT NULL,
	`thread_id` varchar(191) NOT NULL,
	`user_message_id` varchar(191) NOT NULL,
	`reply_message_id` varchar(191) NOT NULL,
	`requested_by` varchar(191) NOT NULL,
	`retry_of` varchar(191),
	`status` text NOT NULL,
	`active_thread_id` varchar(191) GENERATED ALWAYS AS (case when status in ('pending', 'streaming') then thread_id else null end) STORED,
	`idempotency_key` varchar(191),
	`phase` text,
	`provider` text NOT NULL,
	`transport` text NOT NULL,
	`model` text NOT NULL,
	`bytes` int NOT NULL,
	`limit_bytes` int NOT NULL,
	`error` longtext,
	`snapshot` json,
	`lease_until` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`finished_at` datetime(6),
	CONSTRAINT `chat_request_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_request_reply_message_id_key` UNIQUE(`reply_message_id`),
	CONSTRAINT `chat_request_thread_id_idempotency_key_key` UNIQUE(`thread_id`,`idempotency_key`),
	CONSTRAINT `chat_request_one_active` UNIQUE(`active_thread_id`),
	CONSTRAINT `chat_request_status_check` CHECK(`chat_request`.`status` in ('pending', 'streaming', 'succeeded', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT `chat_request_provider_check` CHECK(`chat_request`.`provider` in ('mock', 'live')),
	CONSTRAINT `chat_request_transport_check` CHECK(`chat_request`.`transport` in ('inline', 'openwebui'))
);
--> statement-breakpoint
CREATE TABLE `chat_request_input` (
	`request_id` varchar(191) NOT NULL,
	`seq` int NOT NULL,
	`kind` text NOT NULL,
	`weight` text NOT NULL,
	`file_id` varchar(191),
	`file_version` int,
	`source_label` text,
	`one_shot` boolean NOT NULL DEFAULT false,
	`delivery` text,
	`remote_id` text,
	`source_task_id` varchar(191),
	`snapshot_id` varchar(191),
	`mode` text,
	`message_count` int,
	`bytes` int NOT NULL DEFAULT 0,
	`error` longtext,
	CONSTRAINT `chat_request_input_request_id_seq_pk` PRIMARY KEY(`request_id`,`seq`),
	CONSTRAINT `chat_request_input_kind_check` CHECK(`chat_request_input`.`kind` in ('file', 'conversation')),
	CONSTRAINT `chat_request_input_weight_check` CHECK(`chat_request_input`.`weight` in ('main', 'reference')),
	CONSTRAINT `chat_request_input_delivery_check` CHECK(`chat_request_input`.`delivery` in ('attached', 'inline', 'metadata_only', 'failed')),
	CONSTRAINT `chat_request_input_mode_check` CHECK(`chat_request_input`.`mode` in ('full', 'messages', 'summary')),
	CONSTRAINT `chat_request_input_check` CHECK((`chat_request_input`.`kind` = 'file') = (`chat_request_input`.`file_id` is not null)),
	CONSTRAINT `chat_request_input_check1` CHECK((`chat_request_input`.`kind` = 'conversation') = (`chat_request_input`.`snapshot_id` is not null))
);
--> statement-breakpoint
CREATE TABLE `checklist_item` (
	`id` varchar(191) NOT NULL,
	`task_id` varchar(191) NOT NULL,
	`template_item_id` varchar(191),
	`sort_order` int NOT NULL,
	`label` text NOT NULL,
	`required` boolean NOT NULL DEFAULT false,
	`checked` boolean NOT NULL DEFAULT false,
	`checked_by` varchar(191),
	`checked_at` datetime(6),
	CONSTRAINT `checklist_item_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `checklist_review` (
	`id` varchar(191) NOT NULL,
	`task_id` varchar(191) NOT NULL,
	`by_user` varchar(191) NOT NULL,
	`at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`met` int NOT NULL,
	`total` int NOT NULL,
	`source` text NOT NULL,
	CONSTRAINT `checklist_review_id` PRIMARY KEY(`id`),
	CONSTRAINT `checklist_review_source_check` CHECK(`checklist_review`.`source` in ('ai', 'rule'))
);
--> statement-breakpoint
CREATE TABLE `checklist_review_item` (
	`review_id` varchar(191) NOT NULL,
	`item_id` varchar(191) NOT NULL,
	`met` boolean NOT NULL,
	`note` text NOT NULL DEFAULT (''),
	CONSTRAINT `checklist_review_item_review_id_item_id_pk` PRIMARY KEY(`review_id`,`item_id`)
);
--> statement-breakpoint
CREATE TABLE `code` (
	`id` varchar(191) NOT NULL,
	`group_key` varchar(191) NOT NULL,
	`code` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `code_id` PRIMARY KEY(`id`),
	CONSTRAINT `code_group_key_code_key` UNIQUE(`group_key`,`code`)
);
--> statement-breakpoint
CREATE TABLE `code_group` (
	`key` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `code_group_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `context_snapshot` (
	`id` varchar(191) NOT NULL,
	`source_task_id` varchar(191) NOT NULL,
	`mode` text NOT NULL,
	`up_to_message_id` varchar(191),
	`summary_text` longtext,
	`summary_source` text,
	`summary_model` text,
	`created_by` varchar(191) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `context_snapshot_id` PRIMARY KEY(`id`),
	CONSTRAINT `context_snapshot_mode_check` CHECK(`context_snapshot`.`mode` in ('full', 'messages', 'summary')),
	CONSTRAINT `context_snapshot_summary_source_check` CHECK(`context_snapshot`.`summary_source` in ('ai', 'rule')),
	CONSTRAINT `context_snapshot_check` CHECK((`context_snapshot`.`mode` = 'summary') = (`context_snapshot`.`summary_text` is not null))
);
--> statement-breakpoint
CREATE TABLE `context_snapshot_message` (
	`snapshot_id` varchar(191) NOT NULL,
	`message_id` varchar(191) NOT NULL,
	`seq` int NOT NULL,
	CONSTRAINT `context_snapshot_message_snapshot_id_message_id_pk` PRIMARY KEY(`snapshot_id`,`message_id`)
);
--> statement-breakpoint
CREATE TABLE `conversation_input` (
	`id` varchar(191) NOT NULL,
	`task_id` varchar(191) NOT NULL,
	`source_task_id` varchar(191) NOT NULL,
	`weight` text NOT NULL,
	`mode` text NOT NULL,
	`snapshot_id` varchar(191) NOT NULL,
	`selected_by` varchar(191) NOT NULL,
	`selected_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `conversation_input_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversation_input_task_id_source_task_id_key` UNIQUE(`task_id`,`source_task_id`),
	CONSTRAINT `conversation_input_weight_check` CHECK(`conversation_input`.`weight` in ('main', 'reference')),
	CONSTRAINT `conversation_input_mode_check` CHECK(`conversation_input`.`mode` in ('full', 'messages', 'summary')),
	CONSTRAINT `conversation_input_check` CHECK(`conversation_input`.`task_id` <> `conversation_input`.`source_task_id`)
);
--> statement-breakpoint
CREATE TABLE `db_lock` (
	`lock_key` varchar(191) NOT NULL,
	CONSTRAINT `db_lock_lock_key` PRIMARY KEY(`lock_key`)
);
--> statement-breakpoint
CREATE TABLE `file_object` (
	`id` varchar(191) NOT NULL,
	`kind` text NOT NULL,
	`origin_task_id` varchar(191),
	`origin_sr_id` varchar(191),
	`original_name` varchar(255) NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` bigint NOT NULL,
	`sha256` char(64) NOT NULL,
	`storage_key` varchar(191) NOT NULL,
	`source` text NOT NULL,
	`is_output` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL,
	`previous_id` varchar(191),
	`uploaded_by` varchar(191) NOT NULL,
	`uploaded_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`deleted_at` datetime(6),
	`active_origin` varchar(191) GENERATED ALWAYS AS (case when deleted_at is null then coalesce(origin_task_id, origin_sr_id) else null end) STORED,
	CONSTRAINT `file_object_id` PRIMARY KEY(`id`),
	CONSTRAINT `file_object_storage_key_key` UNIQUE(`storage_key`),
	CONSTRAINT `file_object_version` UNIQUE(`active_origin`,`original_name`,`version`),
	CONSTRAINT `file_object_kind_check` CHECK(`file_object`.`kind` in ('task_file', 'sr_attachment', 'assistant_image')),
	CONSTRAINT `file_object_source_check` CHECK(`file_object`.`source` in ('upload', 'assistant')),
	CONSTRAINT `file_object_version_check` CHECK(`file_object`.`version` >= 1),
	CONSTRAINT `file_object_check` CHECK(not `file_object`.`is_output` or `file_object`.`kind` = 'task_file'),
	CONSTRAINT `file_object_check1` CHECK((`file_object`.`kind` = 'sr_attachment') = (`file_object`.`origin_sr_id` is not null))
);
--> statement-breakpoint
CREATE TABLE `file_remote_ref` (
	`file_id` varchar(191) NOT NULL,
	`scope_hash` varchar(191) NOT NULL,
	`remote_id` text NOT NULL,
	`uploaded_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `file_remote_ref_file_id_scope_hash_pk` PRIMARY KEY(`file_id`,`scope_hash`)
);
--> statement-breakpoint
CREATE TABLE `message` (
	`id` varchar(191) NOT NULL,
	`thread_id` varchar(191) NOT NULL,
	`seq` bigint NOT NULL,
	`role` text NOT NULL,
	`kind` text,
	`content` longtext NOT NULL,
	`author_id` varchar(191),
	`status` text NOT NULL,
	`error` longtext,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `message_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_thread_id_seq_key` UNIQUE(`thread_id`,`seq`),
	CONSTRAINT `message_role_check` CHECK(`message`.`role` in ('system', 'user', 'assistant')),
	CONSTRAINT `message_kind_check` CHECK(`message`.`kind` in ('discussion')),
	CONSTRAINT `message_status_check` CHECK(`message`.`status` in ('streaming', 'done', 'error'))
);
--> statement-breakpoint
CREATE TABLE `message_attachment` (
	`message_id` varchar(191) NOT NULL,
	`file_id` varchar(191) NOT NULL,
	CONSTRAINT `message_attachment_message_id_file_id_pk` PRIMARY KEY(`message_id`,`file_id`)
);
--> statement-breakpoint
CREATE TABLE `note` (
	`id` varchar(191) NOT NULL,
	`task_id` varchar(191) NOT NULL,
	`author_id` varchar(191) NOT NULL,
	`content` longtext NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `note_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `note_attachment` (
	`note_id` varchar(191) NOT NULL,
	`file_id` varchar(191) NOT NULL,
	CONSTRAINT `note_attachment_note_id_file_id_pk` PRIMARY KEY(`note_id`,`file_id`)
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`body` longtext NOT NULL DEFAULT '',
	`link` text NOT NULL,
	`at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`read_at` datetime(6),
	CONSTRAINT `notification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_request` (
	`id` varchar(191) NOT NULL,
	`code` varchar(191),
	`requester_id` varchar(191) NOT NULL,
	`title` text NOT NULL DEFAULT (''),
	`title_source` text NOT NULL,
	`body` longtext NOT NULL DEFAULT '',
	`status` text NOT NULL,
	`submitted_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `service_request_id` PRIMARY KEY(`id`),
	CONSTRAINT `service_request_code_key` UNIQUE(`code`),
	CONSTRAINT `service_request_title_source_check` CHECK(`service_request`.`title_source` in ('default', 'ai', 'manual')),
	CONSTRAINT `service_request_status_check` CHECK(`service_request`.`status` in ('draft', 'submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `shared_result` (
	`id` varchar(191) NOT NULL,
	`sr_id` varchar(191) NOT NULL,
	`task_id` varchar(191),
	`text` longtext NOT NULL DEFAULT '',
	`by_user` varchar(191) NOT NULL,
	`at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `shared_result_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shared_result_file` (
	`result_id` varchar(191) NOT NULL,
	`file_id` varchar(191) NOT NULL,
	CONSTRAINT `shared_result_file_result_id_file_id_pk` PRIMARY KEY(`result_id`,`file_id`)
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`key` varchar(191) NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `tag_key` PRIMARY KEY(`key`),
	CONSTRAINT `tag_kind_check` CHECK(`tag`.`kind` in ('sr', 'keyword'))
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` varchar(191) NOT NULL,
	`code` varchar(191) NOT NULL,
	`assistant_id` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`title_source` text NOT NULL,
	`summary` longtext NOT NULL DEFAULT '',
	`status` text NOT NULL,
	`owner_id` varchar(191) NOT NULL,
	`priority` text NOT NULL,
	`due_date` date,
	`model_id` text,
	`created_by` varchar(191) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`last_activity_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	`started_at` datetime(6),
	`completed_at` datetime(6),
	`completed_by` varchar(191),
	`idempotency_key` varchar(191),
	`deleted_at` datetime(6),
	CONSTRAINT `task_id` PRIMARY KEY(`id`),
	CONSTRAINT `task_code_key` UNIQUE(`code`),
	CONSTRAINT `task_idempotency_key_key` UNIQUE(`idempotency_key`),
	CONSTRAINT `task_title_source_check` CHECK(`task`.`title_source` in ('default', 'ai', 'manual')),
	CONSTRAINT `task_status_check` CHECK(`task`.`status` in ('todo', 'in_progress', 'on_hold', 'done')),
	CONSTRAINT `task_priority_check` CHECK(`task`.`priority` in ('low', 'normal', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE `task_assignee` (
	`task_id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	CONSTRAINT `task_assignee_task_id_user_id_pk` PRIMARY KEY(`task_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `task_feedback` (
	`task_id` varchar(191) NOT NULL,
	`rating` int NOT NULL,
	`comment` text NOT NULL DEFAULT (''),
	`by_user` varchar(191) NOT NULL,
	`at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `task_feedback_task_id` PRIMARY KEY(`task_id`),
	CONSTRAINT `task_feedback_rating_check` CHECK(`task_feedback`.`rating` between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE `task_input` (
	`task_id` varchar(191) NOT NULL,
	`file_id` varchar(191) NOT NULL,
	`weight` text NOT NULL,
	`sort_order` int NOT NULL,
	`selected_by` varchar(191) NOT NULL,
	`selected_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `task_input_task_id_file_id_pk` PRIMARY KEY(`task_id`,`file_id`),
	CONSTRAINT `task_input_weight_check` CHECK(`task_input`.`weight` in ('main', 'reference'))
);
--> statement-breakpoint
CREATE TABLE `task_tag` (
	`task_id` varchar(191) NOT NULL,
	`tag_key` varchar(191) NOT NULL,
	`added_by` varchar(191) NOT NULL,
	`added_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `task_tag_task_id_tag_key_pk` PRIMARY KEY(`task_id`,`tag_key`)
);
--> statement-breakpoint
CREATE TABLE `thread` (
	`id` varchar(191) NOT NULL,
	`task_id` varchar(191),
	`sr_id` varchar(191),
	`title` text NOT NULL,
	`model_id` text,
	`created_by` varchar(191) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `thread_id` PRIMARY KEY(`id`),
	CONSTRAINT `thread_task_id_key` UNIQUE(`task_id`),
	CONSTRAINT `thread_sr_id_key` UNIQUE(`sr_id`),
	CONSTRAINT `thread_check` CHECK((`thread`.`task_id` is null) <> (`thread`.`sr_id` is null))
);
--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_user_id_app_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_assistant_id_assistant_id_fk` FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_sr_id_service_request_id_fk` FOREIGN KEY (`sr_id`) REFERENCES `service_request`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_session` ADD CONSTRAINT `app_session_user_id_app_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant` ADD CONSTRAINT `assistant_level1_code_id_code_id_fk` FOREIGN KEY (`level1_code_id`) REFERENCES `code`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant` ADD CONSTRAINT `assistant_level2_code_id_code_id_fk` FOREIGN KEY (`level2_code_id`) REFERENCES `code`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant` ADD CONSTRAINT `assistant_owner_id_app_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant` ADD CONSTRAINT `assistant_image_file_id_file_object_id_fk` FOREIGN KEY (`image_file_id`) REFERENCES `file_object`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant` ADD CONSTRAINT `assistant_created_by_app_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant_checklist_template` ADD CONSTRAINT `assistant_checklist_template_assistant_id_assistant_id_fk` FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant_expected_io` ADD CONSTRAINT `assistant_expected_io_assistant_id_assistant_id_fk` FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request` ADD CONSTRAINT `chat_request_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request` ADD CONSTRAINT `chat_request_user_message_id_message_id_fk` FOREIGN KEY (`user_message_id`) REFERENCES `message`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request` ADD CONSTRAINT `chat_request_reply_message_id_message_id_fk` FOREIGN KEY (`reply_message_id`) REFERENCES `message`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request` ADD CONSTRAINT `chat_request_requested_by_app_user_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request` ADD CONSTRAINT `chat_request_retry_of_chat_request_id_fk` FOREIGN KEY (`retry_of`) REFERENCES `chat_request`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD CONSTRAINT `chat_request_input_request_id_chat_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `chat_request`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD CONSTRAINT `chat_request_input_file_id_file_object_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file_object`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD CONSTRAINT `chat_request_input_source_task_id_task_id_fk` FOREIGN KEY (`source_task_id`) REFERENCES `task`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD CONSTRAINT `chat_request_input_snapshot_id_context_snapshot_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `context_snapshot`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklist_item` ADD CONSTRAINT `checklist_item_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklist_item` ADD CONSTRAINT `checklist_item_checked_by_app_user_id_fk` FOREIGN KEY (`checked_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklist_item` ADD CONSTRAINT `checklist_item_template_item_id_fk` FOREIGN KEY (`template_item_id`) REFERENCES `assistant_checklist_template`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklist_review` ADD CONSTRAINT `checklist_review_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklist_review` ADD CONSTRAINT `checklist_review_by_user_app_user_id_fk` FOREIGN KEY (`by_user`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklist_review_item` ADD CONSTRAINT `checklist_review_item_review_id_checklist_review_id_fk` FOREIGN KEY (`review_id`) REFERENCES `checklist_review`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checklist_review_item` ADD CONSTRAINT `checklist_review_item_item_id_checklist_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `checklist_item`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `code` ADD CONSTRAINT `code_group_key_code_group_key_fk` FOREIGN KEY (`group_key`) REFERENCES `code_group`(`key`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `context_snapshot` ADD CONSTRAINT `context_snapshot_source_task_id_task_id_fk` FOREIGN KEY (`source_task_id`) REFERENCES `task`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `context_snapshot` ADD CONSTRAINT `context_snapshot_up_to_message_id_message_id_fk` FOREIGN KEY (`up_to_message_id`) REFERENCES `message`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `context_snapshot` ADD CONSTRAINT `context_snapshot_created_by_app_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `context_snapshot_message` ADD CONSTRAINT `context_snapshot_message_snapshot_id_context_snapshot_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `context_snapshot`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `context_snapshot_message` ADD CONSTRAINT `context_snapshot_message_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversation_input` ADD CONSTRAINT `conversation_input_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversation_input` ADD CONSTRAINT `conversation_input_source_task_id_task_id_fk` FOREIGN KEY (`source_task_id`) REFERENCES `task`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversation_input` ADD CONSTRAINT `conversation_input_snapshot_id_context_snapshot_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `context_snapshot`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversation_input` ADD CONSTRAINT `conversation_input_selected_by_app_user_id_fk` FOREIGN KEY (`selected_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_origin_task_id_task_id_fk` FOREIGN KEY (`origin_task_id`) REFERENCES `task`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_origin_sr_id_service_request_id_fk` FOREIGN KEY (`origin_sr_id`) REFERENCES `service_request`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_previous_id_file_object_id_fk` FOREIGN KEY (`previous_id`) REFERENCES `file_object`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_uploaded_by_app_user_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `file_remote_ref` ADD CONSTRAINT `file_remote_ref_file_id_file_object_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file_object`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message` ADD CONSTRAINT `message_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message` ADD CONSTRAINT `message_author_id_app_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_attachment` ADD CONSTRAINT `message_attachment_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_attachment` ADD CONSTRAINT `message_attachment_file_id_file_object_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file_object`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `note` ADD CONSTRAINT `note_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `note` ADD CONSTRAINT `note_author_id_app_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `note_attachment` ADD CONSTRAINT `note_attachment_note_id_note_id_fk` FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `note_attachment` ADD CONSTRAINT `note_attachment_file_id_file_object_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file_object`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification` ADD CONSTRAINT `notification_user_id_app_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_request` ADD CONSTRAINT `service_request_requester_id_app_user_id_fk` FOREIGN KEY (`requester_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_result` ADD CONSTRAINT `shared_result_sr_id_service_request_id_fk` FOREIGN KEY (`sr_id`) REFERENCES `service_request`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_result` ADD CONSTRAINT `shared_result_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_result` ADD CONSTRAINT `shared_result_by_user_app_user_id_fk` FOREIGN KEY (`by_user`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_result_file` ADD CONSTRAINT `shared_result_file_result_id_shared_result_id_fk` FOREIGN KEY (`result_id`) REFERENCES `shared_result`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_result_file` ADD CONSTRAINT `shared_result_file_file_id_file_object_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file_object`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_assistant_id_assistant_id_fk` FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_owner_id_app_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_created_by_app_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_completed_by_app_user_id_fk` FOREIGN KEY (`completed_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_assignee` ADD CONSTRAINT `task_assignee_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_assignee` ADD CONSTRAINT `task_assignee_user_id_app_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_feedback` ADD CONSTRAINT `task_feedback_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_feedback` ADD CONSTRAINT `task_feedback_by_user_app_user_id_fk` FOREIGN KEY (`by_user`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_input` ADD CONSTRAINT `task_input_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_input` ADD CONSTRAINT `task_input_file_id_file_object_id_fk` FOREIGN KEY (`file_id`) REFERENCES `file_object`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_input` ADD CONSTRAINT `task_input_selected_by_app_user_id_fk` FOREIGN KEY (`selected_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_tag` ADD CONSTRAINT `task_tag_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_tag` ADD CONSTRAINT `task_tag_tag_key_tag_key_fk` FOREIGN KEY (`tag_key`) REFERENCES `tag`(`key`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_tag` ADD CONSTRAINT `task_tag_added_by_app_user_id_fk` FOREIGN KEY (`added_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `thread` ADD CONSTRAINT `thread_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `thread` ADD CONSTRAINT `thread_sr_id_service_request_id_fk` FOREIGN KEY (`sr_id`) REFERENCES `service_request`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `thread` ADD CONSTRAINT `thread_created_by_app_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `app_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_by_task` ON `activity_log` (`task_id`,`at`);--> statement-breakpoint
CREATE INDEX `app_session_user` ON `app_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversation_input_by_source` ON `conversation_input` (`source_task_id`);--> statement-breakpoint
CREATE INDEX `file_object_origin_task` ON `file_object` (`origin_task_id`);--> statement-breakpoint
CREATE INDEX `file_object_origin_sr` ON `file_object` (`origin_sr_id`);--> statement-breakpoint
CREATE INDEX `notification_unread` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `task_assistant` ON `task` (`assistant_id`);--> statement-breakpoint
CREATE INDEX `task_last_activity` ON `task` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `task_input_by_file` ON `task_input` (`file_id`);--> statement-breakpoint
CREATE INDEX `task_tag_by_tag` ON `task_tag` (`tag_key`);