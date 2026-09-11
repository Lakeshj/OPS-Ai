-- Part 14D.5.4 — Generic OAuth2 connections + safe connection config (allowed domains).
-- Secrets remain in encrypted secret_json. config_json holds non-secret connection metadata only.

ALTER TABLE workflow_credentials
  MODIFY COLUMN type ENUM(
    'bearer',
    'api_key_header',
    'basic',
    'query_param',
    'google_gsc',
    'google_ga4',
    'google_gmail',
    'google_sheets',
    'oauth2'
  ) NOT NULL;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflow_credentials'
    AND COLUMN_NAME = 'config_json'
);

SET @stmt = IF(
  @col_exists = 0,
  'ALTER TABLE workflow_credentials ADD COLUMN config_json TEXT NULL AFTER secret_json',
  'SELECT 1'
);

PREPARE add_cfg FROM @stmt;
EXECUTE add_cfg;
DEALLOCATE PREPARE add_cfg;
