-- Allow originals to be removed after successful Markdown conversion.
ALTER TABLE workspace_documents
  MODIFY storage_key VARCHAR(512) NULL;
