-- Part 11A: durable Error Workflow / failure routing foundation

-- Live workflow may reference one Error Workflow (same workspace; soft-delete safe).
ALTER TABLE workflows
  ADD COLUMN error_workflow_id CHAR(36) NULL AFTER status,
  ADD INDEX idx_workflows_error_workflow (error_workflow_id);

-- Soft-deleted targets remain as rows; hard delete (workspace teardown) nulls the pointer.
ALTER TABLE workflows
  ADD CONSTRAINT fk_workflows_error_workflow
    FOREIGN KEY (error_workflow_id) REFERENCES workflows(id)
    ON DELETE SET NULL;

-- Frozen routing target at source run start + error-handling lineage suppression.
ALTER TABLE workflow_runs
  ADD COLUMN error_workflow_id_snapshot CHAR(36) NULL AFTER workflow_name_snapshot,
  ADD COLUMN suppress_error_routing TINYINT(1) NOT NULL DEFAULT 0
    AFTER error_workflow_id_snapshot,
  ADD INDEX idx_workflow_runs_suppress_error (suppress_error_routing),
  ADD INDEX idx_workflow_runs_failed_routing (status, error_workflow_id_snapshot, finished_at);

-- Durable one-dispatch-per-failed-run intent (not waits / not run_dependencies).
CREATE TABLE IF NOT EXISTS workflow_error_dispatches (
  id CHAR(36) PRIMARY KEY,
  source_run_id CHAR(36) NOT NULL,
  error_workflow_id CHAR(36) NULL,
  error_run_id CHAR(36) NULL,
  status ENUM(
    'pending',
    'claimed',
    'dispatched',
    'unavailable',
    'failed'
  ) NOT NULL DEFAULT 'pending',
  outcome_code VARCHAR(64) NULL,
  event_json JSON NOT NULL,
  claim_token VARCHAR(128) NULL,
  claimed_at TIMESTAMP NULL,
  claimed_by VARCHAR(128) NULL,
  dispatched_at TIMESTAMP NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_error_dispatch_source_run (source_run_id),
  INDEX idx_error_dispatch_claim (status, claimed_at, created_at),
  INDEX idx_error_dispatch_error_run (error_run_id),
  CONSTRAINT fk_error_dispatch_source_run
    FOREIGN KEY (source_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_error_dispatch_error_run
    FOREIGN KEY (error_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
