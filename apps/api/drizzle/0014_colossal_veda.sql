CREATE TABLE `sr_input` (
	`task_id` varchar(191) NOT NULL,
	`sr_id` varchar(191) NOT NULL,
	CONSTRAINT `sr_input_task_id_sr_id_pk` PRIMARY KEY(`task_id`,`sr_id`)
);
--> statement-breakpoint
ALTER TABLE `chat_request_input` DROP CONSTRAINT `chat_request_input_kind_check`;--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD `sr_id` varchar(191);--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD `sr_snapshot` json;--> statement-breakpoint
ALTER TABLE `sr_input` ADD CONSTRAINT `sr_input_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sr_input` ADD CONSTRAINT `sr_input_sr_id_service_request_id_fk` FOREIGN KEY (`sr_id`) REFERENCES `service_request`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD CONSTRAINT `chat_request_input_sr_check` CHECK ((`chat_request_input`.`kind` = 'sr') = (`chat_request_input`.`sr_id` is not null) and (`chat_request_input`.`kind` = 'sr') = (`chat_request_input`.`sr_snapshot` is not null));--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD CONSTRAINT `chat_request_input_kind_check` CHECK (`chat_request_input`.`kind` in ('file', 'conversation', 'sr'));--> statement-breakpoint
ALTER TABLE `chat_request_input` ADD CONSTRAINT `chat_request_input_sr_id_service_request_id_fk` FOREIGN KEY (`sr_id`) REFERENCES `service_request`(`id`) ON DELETE no action ON UPDATE no action;