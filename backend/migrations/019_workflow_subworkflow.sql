-- Part 10A: sub-workflow parent/child run lineage + durable child-wait dependencies

ALTER TABLE workflow_runs
  ADD COLUMN parent_run_id CHAR(36) NULL AFTER workflow_id,
  ADD COLUMN parent_node_id VARCHAR(64) NULL AFTER parent_run_id,
  ADD COLUMN parent_execution_index INT NULL AFTER parent_node_id,
  ADD COLUMN root_run_id CHAR(36) NULL AFTER parent_execution_index,
  ADD COLUMN waiting_reason VARCHAR(32) NULL AFTER waiting_node_id;

ALTER TABLE workflow_runs
  ADD INDEX idx_workflow_runs_parent (parent_run_id),
  ADD INDEX idx_workflow_runs_root (root_run_id),
  ADD UNIQUE INDEX uq_workflow_runs_parent_invocation (
    parent_run_id,
    parent_node_id,
    parent_execution_index
  );

-- Parent→child wait is NOT a Wait-node row. Separate dependency table.
CREATE TABLE IF NOT EXISTS workflow_run_dependencies (
  id CHAR(36) PRIMARY KEY,
  parent_run_id CHAR(36) NOT NULL,
  child_run_id CHAR(36) NOT NULL,
  parent_node_id VARCHAR(64) NOT NULL,
  parent_execution_index INT NOT NULL DEFAULT 0,
  parent_step_id CHAR(36) NULL,
  status ENUM('waiting', 'completed', 'failed', 'cancelled')
    NOT NULL DEFAULT 'waiting',
  snapshot_json JSON NOT NULL,
  wake_token VARCHAR(128) NULL,
  woken_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workflow_run_dep_invocation (
    parent_run_id,
    parent_node_id,
    parent_execution_index
  ),
  UNIQUE KEY uq_workflow_run_dep_child (child_run_id),
  INDEX idx_workflow_run_dep_parent_status (parent_run_id, status),
  INDEX idx_workflow_run_dep_waiting (status, updated_at),
  CONSTRAINT fk_workflow_run_dep_parent
    FOREIGN KEY (parent_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflow_run_dep_child
    FOREIGN KEY (child_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);
