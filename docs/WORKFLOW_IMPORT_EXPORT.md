# Workflow import / export (OpsAi)

## Formats

| Format | Marker | Notes |
| --- | --- | --- |
| OpsAi native | `"format": "opsai-workflow"`, `formatVersion: 1` | Full semantic round-trip of definition |
| n8n export | n8n node `type` prefixes (`n8n-nodes-base.*`, `@n8n/...`) | Structural migration; often not runtime-ready |
| Unknown | — | Rejected safely |

**Structural import ≠ runtime compatibility** for n8n.

Some n8n workflows can be structurally imported even when they cannot run immediately in OpsAi (unsupported integrations, Code nodes, credentials, expressions, AI execution semantics).

## Native export

`GET /workflows/:id/export` returns a versioned package:

```json
{
  "format": "opsai-workflow",
  "formatVersion": 1,
  "workflow": { "name", "description", "definition": { "nodes", "edges", "settings" } }
}
```

Excluded: credential secrets/IDs (marked for reconnect), API keys, passwords, OAuth tokens, Wait resume tokens, webhook secrets, execution/run/job history, Copilot/Chat history, editor cache, ephemeral AI runtime.

## Native / unified import

1. `POST /workflows/import/preview` — detect format, preview, return `commitToken` bound to fingerprint + workspace + user  
2. `POST /workflows/import` — requires `commitToken` + **same source JSON**; server **recomputes** definition (client `previewDefinition` is ignored)

Always creates a **new inactive draft**. Never overwrites, auto-runs, or activates.

Legacy n8n-only endpoints remain: `/workflows/import/n8n/preview`, `/workflows/import/n8n`.

## UI

Workflow editor **More** menu:

- Import Workflow — file upload → format detection → compatibility report → Import as Draft  
- Export Workflow — download `.opsai.json`

## Security

- Auth required; workspace isolation on commit/export  
- Bounds: payload size, node/edge counts, string length, depth  
- Prototype-pollution keys stripped  
- No `eval` / `vm` during import  
- Preview→commit: HMAC token + fingerprint revalidation  

## Golden fixtures

- `backend/fixtures/n8n/seo-report-real-world.json` — real-world stress fixture  
- `backend/fixtures/n8n/simple-http-get.json` — Manual → HTTP GET  

Do **not** claim complete n8n runtime compatibility.
