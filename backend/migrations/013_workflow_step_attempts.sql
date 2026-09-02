-- Per-node retry / error-policy support: track how many times a step ran.
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS, so guard on information_schema.
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_run_steps'
    AND COLUMN_NAME = 'attempts'
);

SET @stmt = IF(
  @col_exists = 0,
  'ALTER TABLE workflow_run_steps ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER status',
  'SELECT 1'
);

PREPARE add_attempts FROM @stmt;
EXECUTE add_attempts;
DEALLOCATE PREPARE add_attempts;
