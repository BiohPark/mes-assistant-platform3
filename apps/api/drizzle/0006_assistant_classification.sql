CREATE TABLE `assistant_classification` (
	`assistant_id` varchar(191) NOT NULL,
	`level1_code_id` varchar(191) NOT NULL,
	`level2_code_id` varchar(191) NOT NULL,
	`sort_order` int NOT NULL,
	CONSTRAINT `assistant_classification_pk` PRIMARY KEY(`assistant_id`,`level1_code_id`,`level2_code_id`),
	CONSTRAINT `assistant_classification_order_key` UNIQUE(`assistant_id`,`sort_order`),
	CONSTRAINT `assistant_classification_order_check` CHECK(`assistant_classification`.`sort_order` >= 0)
);
--> statement-breakpoint
ALTER TABLE `assistant_classification` ADD CONSTRAINT `assistant_classification_assistant_id_assistant_id_fk` FOREIGN KEY (`assistant_id`) REFERENCES `assistant`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant_classification` ADD CONSTRAINT `assistant_classification_level1_code_id_code_id_fk` FOREIGN KEY (`level1_code_id`) REFERENCES `code`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assistant_classification` ADD CONSTRAINT `assistant_classification_level2_code_id_code_id_fk` FOREIGN KEY (`level2_code_id`) REFERENCES `code`(`id`) ON DELETE no action ON UPDATE no action;