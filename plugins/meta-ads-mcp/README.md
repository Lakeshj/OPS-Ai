# OpsAi Meta Ads MCP (`meta-ads-mcp`)

Read-only Meta Ads tools for the dynamic MCP registry and the `metaAdsMcpTool` node.

## Owns

- Provider `meta_ads`
- Tool definitions, schemas, and display names
- Common entity reads: `account_summary`, `campaigns`, `ad_sets`, `ads`, `creatives`
- Performance Insights: `account_performance`, `campaign_performance`, `ad_set_performance`, `ad_performance`
- Controlled breakdowns: `demographic_performance`, `geographic_performance`, `device_performance`, `placement_performance`
- Internal: `list_accessible_ad_accounts` (hidden from the normal tool dropdown)

## Stays shared

OAuth, the `meta_ads` credential, Graph HTTP, API version, and `appsecret_proof` stay in backend services. The backend host injects them. This plugin does not open a second Graph client and does not call write endpoints.

Account context comes from a native `metaAds` node. The MCP node does not store `credentialId` or `adAccountId`.

Common tools are entity/configuration reads. Performance tools reuse the shared Insights catalog and Graph client. The native `metaAds` node keeps its own four reports.

```bash
cd plugins/meta-ads-mcp && npm test
```
