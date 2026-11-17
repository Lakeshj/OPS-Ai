# Instagram platform setup — one time

OpsAi uses **one** platform Meta Developer App with **Instagram API setup with Unified Login**. Internal team members connect **many** client Instagram professional accounts via OAuth. Clients never configure integrations.

## INSTAGRAM PLATFORM SETUP — ONE TIME

1. In Meta Developer App → Use cases → Manage messaging & content on Instagram → **API setup with Unified login**, create a Facebook Login for Business configuration.
2. Token type: **System-user access token (SUAT)**.
3. Assets: Instagram accounts (as required by your product).
4. Permissions for OpsAi V1 only:
   - `instagram_basic`
   - `instagram_content_publish`
   - `instagram_manage_comments`
   - `instagram_manage_insights`
5. Do **not** enable for V1: `instagram_manage_messages`, Human Agent, `instagram_manage_events`, `ads_management`.
6. Set server environment:
   - `INSTAGRAM_APP_ID`
   - `INSTAGRAM_APP_SECRET`
   - `INSTAGRAM_OAUTH_REDIRECT_URI` (exact HTTPS callback registered in Meta)
   - `INSTAGRAM_LOGIN_CONFIG_ID` (configuration ID from Unified Login)
7. Typical redirect: `https://opsai.socialchamps.com/api/instagram-oauth/callback`
8. Restart the backend.
9. Confirm preflight: `instagramIntegrationConfigured = true`, `unifiedLoginConfigured = true`, `missingConfigKeys = []`.
10. In OpsAi: Instagram node → **Connect Instagram** (or **Connect other account** for an additional client).
11. OpsAi discovers `@username` / account id automatically and stores an encrypted workspace credential (`tokenKind = unified_system_user`).

### Fallback (same Meta app)

If Instagram-specific App ID/Secret are unset, the server may fall back to:

- `META_APP_ID`
- `META_APP_SECRET`

`INSTAGRAM_LOGIN_CONFIG_ID` and `INSTAGRAM_OAUTH_REDIRECT_URI` remain Instagram-specific.

Prefer explicit `INSTAGRAM_APP_*` when possible.

## Model

```
ONE platform app + Unified Login configuration
  → MANY client Instagram OAuth credentials
```

Each credential is independently:

- workspace-scoped
- encrypted SUAT
- own `instagramUserId`, username, permissions, expiry / reconnect

## Not required

- Meta Ads node
- `meta_ads` credential
- Ads Account ID
- `ads_read`
- Manual App ID / App Secret / User ID / access token entry in the workflow UI
- Staff copying dashboard-generated tokens into OpsAi for normal connect

## Credential types stay separate

Even if one Meta Developer App is reused:

- `instagram` ≠ `facebook_page` ≠ `meta_ads`
