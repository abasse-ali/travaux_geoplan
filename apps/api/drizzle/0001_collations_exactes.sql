-- ============================================================
-- Identifiants et jetons comparés à l'octet près
--
-- La collation par défaut de MySQL 8 (utf8mb4_0900_ai_ci) ignore la
-- casse et les accents. Pour un nom, c'est ce qu'on veut ; pour un
-- identifiant ou un jeton, non : « p_Erwan » retrouvait « p_erwan », et
-- un jeton base64url modifié en casse retrouvait sa ligne. Le code
-- compensait par une comparaison exacte en JavaScript ; la base
-- l'applique désormais elle-même, unicité comprise.
--
-- Colonnes liées par clé étrangère : les deux côtés doivent avoir la
-- même collation, d'où la suspension des vérifications le temps de la
-- modification (la migration s'exécute sur une seule connexion).
-- ============================================================
SET FOREIGN_KEY_CHECKS = 0;
--> statement-breakpoint
ALTER TABLE `people` MODIFY `id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
--> statement-breakpoint
ALTER TABLE `sites` MODIFY `id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` MODIFY `id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
--> statement-breakpoint
ALTER TABLE `assignments`
  MODIFY `site_id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY `person_id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
--> statement-breakpoint
ALTER TABLE `avail_requests`
  MODIFY `id` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY `person_id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
--> statement-breakpoint
SET FOREIGN_KEY_CHECKS = 1;
