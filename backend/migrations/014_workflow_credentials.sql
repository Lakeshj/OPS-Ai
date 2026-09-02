-- Workflow credentials: secrets referenced by id from node config so they
-- never live in plaintext inside workflows.definition_json.
CREATE TABLE IF NOT EXISTS workflow_credentials (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type ENUM('bearer', 'api_key_header', 'basic', 'query_param') NOT NULL,
  secret_json TEXT NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workflow_credentials_name (workspace_id, name),
  INDEX idx_workflow_credentials_workspace (workspace_id),
  CONSTRAINT fk_workflow_credentials_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflow_credentials_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Idempotency: lets a re-fired webhook reuse the original run instead of
-- processing the same payload twice.
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_runs'
    AND COLUMN_NAME = 'idempotency_key'
);

SET @stmt = IF(
  @col_exists = 0,
  'ALTER TABLE workflow_runs ADD COLUMN idempotency_key VARCHAR(190) NULL AFTER status, ADD UNIQUE KEY uq_workflow_runs_idempotency (workflow_id, idempotency_key)',
  'SELECT 1'
);

PREPARE add_idem FROM @stmt;
EXECUTE add_idem;
DEALLOCATE PREPARE add_idem;
