# Workflow Google nodes (OpsAi)

Native Google integrations for workflows. Tokens live only in encrypted `workflow_credentials.secret_json`. Nodes store a `credentialId` reference.

## Credential types and scopes

| Type | Product | Scopes |
| --- | --- | --- |
| `google_gsc` | Search Console | `webmasters.readonly` |
| `google_ga4` | Google Analytics (GA4) | `analytics.readonly` |
| `google_gmail` | Gmail | `gmail.modify`, `gmail.send`, `gmail.compose` |
| `google_sheets` | Google Sheets | `spreadsheets` |

Do not paste access/refresh tokens into Copilot or node parameters. Use **Connect Google** in the credential picker (OAuth authorization code, server callback, encrypted refresh).

Env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (default `http://localhost:5013/api/google-oauth/callback`). Google redirects the browser at Express directly — that URI must match Google Cloud Console exactly. OAuth `state` is HMAC-signed, expiring, user/workspace-bound, and **single-use** (nonce consumed on callback). The editor accepts OAuth `postMessage` only from the callback origin and the editor origin, only from the opened popup, and only a typed `{ type, ok, credentialId|error }` payload (no tokens).

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

Server-side refresh uses the stored refresh token. `invalid_grant` / 401 after refresh → `GOOGLE_UNAUTHORIZED` (reconnect). Wrong workspace → denied. Logs never include `Authorization` or tokens.

## Google Search Console (`googleSearchConsole`)

Search Analytics: **Get Queries** / **Get Pages**. Fields: credential, site URL, date range (today / yesterday / last 7 / 28 / 30 / custom), row limit.

Output items: `{ key, query|page, clicks, impressions, ctr, position }`.

## Google Analytics (`googleAnalytics`)

GA4 **Report → Get**. Credential, property ID (picker or numeric id), date range (includes last calendar week/month), metrics, dimensions, optional filters / order / limit.

Output: one WorkflowItem per report row with selected dimension/metric keys.

## Gmail (`gmail`)

Resources: Message, Draft, Label, Thread. Send supports text/HTML, CC/BCC/Reply-To, and attachments from `WorkflowItem.binary` (`binaryProperty`, default `data`). No filesystem paths.

Normalized send/get output: `{ id, threadId, labelIds }` plus safe headers when reading.

## Gmail Trigger (`gmailTrigger`)

**Polling** trigger (not push). Durable cursor in `workflow_trigger_cursors` (workflow + node). Inactive workflows do not poll. First poll seeds the cursor and does not replay the mailbox. Export does not include the cursor.

## Google Sheets (`googleSheets`)

Get spreadsheet, read/append/update rows, clear range, create spreadsheet, add sheet. Header row maps columns to named fields. Writes: `USER_ENTERED` or `RAW`.

## Security

Never put tokens in workflow JSON, run output, Copilot context, native export, or logs. Copilot may say “Google credential required” — never ask for client secrets or tokens.
