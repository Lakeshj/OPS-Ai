-- Corrective: guarantee workflow_credentials.type includes google_ads and meta_ads.
-- 025/026 already add these values when applied. Live databases that skipped those
-- files (or were patched by hand) still need this idempotent ENUM assertion.
-- Value order matches the required final schema. MySQL remaps existing rows by name.

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
    'meta_ads'
  ) NOT NULL;
