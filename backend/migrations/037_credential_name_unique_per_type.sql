-- M10.3.8: Scope credential display-name uniqueness to (workspace, type, name).
-- Names are UI labels only; runtime resolution uses credential IDs + type checks.
-- Same label may exist on Apify and Bearer (etc.) without conflict.
-- Same type + same name within a workspace remains unique (CI collation).

ALTER TABLE workflow_credentials
  DROP INDEX uq_workflow_credentials_name;

ALTER TABLE workflow_credentials
  ADD UNIQUE KEY uq_workflow_credentials_workspace_type_name (workspace_id, type, name);
