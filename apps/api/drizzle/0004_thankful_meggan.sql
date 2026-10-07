ALTER TABLE `app_user` ADD `theme` varchar(8) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_user` ADD `locale` varchar(8) DEFAULT 'ko' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_user` ADD CONSTRAINT `app_user_theme_check` CHECK (`app_user`.`theme` in ('system', 'light', 'dark'));--> statement-breakpoint
ALTER TABLE `app_user` ADD CONSTRAINT `app_user_locale_check` CHECK (`app_user`.`locale` in ('ko', 'en'));