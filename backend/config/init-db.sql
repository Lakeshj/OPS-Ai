
CREATE DATABASE IF NOT EXISTS opsai;
USE opsai;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255),
  role ENUM('Admin', 'Project Manager', 'Employee') NOT NULL,
  is_developer TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Workspace users junction table
CREATE TABLE IF NOT EXISTS workspace_users (
  workspace_id VARCHAR(36),
  user_id VARCHAR(36),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Folders table
CREATE TABLE IF NOT EXISTS folders (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Chat threads table
CREATE TABLE IF NOT EXISTS chat_threads (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  folder_id VARCHAR(36),
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(36) PRIMARY KEY,
  thread_id VARCHAR(36) NOT NULL,
  content TEXT NOT NULL,
  is_user_message BOOLEAN NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

-- Keyword assistants table
CREATE TABLE IF NOT EXISTS keyword_assistants (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  task_type VARCHAR(255) NOT NULL,
  capability_type VARCHAR(50) NOT NULL DEFAULT 'chat',
  provider VARCHAR(50) NOT NULL DEFAULT 'openai',
  model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_template TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT IGNORE INTO users (id, name, email, role) VALUES
('1', 'John Doe', 'john@example.com', 'Admin'),
('2', 'Jane Smith', 'jane@example.com', 'Project Manager');

INSERT IGNORE INTO workspaces (id, name, description, created_by) VALUES
('workspace-1', 'Project Alpha', 'First project workspace', '1');

INSERT IGNORE INTO workspace_users (workspace_id, user_id) VALUES
('workspace-1', '1'),
('workspace-1', '2');

INSERT IGNORE INTO folders (id, name, workspace_id, created_by) VALUES
('folder-1', 'Design', 'workspace-1', '1');

INSERT IGNORE INTO chat_threads (id, name, workspace_id, folder_id, created_by) VALUES
('thread-1', 'General Discussion', 'workspace-1', 'folder-1', '1');

INSERT IGNORE INTO chat_messages (id, thread_id, content, is_user_message) VALUES
('message-1', 'thread-1', 'Hello everyone!', true);

INSERT IGNORE INTO keyword_assistants (id, name, task_type, capability_type, provider, model, prompt_template, description) VALUES
('assistant-1', 'SEO Writer', 'Content Creation', 'chat', 'openai', 'gpt-4o-mini', 'Create SEO-optimized content about {topic} for {audience}', 'Helps create SEO-friendly content');
