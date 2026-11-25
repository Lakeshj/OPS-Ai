-- Corrective repair: guarantee workflow_credentials.type includes 'apify' and 'perigon'
-- (and every existing credential type).
--
-- Context (M10.3.5): UI create of type=perigon can fail with
--   "Data truncated for column 'type' at row 1"
-- when schema_migrations lists 035 as applied but the live ENUM still lacks
-- 'perigon' (restore/history drift, or a different DB than the migrate runner).
-- The migrate runner records filenames only; this repair re-asserts ENUM contents.
--
-- Idempotent when values are already present. Additive only — does not drop,
-- rename, or reorder the semantic meaning of existing types (MySQL remaps by name).

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
    'facebook_page',
    'apify',
    'perigon'
  ) NOT NULL;
