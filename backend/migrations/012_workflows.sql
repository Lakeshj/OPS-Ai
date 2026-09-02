-- Stage 2: Workflow builder definitions + run queue

CREATE TABLE IF NOT EXISTS workflows (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  definition_json JSON NOT NULL,
  status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflows_workspace (workspace_id),
  INDEX idx_workflows_created_by (created_by),
  CONSTRAINT fk_workflows_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflows_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id CHAR(36) PRIMARY KEY,
  workflow_id CHAR(36) NOT NULL,
  status ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  input_json JSON NULL,
  output_json JSON NULL,
  error TEXT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow_runs_workflow (workflow_id),
  INDEX idx_workflow_runs_status (status),
  CONSTRAINT fk_workflow_runs_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflow_runs_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_run_steps (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  node_type VARCHAR(64) NOT NULL,
  status ENUM('pending', 'running', 'succeeded', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  input_json JSON NULL,
  output_json JSON NULL,
  error TEXT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow_run_steps_run (run_id),
  CONSTRAINT fk_workflow_run_steps_run
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_jobs (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  status ENUM('queued', 'locked', 'done', 'failed') NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMP NULL,
  locked_by VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workflow_jobs_run (run_id),
  INDEX idx_workflow_jobs_claim (status, available_at),
  CONSTRAINT fk_workflow_jobs_run
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);
