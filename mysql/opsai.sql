-- OpsAi full schema dump (auto-generated)
-- Import: mysql -u root -p < mysql/opsai.sql
-- Then optionally: cd backend && npm run db:migrate  (safe if schema_migrations is seeded)

CREATE DATABASE IF NOT EXISTS `opsai` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `opsai`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';


-- ----------------------------
-- Table: admin_ai_settings
-- ----------------------------
DROP TABLE IF EXISTS `admin_ai_settings`;
CREATE TABLE `admin_ai_settings` (
  `id` tinyint unsigned NOT NULL DEFAULT '1',
  `summary_model` varchar(100) NOT NULL DEFAULT 'gpt-4o-mini',
  `evaluation_model` varchar(100) NOT NULL DEFAULT 'gpt-4o-mini',
  `evaluation_prompt` longtext NOT NULL,
  `updated_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_admin_ai_settings_user` (`updated_by`),
  CONSTRAINT `fk_admin_ai_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_single_admin_ai_settings` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: ai_error_logs
-- ----------------------------
DROP TABLE IF EXISTS `ai_error_logs`;
CREATE TABLE `ai_error_logs` (
  `id` varchar(36) NOT NULL,
  `provider` varchar(50) NOT NULL,
  `model` varchar(100) NOT NULL,
  `capability_type` varchar(50) DEFAULT NULL,
  `assistant_id` varchar(36) DEFAULT NULL,
  `workspace_id` varchar(36) DEFAULT NULL,
  `thread_id` varchar(36) DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `status_code` int DEFAULT NULL,
  `error_code` varchar(100) DEFAULT NULL,
  `message` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_error_logs_created` (`created_at`),
  KEY `idx_ai_error_logs_provider_model` (`provider`,`model`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: ai_model_status
-- ----------------------------
DROP TABLE IF EXISTS `ai_model_status`;
CREATE TABLE `ai_model_status` (
  `provider` varchar(50) NOT NULL,
  `model` varchar(100) NOT NULL,
  `available` tinyint(1) NOT NULL DEFAULT '1',
  `last_error` text,
  `last_status_code` int DEFAULT NULL,
  `fail_count` int NOT NULL DEFAULT '0',
  `last_success_at` datetime DEFAULT NULL,
  `last_failure_at` datetime DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`provider`,`model`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: ai_usage_events
-- ----------------------------
DROP TABLE IF EXISTS `ai_usage_events`;
CREATE TABLE `ai_usage_events` (
  `id` varchar(36) NOT NULL,
  `workspace_id` varchar(36) NOT NULL,
  `thread_id` varchar(36) DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `assistant_id` varchar(36) DEFAULT NULL,
  `model` varchar(100) NOT NULL,
  `input_tokens` int unsigned NOT NULL DEFAULT '0',
  `cached_tokens` int unsigned NOT NULL DEFAULT '0',
  `cache_write_tokens` int unsigned NOT NULL DEFAULT '0',
  `output_tokens` int unsigned NOT NULL DEFAULT '0',
  `total_tokens` int unsigned NOT NULL DEFAULT '0',
  `latency_ms` int unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_usage_workspace_time` (`workspace_id`,`created_at`),
  KEY `idx_ai_usage_thread_time` (`thread_id`,`created_at`),
  KEY `fk_ai_usage_user` (`user_id`),
  KEY `fk_ai_usage_assistant` (`assistant_id`),
  CONSTRAINT `fk_ai_usage_assistant` FOREIGN KEY (`assistant_id`) REFERENCES `keyword_assistants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ai_usage_thread` FOREIGN KEY (`thread_id`) REFERENCES `chat_threads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ai_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ai_usage_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: chat_messages
-- ----------------------------
DROP TABLE IF EXISTS `chat_messages`;
CREATE TABLE `chat_messages` (
  `id` varchar(36) NOT NULL,
  `thread_id` varchar(36) NOT NULL,
  `content` text NOT NULL,
  `is_user_message` tinyint(1) NOT NULL,
  `created_at` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `thread_id` (`thread_id`),
  CONSTRAINT `chat_messages_ibfk_1` FOREIGN KEY (`thread_id`) REFERENCES `chat_threads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: chat_session_memory
-- ----------------------------
DROP TABLE IF EXISTS `chat_session_memory`;
CREATE TABLE `chat_session_memory` (
  `thread_id` varchar(36) NOT NULL,
  `summary` longtext NOT NULL,
  `key_decisions` json DEFAULT NULL,
  `active_tasks` json DEFAULT NULL,
  `working_context` longtext,
  `last_assistant_id` varchar(36) DEFAULT NULL,
  `summarized_through_message_id` varchar(36) DEFAULT NULL,
  `summary_token_count` int unsigned NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`thread_id`),
  KEY `idx_session_memory_assistant` (`last_assistant_id`),
  KEY `fk_session_memory_message` (`summarized_through_message_id`),
  CONSTRAINT `fk_session_memory_assistant` FOREIGN KEY (`last_assistant_id`) REFERENCES `keyword_assistants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_session_memory_message` FOREIGN KEY (`summarized_through_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_session_memory_thread` FOREIGN KEY (`thread_id`) REFERENCES `chat_threads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: chat_threads
-- ----------------------------
DROP TABLE IF EXISTS `chat_threads`;
CREATE TABLE `chat_threads` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `workspace_id` varchar(36) NOT NULL,
  `folder_id` varchar(36) DEFAULT NULL,
  `created_by` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workspace_id` (`workspace_id`),
  KEY `folder_id` (`folder_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `chat_threads_ibfk_1` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chat_threads_ibfk_2` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chat_threads_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: document_chunks
-- ----------------------------
DROP TABLE IF EXISTS `document_chunks`;
CREATE TABLE `document_chunks` (
  `id` varchar(36) NOT NULL,
  `document_id` varchar(36) NOT NULL,
  `chunk_index` int unsigned NOT NULL,
  `heading` varchar(500) DEFAULT NULL,
  `content` longtext NOT NULL,
  `content_hash` char(64) NOT NULL,
  `token_count` int unsigned NOT NULL DEFAULT '0',
  `embedding` json DEFAULT NULL,
  `embedding_model` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_chunk_index` (`document_id`,`chunk_index`),
  KEY `idx_document_chunks_hash` (`document_id`,`content_hash`),
  CONSTRAINT `fk_document_chunks_document` FOREIGN KEY (`document_id`) REFERENCES `workspace_documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: folders
-- ----------------------------
DROP TABLE IF EXISTS `folders`;
CREATE TABLE `folders` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `workspace_id` varchar(36) NOT NULL,
  `created_by` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workspace_id` (`workspace_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `folders_ibfk_1` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `folders_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: keyword_assistants
-- ----------------------------
DROP TABLE IF EXISTS `keyword_assistants`;
CREATE TABLE `keyword_assistants` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `task_type` varchar(255) NOT NULL,
  `capability_type` varchar(50) NOT NULL DEFAULT 'chat',
  `provider` varchar(50) NOT NULL DEFAULT 'openai',
  `model` varchar(100) NOT NULL DEFAULT 'gpt-4o-mini',
  `prompt_template` text NOT NULL,
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: password_reset_otps
-- ----------------------------
DROP TABLE IF EXISTS `password_reset_otps`;
CREATE TABLE `password_reset_otps` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `verified_at` datetime DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: schema_migrations
-- ----------------------------
DROP TABLE IF EXISTS `schema_migrations`;
CREATE TABLE `schema_migrations` (
  `name` varchar(255) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: system_prompts
-- ----------------------------
DROP TABLE IF EXISTS `system_prompts`;
CREATE TABLE `system_prompts` (
  `id` char(36) NOT NULL,
  `use_case_key` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL,
  `description` text,
  `prompt_content` longtext NOT NULL,
  `config_json` json NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_system_prompts_use_case` (`use_case_key`),
  KEY `idx_system_prompts_active` (`is_active`),
  KEY `fk_system_prompts_created_by` (`created_by`),
  CONSTRAINT `fk_system_prompts_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role` enum('Admin','Project Manager','Employee') NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: workspace_documents
-- ----------------------------
DROP TABLE IF EXISTS `workspace_documents`;
CREATE TABLE `workspace_documents` (
  `id` varchar(36) NOT NULL,
  `workspace_id` varchar(36) NOT NULL,
  `uploaded_by` varchar(36) DEFAULT NULL,
  `original_name` varchar(255) NOT NULL,
  `storage_key` varchar(512) DEFAULT NULL,
  `markdown_storage_key` varchar(512) DEFAULT NULL,
  `mime_type` varchar(150) NOT NULL,
  `file_extension` varchar(20) NOT NULL,
  `size_bytes` bigint unsigned NOT NULL,
  `sha256` char(64) NOT NULL,
  `status` enum('uploaded','converting','ready','failed') NOT NULL DEFAULT 'uploaded',
  `included_in_summary` tinyint(1) NOT NULL DEFAULT '1',
  `error_message` varchar(1000) DEFAULT NULL,
  `token_count` int unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_document_hash` (`workspace_id`,`sha256`),
  KEY `idx_workspace_documents_status` (`workspace_id`,`status`),
  KEY `fk_workspace_documents_uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_workspace_documents_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_workspace_documents_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: workspace_static_memory
-- ----------------------------
DROP TABLE IF EXISTS `workspace_static_memory`;
CREATE TABLE `workspace_static_memory` (
  `workspace_id` varchar(36) NOT NULL,
  `version` bigint unsigned NOT NULL DEFAULT '1',
  `core_markdown` longtext NOT NULL,
  `content_hash` char(64) DEFAULT NULL,
  `updated_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`),
  KEY `fk_static_memory_updated_by` (`updated_by`),
  CONSTRAINT `fk_static_memory_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_static_memory_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: workspace_summaries
-- ----------------------------
DROP TABLE IF EXISTS `workspace_summaries`;
CREATE TABLE `workspace_summaries` (
  `workspace_id` varchar(36) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `content` longtext NOT NULL,
  `source` enum('auto','manual','restored') NOT NULL DEFAULT 'auto',
  `document_snapshot` json NOT NULL,
  `evaluation_score` decimal(5,2) DEFAULT NULL,
  `evaluation_feedback` longtext,
  `evaluation_details` json DEFAULT NULL,
  `summary_model` varchar(100) DEFAULT NULL,
  `evaluation_model` varchar(100) DEFAULT NULL,
  `updated_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`),
  KEY `fk_workspace_summaries_user` (`updated_by`),
  CONSTRAINT `fk_workspace_summaries_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_workspace_summaries_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: workspace_summary_versions
-- ----------------------------
DROP TABLE IF EXISTS `workspace_summary_versions`;
CREATE TABLE `workspace_summary_versions` (
  `id` varchar(36) NOT NULL,
  `workspace_id` varchar(36) NOT NULL,
  `version` int unsigned NOT NULL,
  `content` longtext NOT NULL,
  `source` enum('auto','manual','restored') NOT NULL,
  `document_snapshot` json NOT NULL,
  `evaluation_score` decimal(5,2) DEFAULT NULL,
  `evaluation_feedback` longtext,
  `evaluation_details` json DEFAULT NULL,
  `summary_model` varchar(100) DEFAULT NULL,
  `evaluation_model` varchar(100) DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_summary_version` (`workspace_id`,`version`),
  KEY `idx_workspace_summary_versions_time` (`workspace_id`,`created_at`),
  KEY `fk_workspace_summary_versions_user` (`created_by`),
  CONSTRAINT `fk_workspace_summary_versions_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_workspace_summary_versions_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: workspace_users
-- ----------------------------
DROP TABLE IF EXISTS `workspace_users`;
CREATE TABLE `workspace_users` (
  `workspace_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  PRIMARY KEY (`workspace_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `workspace_users_ibfk_1` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_users_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Table: workspaces
-- ----------------------------
DROP TABLE IF EXISTS `workspaces`;
CREATE TABLE `workspaces` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `created_by` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `workspaces_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Seed: users (change passwords in production)
-- ----------------------------
INSERT INTO `users` (`id`, `name`, `email`, `password`, `role`, `created_at`, `updated_at`)
VALUES
  ('fd5fa0ec-0b36-4530-a685-1460e984c4a6', 'Admin user', 'admin@example.com', '$2b$10$TR74E3ClZpDGBuljfwIXLe8MPXBs7uhOov.hD9SibObeMUuNBL4NG', 'Admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE `email` = VALUES(`email`);

-- ----------------------------
-- Seed: schema_migrations
-- ----------------------------
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("001_stage1_memory.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("002_nullable_original_storage.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("003_workspace_summaries_and_models.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("004_category_evaluation_prompt.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("005_system_prompts.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("006_platform_system_prompts.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("007_system_prompt_use_cases.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("008_assistant_provider.sql");
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ("009_ai_error_logs.sql");

-- ----------------------------
-- Seed: admin_ai_settings
-- ----------------------------
INSERT INTO `admin_ai_settings` (`id`, `summary_model`, `evaluation_model`, `evaluation_prompt`)
VALUES (1, 'gpt-4o-mini', 'gpt-4o-mini', '# ROLE\n\nYou are **OpsAi Workspace Knowledge Evaluator**.\n\nYour responsibility is NOT to evaluate writing quality.\n\nYour responsibility is to evaluate whether the uploaded Workspace Knowledge Repository contains sufficient, structured and actionable intelligence for AI Assistants to answer workspace chat correctly — without the user re-explaining what the business is, who customers are, how work runs, or what rules apply.\n\nThe Workspace belongs to marketing teams working across industries such as Healthcare, Real Estate, Education, eCommerce, SaaS, Manufacturing, Hospitality and others.\n\nThe output should help Project Managers / Workspace Managers understand:\n\n• What information already exists\n• What information is missing\n• What should be uploaded next\n• How AI-ready this Workspace is for chat\n\n----------------------------------------------------\n\n# OBJECTIVE\n\nEvaluate the uploaded knowledge repository and calculate an overall AI Readiness Score (0-100).\n\nThe score represents how effectively an AI Assistant can understand the workspace and generate accurate, context-aware responses in chat.\n\nDO NOT reward document length.\nDO NOT reward writing style.\nReward only useful intelligence for AI answers.\n\n----------------------------------------------------\n\n# SCORING PILLARS\n\n## 1. Business Intelligence (20%)\nEvaluate whether AI understands the business itself: company overview, products/services, revenue model, business model, industry, USP, competitors, objectives, geography, terminology, offerings.\n\n## 2. Customer Intelligence (15%)\nEvaluate whether AI understands customers: segments, personas, ICP, decision makers, pain points, motivations, triggers, objections, journey, JTBD, FAQs, customer language.\n\n## 3. Brand Intelligence (15%)\nEvaluate whether AI understands brand communication: positioning, promise, mission, vision, values, tone, messaging, creative/writing style, guidelines, dos & don\'ts, approved terminology.\n\n## 4. Marketing Intelligence (15%)\nEvaluate whether AI understands marketing strategy: objectives, SEO/GEO, social, paid, content pillars, campaigns, funnel, channels, KPIs, keywords, learnings, competitor marketing.\n\n## 5. Operational Intelligence (15%)\nEvaluate whether AI understands how the workspace operates: workflows, processes, roles/responsibilities, tools/stack, handoffs, SLAs, decision rights, recurring rituals, \"how we do X\".\n\n## 6. Constraints / Guardrails (10%)\nEvaluate whether AI knows hard rules: legal/compliance limits, claim restrictions, must-not-say, approval requirements, brand/safety constraints, scope boundaries.\n\n## 7. Chat Coverage (10%)\nEvaluate whether a typical workspace user could chat productively without re-explaining basics (who we are, who we serve, what we sell/offer, how we work, what not to do). Score low if AI would still need the user to fill core context.\n\nScore every selected pillar from 0-100 using: 0-20 Very Limited, 21-40 Basic, 41-60 Developing, 61-80 Good, 81-90 Strong, 91-100 Excellent. Never give 100 unless exceptionally complete.\n\nOnly score pillars that are selected in the system prompt configuration. If a selected pillar has a different weight in config, still score 0-100 per pillar; overall score may be weighted separately.\n\n----------------------------------------------------\n\n# STRENGTHS / GAPS / RECOMMENDATIONS / CONFIDENCE\n\nIdentify strongest areas (why useful for AI chat), biggest missing knowledge, practical next uploads prioritized by impact on chat quality, and confidence (Low/Medium/High/Very High) with a reason.\n\nNever invent information. If a topic is not present, consider it missing.')
ON DUPLICATE KEY UPDATE
  `summary_model` = VALUES(`summary_model`),
  `evaluation_model` = VALUES(`evaluation_model`),
  `evaluation_prompt` = VALUES(`evaluation_prompt`);


SET FOREIGN_KEY_CHECKS = 1;
