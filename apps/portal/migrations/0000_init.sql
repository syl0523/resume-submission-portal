CREATE TABLE `ai_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`resume_id` text,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`output` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_reports_application_idx` ON `ai_reports` (`application_id`,`kind`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_uq` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`source` text NOT NULL,
	`summary` text NOT NULL,
	`inbound_email_id` text,
	`scheduled_at` text,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_application_idx` ON `application_events` (`application_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `events_user_idx` ON `application_events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `events_user_scheduled_idx` ON `application_events` (`user_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`resume_id` text,
	`status` text NOT NULL,
	`applied_at` text,
	`applied_via` text,
	`last_activity_at` text NOT NULL,
	`next_follow_up_at` text,
	`notes` text,
	`fit_score` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_job_uq` ON `applications` (`job_id`);--> statement-breakpoint
CREATE INDEX `applications_user_status_idx` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `applications_user_activity_idx` ON `applications` (`user_id`,`last_activity_at`);--> statement-breakpoint
CREATE TABLE `board_postings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`board_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`url` text NOT NULL,
	`posted_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`saved_application_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `watched_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `postings_board_external_uq` ON `board_postings` (`board_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `postings_user_seen_idx` ON `board_postings` (`user_id`,`first_seen_at`);--> statement-breakpoint
CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text,
	`from_address` text NOT NULL,
	`subject` text NOT NULL,
	`received_at` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`company` text,
	`job_title` text,
	`confidence` real NOT NULL,
	`classifier` text DEFAULT 'rules' NOT NULL,
	`application_id` text,
	`status` text NOT NULL,
	`error` text,
	`snippet` text,
	`raw_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_user_message_uq` ON `inbound_emails` (`user_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `inbound_user_status_idx` ON `inbound_emails` (`user_id`,`status`,`received_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`url` text,
	`url_key` text,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`company_key` text NOT NULL,
	`location` text,
	`remote_type` text DEFAULT 'unknown' NOT NULL,
	`employment_type` text,
	`salary_min` integer,
	`salary_max` integer,
	`salary_currency` text,
	`description` text,
	`posted_at` text,
	`captured_via` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_user_url_key_uq` ON `jobs` (`user_id`,`url_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_user_source_external_uq` ON `jobs` (`user_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `jobs_user_company_idx` ON `jobs` (`user_id`,`company_key`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`full_name` text,
	`headline` text,
	`email` text,
	`phone` text,
	`location` text,
	`linkedin_url` text,
	`website_url` text,
	`github_url` text,
	`work_authorization` text,
	`summary` text,
	`address` text,
	`skills` text DEFAULT '[]' NOT NULL,
	`languages` text DEFAULT '[]' NOT NULL,
	`experience` text DEFAULT '[]' NOT NULL,
	`education` text DEFAULT '[]' NOT NULL,
	`custom_answers` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`file_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`text_content` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resumes_user_idx` ON `resumes` (`user_id`);--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`resume_id` text,
	`titles` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`locations` text DEFAULT '[]' NOT NULL,
	`work_mode` text DEFAULT 'any' NOT NULL,
	`seniority` text,
	`keywords` text DEFAULT '[]' NOT NULL,
	`exclude_keywords` text DEFAULT '[]' NOT NULL,
	`min_salary` integer,
	`posted_within_days` integer DEFAULT 7 NOT NULL,
	`needs_sponsorship` integer DEFAULT false NOT NULL,
	`summary` text,
	`alerts_enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `searches_user_idx` ON `saved_searches` (`user_id`);--> statement-breakpoint
CREATE TABLE `search_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`search_id` text NOT NULL,
	`url_key` text NOT NULL,
	`provider` text NOT NULL,
	`source_label` text NOT NULL,
	`job` text NOT NULL,
	`fit` text NOT NULL,
	`fit_score` integer NOT NULL,
	`ai_fit` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`is_new` integer DEFAULT false NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`application_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`search_id`) REFERENCES `saved_searches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hits_search_url_uq` ON `search_hits` (`search_id`,`url_key`);--> statement-breakpoint
CREATE INDEX `hits_user_search_score_idx` ON `search_hits` (`user_id`,`search_id`,`fit_score`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`inbound_alias` text NOT NULL,
	`calendar_token` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_inbound_alias_uq` ON `users` (`inbound_alias`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_calendar_token_uq` ON `users` (`calendar_token`);--> statement-breakpoint
CREATE TABLE `watched_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`token` text NOT NULL,
	`company_name` text NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boards_user_provider_token_uq` ON `watched_boards` (`user_id`,`provider`,`token`);