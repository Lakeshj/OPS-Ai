-- Part 10C.1: historical run retention — soft-delete workflows; snapshot run names

-- Soft-delete marker. Hard DELETE FROM workflows is reserved for workspace teardown
-- (still CASCADE). User-facing remove() sets deleted_at instead of erasing the row.
ALTER TABLE workflows
  ADD COLUMN deleted_at TIMESTAMP NULL AFTER updated_at,
  ADD INDEX idx_workflows_deleted (deleted_at);

-- Immutable display name captured at run start (survives rename + soft-delete).
ALTER TABLE workflow_runs
  ADD COLUMN workflow_name_snapshot VARCHAR(255) NULL AFTER workflow_id;

-- Backfill names for existing runs from live workflows.
UPDATE workflow_runs r
INNER JOIN workflows w ON w.id = r.workflow_id
SET r.workflow_name_snapshot = w.name
WHERE r.workflow_name_snapshot IS NULL;
