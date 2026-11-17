-- Instagram M5: publish idempotency keys (workspace + workflow + node + publishKey).
CREATE TABLE IF NOT EXISTS workflow_instagram_publish_keys (
  id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  workflow_id CHAR(36) NOT NULL,
  node_id VARCHAR(120) NOT NULL,
  run_id CHAR(36) NULL,
  publish_key VARCHAR(190) NOT NULL,
  credential_id CHAR(36) NOT NULL,
  operation VARCHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL,
  container_id VARCHAR(64) NULL,
  media_id VARCHAR(64) NULL,
  child_container_ids_json TEXT NULL,
  result_json TEXT NULL,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ig_publish_key (workspace_id, workflow_id, node_id, publish_key),
  INDEX idx_ig_publish_cred (credential_id),
  INDEX idx_ig_publish_status (status),
  CONSTRAINT fk_ig_publish_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON DELETE CASCADE
);
