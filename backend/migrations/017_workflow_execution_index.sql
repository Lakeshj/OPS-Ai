-- Part 9A: execution occurrence index on workflow_run_steps
-- Allows multiple executions of the same node within one run (future Loop).
-- Retries still update the SAME row (same id + execution_index).
-- Historical rows backfill as execution_index = 0 via DEFAULT.

-- CURRENT: PK(id), INDEX(run_id); no UNIQUE(run_id, node_id)
-- NEW: execution_index INT NOT NULL DEFAULT 0; INDEX(run_id, node_id, execution_index)
-- BACKFILL: DEFAULT 0 on existing rows
-- ROLLBACK: DROP INDEX idx_workflow_run_steps_occurrence; ALTER DROP COLUMN execution_index

ALTER TABLE workflow_run_steps
  ADD COLUMN execution_index INT NOT NULL DEFAULT 0 AFTER node_id;

CREATE INDEX idx_workflow_run_steps_occurrence
  ON workflow_run_steps (run_id, node_id, execution_index);
