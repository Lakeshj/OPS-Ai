-- Part 9A.1: freeze durable occurrence identity
-- UNIQUE(run_id, node_id, execution_index)
--
-- CURRENT (017): non-unique INDEX idx_workflow_run_steps_occurrence
-- NEW: UNIQUE KEY uq_workflow_run_steps_occurrence
--
-- Legacy / conflict handling:
-- If any (run_id, node_id, execution_index) group has duplicates,
-- renumber ALL rows for that (run_id, node_id) by created_at, id (0-based).
-- Does not delete rows.
--
-- ROLLBACK:
--   ALTER TABLE workflow_run_steps DROP INDEX uq_workflow_run_steps_occurrence;
--   CREATE INDEX idx_workflow_run_steps_occurrence
--     ON workflow_run_steps (run_id, node_id, execution_index);

-- 1) Deterministic reindex only for (run_id, node_id) groups that conflict
UPDATE workflow_run_steps s
INNER JOIN (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY run_id, node_id
      ORDER BY created_at ASC, id ASC
    ) - 1 AS new_idx
  FROM workflow_run_steps
  WHERE (run_id, node_id) IN (
    SELECT run_id, node_id
    FROM (
      SELECT run_id, node_id, execution_index
      FROM workflow_run_steps
      GROUP BY run_id, node_id, execution_index
      HAVING COUNT(*) > 1
    ) dup
  )
) ranked ON ranked.id = s.id
SET s.execution_index = ranked.new_idx;

-- 2) Replace non-unique index with UNIQUE occurrence constraint
DROP INDEX idx_workflow_run_steps_occurrence ON workflow_run_steps;

CREATE UNIQUE INDEX uq_workflow_run_steps_occurrence
  ON workflow_run_steps (run_id, node_id, execution_index);
