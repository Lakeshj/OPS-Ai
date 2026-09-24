# Workflow Google nodes (OpsAi)

Native Google integrations for workflows. Tokens live only in encrypted `workflow_credentials.secret_json`. Nodes store a `credentialId` reference.

## Native authentication policy (per provider)

**Do not** decide connection UX from generic `isGoogle` / `oauthManaged` alone. Use the canonical policy in:

- `frontend/src/modules/workflows/googleNativeAuthPolicy.ts`
- `backend/config/googleNativeAuthPolicy.js`

| Product | Policy | Author UX |
| --- | --- | --- |
| Gmail (`google_gmail`) | `PLATFORM_MANAGED_ONLY` | Connect → Google sign-in popup directly (no Client ID/Secret). Permissions are granted on Google’s consent screen. |
| Search Console (`google_gsc`) | `HYBRID_CUSTOM_PRIMARY` | Connect → custom OAuth app (Client ID/Secret). Setup credential selectable when platform OAuth exists. |
| Analytics (`google_ga4`) | `HYBRID_CUSTOM_PRIMARY` | Same hybrid CUSTOM_APP-primary flow |
| Sheets (`google_sheets`) | `HYBRID_CUSTOM_PRIMARY` | Same hybrid CUSTOM_APP-primary flow |

`platformManagedAvailable` / `GOOGLE_OAUTH_*` are required for Gmail. GSC / GA4 / Sheets `CUSTOM_APP` connections ignore platform client env.

Credentials are **workspace-scoped**: every Gmail node picks a `credentialId`. Multiple nodes/workflows can reuse one account, or each node can use a different connected account via Connect another account.

### Provider change discipline

Any future authentication UX change for one Google provider **MUST** run the Google provider policy regression matrix (`GOOGLEPOLICY-*`) before commit — at minimum Gmail, GSC, GA4, and Sheets — to prevent “fix Gmail → break GSC” regressions.

## Credential types and scopes

| Type | Product | Scopes |
| --- | --- | --- |
| `google_gsc` | Search Console | `webmasters.readonly` |
| `google_ga4` | Google Analytics (GA4) | `analytics.readonly` |
| `google_gmail` | Gmail | `gmail.modify`, `gmail.send`, `gmail.compose` (requested at Google consent; no in-node permission toggles) |
| `google_sheets` | Google Sheets | `spreadsheets` |

## Predefined Google OAuth

### GSC / GA4 / Sheets (HYBRID_CUSTOM_PRIMARY)

Normal author flow is **frontend-configured** (`CUSTOM_APP`):

1. Connect Google Analytics / GSC / Sheets
2. Credential modal: OAuth Redirect URL (read-only + copy), Client ID, Client Secret, allowed domains, optional custom scopes
3. Save → Connect → Google account chooser (`prompt=select_account consent`) → callback
4. Encrypted credential becomes selectable; node picks resources (property/site/sheet)

When platform OAuth is configured, Setup credential may also offer Managed OAuth2 as an optional path. When it is not configured, Setup stays locked to custom Google OAuth app (no dead-end Managed option).

### Gmail (PLATFORM_MANAGED_ONLY)

1. Connect / Change Gmail account opens Google sign-in directly (OpsAi Cloud OAuth app)
2. Google account chooser → Google consent screen (permissions are chosen / shown by Google, not OpsAi)
3. OpsAi probes Gmail API; connect fails clearly if Gmail API is disabled, the OAuth app is unverified/testing without this user, or scopes were denied
4. No Custom OAuth2 Client ID/Secret UI on Gmail or Gmail Trigger (unlike GSC / GA4 / Sheets)

If Google shows `Error 403: access_denied` / “has not completed the Google verification process”, add the Google account as a **test user** on the OpsAi Cloud project, or complete Google verification for the platform OAuth app.

Google authorization/token endpoints are owned by the provider registry — authors do **not** enter them for predefined Google types.

**OAuth app modes (explicit):**

| Mode | Client ID / Secret source |
| --- | --- |
| `CUSTOM_APP` | Per-credential (encrypted secret + safe config). Primary for GSC/GA4/Sheets. |
| `PLATFORM_MANAGED` | Server `GOOGLE_OAUTH_CLIENT_*`. Default recommended path for native Gmail. |

Redirect URI (register in the author’s Google Cloud OAuth client for CUSTOM_APP):

- **Production:** `https://opsai.socialchamps.com/api/google-oauth/callback`
- **Local:** `http://localhost:5013/api/google-oauth/callback`

