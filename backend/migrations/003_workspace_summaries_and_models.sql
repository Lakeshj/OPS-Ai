ALTER TABLE workspace_documents
  ADD COLUMN included_in_summary BOOLEAN NOT NULL DEFAULT TRUE AFTER status;

ALTER TABLE keyword_assistants
  ADD COLUMN capability_type VARCHAR(50) NOT NULL DEFAULT 'chat' AFTER task_type,
  ADD COLUMN model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini' AFTER capability_type;

CREATE TABLE IF NOT EXISTS admin_ai_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  summary_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  evaluation_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  evaluation_prompt LONGTEXT NOT NULL,
  updated_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_single_admin_ai_settings CHECK (id = 1),
  CONSTRAINT fk_admin_ai_settings_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO admin_ai_settings (
  id,
  summary_model,
  evaluation_model,
  evaluation_prompt
) VALUES (
  1,
  'gpt-4o-mini',
  'gpt-4o-mini',
  'Evaluate the workspace summary from 0 to 100. Assess objectives, target persona, completeness, factual clarity, tone, constraints, responsibilities, deliverables, and actionable context. Return strict JSON with: score (number), feedback (string), strengths (array of strings), gaps (array of strings), and recommendations (array of strings).'
);

CREATE TABLE IF NOT EXISTS workspace_summaries (
  workspace_id VARCHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  content LONGTEXT NOT NULL,
  source ENUM('auto', 'manual', 'restored') NOT NULL DEFAULT 'auto',
  document_snapshot JSON NOT NULL,
  evaluation_score DECIMAL(5,2) NULL,
  evaluation_feedback LONGTEXT NULL,
  evaluation_details JSON NULL,
  summary_model VARCHAR(100) NULL,
  evaluation_model VARCHAR(100) NULL,
  updated_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id),
  CONSTRAINT fk_workspace_summaries_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_summaries_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workspace_summary_versions (
  id VARCHAR(36) NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL,
  content LONGTEXT NOT NULL,
  source ENUM('auto', 'manual', 'restored') NOT NULL,
  document_snapshot JSON NOT NULL,
  evaluation_score DECIMAL(5,2) NULL,
  evaluation_feedback LONGTEXT NULL,
  evaluation_details JSON NULL,
  summary_model VARCHAR(100) NULL,
  evaluation_model VARCHAR(100) NULL,
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workspace_summary_version (workspace_id, version),
  KEY idx_workspace_summary_versions_time (workspace_id, created_at),
  CONSTRAINT fk_workspace_summary_versions_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_summary_versions_user
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO workspace_summaries (
  workspace_id,
  version,
  content,
  source,
  document_snapshot,
  updated_by
)
SELECT
  sm.workspace_id,
  1,
  sm.core_markdown,
  'auto',
  COALESCE(
    (
      SELECT JSON_ARRAYAGG(d.id)
      FROM workspace_documents d
      WHERE d.workspace_id = sm.workspace_id
        AND d.status = 'ready'
        AND d.included_in_summary = TRUE
    ),
    JSON_ARRAY()
  ),
  sm.updated_by
FROM workspace_static_memory sm;
