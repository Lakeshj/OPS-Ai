-- Part 14D.5.4B — Frontend-configured predefined Google OAuth (CUSTOM_APP).
-- No DDL: workflow_credentials.config_json + secret_json already store safe
-- OAuth app metadata and encrypted Client Secret / tokens.
--
-- Contract (config_json, non-secret):
--   oauthAppMode: 'CUSTOM_APP' | 'PLATFORM_MANAGED'
--   clientId (CUSTOM_APP)
--   allowedDomains[], customScopes (optional override string)
--   connected, accountEmail (safe identity when available)
--
-- Contract (secret_json, encrypted):
--   clientSecret (CUSTOM_APP)
--   accessToken, refreshToken, expiryMs, scopes, tokenType, revoked
--
-- PLATFORM_MANAGED remains an optional legacy/fallback path using server
-- GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET when present.

SELECT 1;
