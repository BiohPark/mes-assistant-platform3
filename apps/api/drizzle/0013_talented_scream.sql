CREATE TABLE `task_brief` (
	`task_id` varchar(191) NOT NULL,
	`about` text NOT NULL,
	`next_action` text NOT NULL,
	`source` text NOT NULL,
	`model` text,
	`based_on_seq` bigint NOT NULL,
	`generated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
	CONSTRAINT `task_brief_task_id` PRIMARY KEY(`task_id`),
	CONSTRAINT `task_brief_source_check` CHECK(`task_brief`.`source` in ('ai', 'rule'))
);
--> statement-breakpoint
ALTER TABLE `task_brief` ADD CONSTRAINT `task_brief_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;