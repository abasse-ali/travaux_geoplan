CREATE TABLE `assignments` (
	`site_id` varchar(40) NOT NULL,
	`day` date NOT NULL,
	`person_id` varchar(40) NOT NULL,
	`urgence` boolean NOT NULL DEFAULT false,
	`occupe` tinyint,
	`position` smallint NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `assignments_pk` PRIMARY KEY(`site_id`,`day`,`person_id`),
	CONSTRAINT `un_homme_un_jour` UNIQUE(`day`,`person_id`,`occupe`),
	CONSTRAINT `urgence_explicite` CHECK((`assignments`.`urgence` = 1 and `assignments`.`occupe` is null) or (`assignments`.`urgence` = 0 and coalesce(`assignments`.`occupe`, 0) = 1))
);
--> statement-breakpoint
CREATE TABLE `avail_requests` (
	`id` varchar(60) NOT NULL,
	`token` varchar(64) NOT NULL,
	`person_id` varchar(40) NOT NULL,
	`week` date NOT NULL,
	`days` json,
	`note` varchar(300) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`expires_at` datetime(3) NOT NULL,
	`answered_at` datetime(3),
	`sent_at` datetime(3),
	CONSTRAINT `avail_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `avail_requests_token_unique` UNIQUE(`token`),
	CONSTRAINT `une_demande_par_semaine` UNIQUE(`person_id`,`week`)
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job` varchar(40) NOT NULL,
	`cle` varchar(60) NOT NULL,
	`a_blanc` boolean NOT NULL,
	`started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`finished_at` datetime(3),
	`bilan` json,
	CONSTRAINT `job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` varchar(40) NOT NULL,
	`name` varchar(60) NOT NULL,
	`phone` varchar(20) NOT NULL DEFAULT '',
	`email` varchar(120) NOT NULL DEFAULT '',
	`days` json NOT NULL,
	`permis` boolean NOT NULL DEFAULT false,
	`sk` json NOT NULL,
	`note` varchar(300) NOT NULL DEFAULT '',
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `people_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` varchar(40) NOT NULL,
	`code` varchar(20) NOT NULL,
	`addr` varchar(120) NOT NULL DEFAULT '',
	`start_date` date NOT NULL,
	`months` tinyint NOT NULL,
	`coef` double NOT NULL,
	`ph` json NOT NULL,
	`note` varchar(2000) NOT NULL DEFAULT '',
	`tasks` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(40) NOT NULL,
	`email` varchar(120) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_person_id_people_id_fk` FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `avail_requests` ADD CONSTRAINT `avail_requests_person_id_people_id_fk` FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `affectations_par_jour` ON `assignments` (`day`);--> statement-breakpoint
CREATE INDEX `affectations_par_personne` ON `assignments` (`person_id`);--> statement-breakpoint
CREATE INDEX `demandes_par_semaine` ON `avail_requests` (`week`);--> statement-breakpoint
CREATE INDEX `taches_par_cle` ON `job_runs` (`job`,`cle`);--> statement-breakpoint
CREATE INDEX `sites_par_debut` ON `sites` (`start_date`);