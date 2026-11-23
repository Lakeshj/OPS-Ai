-- M8.15.1 — AI Agent / workflow model-usage attribution on ai_usage_events.
-- Chat/bot rows keep assistant_id + thread_id; agent rows use source + workflow fields.

ALTER TABLE ai_usage_events
  ADD COLUMN source VARCHAR(32) NULL AFTER assistant_id,
  ADD COLUMN provider VARCHAR(32) NULL AFTER model,
  ADD COLUMN workflow_run_id CHAR(36) NULL AFTER source,
  ADD COLUMN workflow_node_id VARCHAR(64) NULL AFTER workflow_run_id,
  ADD COLUMN workflow_node_name VARCHAR(191) NULL AFTER workflow_node_id,
  ADD COLUMN generation_index INT UNSIGNED NULL AFTER workflow_node_name;

CREATE INDEX idx_ai_usage_source_time ON ai_usage_events (source, created_at);
CREATE INDEX idx_ai_usage_workflow_run ON ai_usage_events (workflow_run_id, created_at);
