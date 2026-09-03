-- Part 8B: manual + external Wait resume (nullable resume_at, modes, token hash)

ALTER TABLE workflow_waits
  MODIFY COLUMN resume_at TIMESTAMP NULL;

ALTER TABLE workflow_waits
  ADD COLUMN resume_mode ENUM('time', 'manual', 'external')
    NOT NULL DEFAULT 'time' AFTER status,
  ADD COLUMN resume_token_hash CHAR(64) NULL AFTER resume_mode,
  ADD COLUMN resume_token_ciphertext TEXT NULL AFTER resume_token_hash,
  ADD COLUMN resume_mechanism ENUM('time', 'manual', 'external') NULL AFTER resumed_at,
  ADD COLUMN resumed_by VARCHAR(64) NULL AFTER resume_mechanism,
  ADD COLUMN signalled_at TIMESTAMP NULL AFTER resumed_by;

CREATE UNIQUE INDEX uq_workflow_waits_token_hash
  ON workflow_waits (resume_token_hash);
