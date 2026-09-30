-- Google Ads V1 credential type. Tokens and the developer token stay in encrypted secret_json.

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
    'google_ads',
    'oauth2'
  ) NOT NULL;
