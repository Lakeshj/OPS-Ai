-- Corrective repair: guarantee workflow_credentials.type includes 'instagram'.
--
-- Root cause (live): schema_migrations listed 028/030 as applied while the live
-- ENUM still ended at 'meta_ads'. The migrate runner records filenames only and
-- does not re-validate ENUM contents, so a restore/history drift can leave
-- Instagram blocked until a new sequential MODIFY runs.
--
-- Idempotent: safe when 'instagram' is already present. Does not drop or
-- reorder semantic meaning of existing credential types (MySQL remaps by name).

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
    'oauth2',
    'google_ads',
    'meta_ads',
    'instagram'
  ) NOT NULL;
