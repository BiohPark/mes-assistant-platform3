ALTER TABLE `task` MODIFY COLUMN `status` varchar(32) NOT NULL;--> statement-breakpoint
CREATE INDEX `task_status_last_activity` ON `task` (`status`,`last_activity_at`);