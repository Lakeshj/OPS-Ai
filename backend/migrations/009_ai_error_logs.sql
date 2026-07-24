CREATE TABLE IF NOT EXISTS ai_error_logs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  capability_type VARCHAR(50) NULL,
  assistant_id VARCHAR(36) NULL,
  workspace_id VARCHAR(36) NULL,
  thread_id VARCHAR(36) NULL,
  user_id VARCHAR(36) NULL,
  status_code INT NULL,
  error_code VARCHAR(100) NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_error_logs_created (created_at),
  INDEX idx_ai_error_logs_provider_model (provider, model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_model_status (
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  available TINYINT(1) NOT NULL DEFAULT 1,
  last_error TEXT NULL,
  last_status_code INT NULL,
  fail_count INT NOT NULL DEFAULT 0,
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
