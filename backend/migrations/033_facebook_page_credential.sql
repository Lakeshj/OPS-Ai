-- Facebook Page Native credential type (organic Pages).
-- Additive ENUM only — do not reorder or remove existing values.
-- Separate from instagram and meta_ads.

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
    'instagram',
    'facebook_page'
  ) NOT NULL;
