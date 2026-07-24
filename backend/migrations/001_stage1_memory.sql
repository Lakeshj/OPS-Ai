CREATE TABLE IF NOT EXISTS workspace_static_memory (
  workspace_id VARCHAR(36) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  core_markdown LONGTEXT NOT NULL,
  content_hash CHAR(64) NULL,
  updated_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id),
  CONSTRAINT fk_static_memory_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_static_memory_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workspace_documents (
  id VARCHAR(36) NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  uploaded_by VARCHAR(36) NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  markdown_storage_key VARCHAR(512) NULL,
  mime_type VARCHAR(150) NOT NULL,
  file_extension VARCHAR(20) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  status ENUM(
    'uploaded',
    'converting',
    'ready',
    'failed'
  ) NOT NULL DEFAULT 'uploaded',
  error_message VARCHAR(1000) NULL,
  token_count INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workspace_document_hash (workspace_id, sha256),
  KEY idx_workspace_documents_status (workspace_id, status),
  CONSTRAINT fk_workspace_documents_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_documents_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS document_chunks (
  id VARCHAR(36) NOT NULL,
  document_id VARCHAR(36) NOT NULL,
  chunk_index INT UNSIGNED NOT NULL,
  heading VARCHAR(500) NULL,
  content LONGTEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  token_count INT UNSIGNED NOT NULL DEFAULT 0,
  embedding JSON NULL,
  embedding_model VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_document_chunk_index (document_id, chunk_index),
  KEY idx_document_chunks_hash (document_id, content_hash),
  CONSTRAINT fk_document_chunks_document
    FOREIGN KEY (document_id) REFERENCES workspace_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chat_session_memory (
  thread_id VARCHAR(36) NOT NULL,
  summary LONGTEXT NOT NULL,
  key_decisions JSON NULL,
  active_tasks JSON NULL,
  working_context LONGTEXT NULL,
  last_assistant_id VARCHAR(36) NULL,
  summarized_through_message_id VARCHAR(36) NULL,
  summary_token_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (thread_id),
  KEY idx_session_memory_assistant (last_assistant_id),
  CONSTRAINT fk_session_memory_thread
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_memory_assistant
    FOREIGN KEY (last_assistant_id) REFERENCES keyword_assistants(id) ON DELETE SET NULL,
  CONSTRAINT fk_session_memory_message
    FOREIGN KEY (summarized_through_message_id)
      REFERENCES chat_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id VARCHAR(36) NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  thread_id VARCHAR(36) NULL,
  user_id VARCHAR(36) NULL,
  assistant_id VARCHAR(36) NULL,
  model VARCHAR(100) NOT NULL,
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cached_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cache_write_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  total_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  latency_ms INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_usage_workspace_time (workspace_id, created_at),
  KEY idx_ai_usage_thread_time (thread_id, created_at),
  CONSTRAINT fk_ai_usage_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_usage_thread
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_usage_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_usage_assistant
    FOREIGN KEY (assistant_id) REFERENCES keyword_assistants(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
