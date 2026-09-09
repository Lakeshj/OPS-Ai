-- Part 14D.5 — Google OAuth credential types + durable trigger poll cursors.
-- Tokens remain in encrypted secret_json (never in workflow JSON).

ALTER TABLE workflow_credentials
  MODIFY COLUMN type ENUM(
    'bearer',
    'api_key_header',
    'basic',
    'query_param',
    'google_gsc',
    'google_ga4',
    'google_gmail',
    'google_sheets'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS workflow_trigger_cursors (
  workflow_id CHAR(36) NOT NULL,
  node_id VARCHAR(128) NOT NULL,
  cursor_json TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_id, node_id),
  CONSTRAINT fk_trigger_cursors_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
