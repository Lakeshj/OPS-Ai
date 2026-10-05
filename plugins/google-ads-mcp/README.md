# OpsAi Google Ads MCP (`google-ads-mcp`)

Read-only Google Ads tools for the dynamic MCP registry and the `googleAdsMcpTool` node.

## Owns

- Provider `google_ads`
- Tool definitions, schemas, and display names
- P0 execution: `list_accessible_customers`, `get_resource_metadata`, `search`
- GAQL SELECT checks, Ads error mapping, and `_meta` provenance

## Stays shared

OAuth, the `google_ads` credential, and `googleApiRequest` stay in backend services. The backend host injects them. This plugin does not open a second Google Ads client and does not call mutate endpoints.

```bash
cd plugins/google-ads-mcp && npm test
```
