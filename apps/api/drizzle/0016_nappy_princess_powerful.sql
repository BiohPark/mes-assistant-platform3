ALTER TABLE `file_object` DROP CONSTRAINT `file_object_kind_check`;--> statement-breakpoint
ALTER TABLE `file_object` DROP CONSTRAINT `file_object_check`;--> statement-breakpoint
ALTER TABLE `file_object` DROP CONSTRAINT `file_object_check1`;--> statement-breakpoint
ALTER TABLE `message` ADD `original_content` longtext;--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_ai_output_origin_check` CHECK (`file_object`.`kind` <> 'ai_output' or ((`file_object`.`origin_task_id` is null) <> (`file_object`.`origin_sr_id` is null)));--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_kind_check` CHECK (`file_object`.`kind` in ('task_file', 'sr_attachment', 'assistant_image', 'ai_output'));--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_check` CHECK (not `file_object`.`is_output` or `file_object`.`kind` in ('task_file', 'ai_output'));--> statement-breakpoint
ALTER TABLE `file_object` ADD CONSTRAINT `file_object_check1` CHECK ((`file_object`.`kind` = 'sr_attachment') = (`file_object`.`origin_sr_id` is not null and `file_object`.`kind` <> 'ai_output'));