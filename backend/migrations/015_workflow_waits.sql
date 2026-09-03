-- Part 8A: durable time-based Wait — definition snapshot + waiting status + waits table

ALTER TABLE workflow_runs
  MODIFY COLUMN status ENUM(
    'queued',
    'running',
    'waiting',
    'succeeded',
    'failed',
    'cancelled'
  ) NOT NULL DEFAULT 'queued';

ALTER TABLE workflow_runs
  ADD COLUMN definition_snapshot_json JSON NULL AFTER input_json,
  ADD COLUMN waiting_node_id VARCHAR(64) NULL AFTER status,
  ADD COLUMN resume_at TIMESTAMP NULL AFTER waiting_node_id;

ALTER TABLE workflow_run_steps
  MODIFY COLUMN status ENUM(
    'pending',
    'running',
    'waiting',
    'succeeded',
    'failed',
    'skipped'
  ) NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS workflow_waits (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  workflow_id CHAR(36) NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  step_id CHAR(36) NULL,
  status ENUM('waiting', 'claimed', 'resumed', 'cancelled', 'failed')
    NOT NULL DEFAULT 'waiting',
  resume_at TIMESTAMP NOT NULL,
  snapshot_json JSON NOT NULL,
  claim_token VARCHAR(128) NULL,
  claimed_at TIMESTAMP NULL,
  resumed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflow_waits_due (status, resume_at),
  INDEX idx_workflow_waits_run (run_id),
  INDEX idx_workflow_waits_workflow (workflow_id),
  CONSTRAINT fk_workflow_waits_run
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflow_waits_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
