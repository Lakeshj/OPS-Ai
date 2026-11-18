-- Corrective: guarantee workflow_credentials.type includes instagram.
-- 028 already adds this value when applied. Live databases that recorded 028
-- without a successful ENUM change (or drifted afterward) still need this
-- idempotent assertion. Value order matches the required final schema.
-- MySQL remaps existing rows by name — safe for Google / Meta Ads / other types.

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