Set `GOOGLE_OAUTH_REDIRECT_URI` on the backend, or leave it unset and set `CORS_ORIGIN=https://opsai.socialchamps.com` so production builds the live callback automatically. The credential modal shows the server redirect URL (read-only + copy).

OAuth `state` is HMAC-signed, expiring, user/workspace/credential-bound, and **single-use**. Refresh uses the **same** OAuth app mode that created the credential.

Do not paste access/refresh tokens into Copilot or node parameters. Copilot must never invent Client ID/Secret.

## Credential vs resource (14D.5.1)

**Credential** = which Google account is authorized (encrypted `workflow_credentials`).  
**Resource** = which site / GA4 property / spreadsheet / sheet / Gmail label / model **this node** uses.

One Google credential can be reused across many nodes and many resources. Resource identifiers are stored on node parameters only — never in `secret_json`.

Locator modes (OpsAi UI, not n8n tabs): **From account** (search + refresh), **Manual**, **Expression** (`{{input.siteUrl}}`, `{{input.ga4PropertyId}}`, …).

### Google Search Console

Site / property: From account (Search Console `sites.list`), manual (`https://www.example.com/` or `sc-domain:example.com`), or expression. Persist the exact API property string.

### Google Analytics

Property: From account (`accountSummaries`), numeric property ID, or `{{input.ga4PropertyId}}`. Optional `propertyDisplayName` is a cached label only.

### Google Sheets

`SHEETS_BROWSE_REQUIRES_DRIVE_SCOPE = yes`. V1 does **not** add Drive scope. Spreadsheet is ID/URL or expression. Tabs can be listed for a known spreadsheet ID with the existing `spreadsheets` scope.

### Gmail

Resource + operation control visible fields. Label operations use a credential-dependent label picker (multi-select). Gmail Trigger filters stay on the node; the poll cursor stays in `workflow_trigger_cursors`.

### AI Generate

Model: suggested list for the selected provider, manual ID, or `{{input.model}}`. Still a main-flow node (not Agent / Chat Model).

## Token refresh / revocation

Server-side refresh uses the stored refresh token with the credential’s OAuth app. `invalid_grant` / 401 after refresh → `GOOGLE_UNAUTHORIZED` (reconnect). Wrong workspace → denied. Logs never include `Authorization` or tokens.

## Google Search Console (`googleSearchConsole`)

Search Analytics: **Get Queries** / **Get Pages**. Fields: credential, site URL, date range (today / yesterday / last 7 / 28 / 30 / custom), row limit.

Output items: `{ query|page, clicks, impressions, ctr, position }` (table headers: Top Queries or Top Pages by operation, then clicks, impressions, CTR, Position).

## Google Analytics (`googleAnalytics`)

GA4 **Report**. Credential, property ID (picker / manual / expression), date range (includes last calendar week/month), multi-select metrics and dimensions, optional structured filters / order / limit.

Curated metrics include traffic (sessions, users, views), engagement (rate, duration, bounceRate), events, key events/conversions, and ecommerce revenue fields. Curated dimensions include date, geo, device, acquisition, page/landing, and `eventName`.

Filters: one optional dimension filter + one optional metric filter (`field` / `operator` / `value` / optional `valueTo`). Order by is limited to selected metrics/dimensions.

Output: one WorkflowItem per report row with selected dimension/metric keys (metrics coerced to numbers). Limit / Return all currently cap at **10,000 rows** in a single request (no pageToken pagination yet).

## Gmail (`gmail`)

Resources: Message, Draft, Label, Thread. Send supports text/HTML, CC/BCC/Reply-To, and attachments from `WorkflowItem.binary` (`binaryProperty`, default `data`). No filesystem paths.

Normalized send/get output: `{ id, threadId, labelIds }` plus safe headers when reading.

## Gmail Trigger (`gmailTrigger`)

**Polling** trigger (not push). Durable cursor in `workflow_trigger_cursors` (workflow + node). Inactive workflows do not poll. First poll seeds the cursor and does not replay the mailbox. Export does not include the cursor.

## Google Sheets (`googleSheets`)

Get spreadsheet, read/append/update rows, clear range, create spreadsheet, add sheet. Header row maps columns to named fields. Writes: `USER_ENTERED` or `RAW`.

## Security

Never put tokens or Client Secret in workflow JSON, run output, Copilot context, native export, or logs. Editor views return `hasClientSecret` flags only — never plaintext secrets.
