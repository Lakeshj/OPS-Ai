# OpsAi GA4 MCP Tools (`ga4-mcp`)

Upstream-row processor for GA4 workflow intelligence.

## Architecture (locked)

```
Trigger → googleAnalytics → GA4 MCP Tools → Filter / Sort / AI / Sheets / Gmail
```

- **Auth + `runReport`:** native `googleAnalytics` only
- **This plugin:** reads upstream `WorkflowItem[]`, runs selected capabilities independently, emits stamped rows
- **No** Google API, OAuth, external MCP server, Admin API, Ads, BigQuery, or Measurement Protocol

## V1 capabilities

| ID | Category |
|----|----------|
| `engagement_opportunities` | intelligence |
| `landing_underperformance` | intelligence |
| `acquisition_concentration` | intelligence |
| `page_performance` | data (`ranked_page`) |

## Status

**Step 3 scaffold** — contracts, multi-select processor, stubs, smoke tests.  
Capability evaluation and scoring land in Step 4+.

## Smoke

```bash
cd plugins/ga4-mcp && npm test
# or from backend:
npm run test:ga4-mcp
```
