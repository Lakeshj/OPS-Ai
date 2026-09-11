# Workflow HTTP connections (OpsAi)

Part **14D.5.4** adds HTTP Request authentication modes and a connection registry.

## Authentication modes (HTTP Request only)

| Mode | Meaning |
| --- | --- |
| None | No connection; no auth injected |
| Predefined Connection Type | Registry-driven provider connection (e.g. Google GSC/GA4/Gmail/Sheets) |
| Generic Authentication | Basic / Bearer / Header / Query / OAuth2 |

Native Google nodes use a **predefined Google credential modal** (`CUSTOM_APP`: author supplies Client ID/Secret; OpsAi owns Google endpoints). They do **not** show the HTTP Authentication selector or the **generic** OAuth2 editor (Auth URL / Token URL).

Predefined HTTP Google connection types reuse the **same** Google credential store and modal. Only **HTTP → Generic Authentication → OAuth2** opens the advanced generic OAuth2 modal.

## Connection registry

Canonical entries live in `backend/services/connectionRegistry.service.js`:

- `id`, `displayName`, `category`, `authScheme`, `status` (`SUPPORTED` | `COMING_SOON`)
- `allowedDomains`, `requestApplication`, OAuth metadata, test hints

UI and runtime look up the registry — no per-provider switch trees in the editor.

`COMING_SOON` entries are searchable but cannot create or execute connections.

## Generic OAuth2

- Redirect URL (read-only): `OAUTH2_REDIRECT_URI` or default `http://localhost:5013/api/oauth2/callback`
- Secrets (`clientSecret`, tokens) encrypted in `workflow_credentials.secret_json`
- Non-secret config in `config_json` (URLs, client id, allowed domains, flags)
- Signed state + nonce + expiry (same principles as Google OAuth; separate flow id)
- **No Fixed/Expression on secrets** — client secret and tokens never become workflow expressions

## Allowed domains

Before injecting auth, destination host must match the connection allowlist.
Cross-origin redirects strip sensitive headers; hosts outside the allowlist reject the redirect.

## Expression / Fixed policy

| Field | Expression? |
| --- | --- |
| HTTP URL / body / query values | Yes (existing) |
| Client Secret / access / refresh tokens | **No** |
| OAuth2 Client ID / Auth/Token URLs / domains | Fixed only in V1 (stored on connection, not node) |

## Sharing (V1)

Connections are workspace-scoped. Granular owner-only RBAC is **not** implemented; the Sharing tab states this honestly.

## Future / community extension boundary

Do **not** install community credential packs in this phase.

New first-party (or later custom) definitions should:

1. Add a registry entry (or a future DB/catalog loader with the same shape)
2. Optionally extend `workflow_credentials.type` ENUM via migration
3. Teach `applyCredential` how to inject auth
4. Keep secrets in `secretBox` — never on node JSON

Node UI stays registry-driven so hundreds of definitions do not require new React branches.
