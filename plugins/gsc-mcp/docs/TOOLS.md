# Tools

Essential Phase 1 catalog (**14** tools). Internal ids are stable; UI labels come from `contracts/capabilities.js`.

## Data (6) — proxied MCP

| Id | Label | Notes |
| --- | --- | --- |
| `get_capabilities` | Capabilities | Discovery only (Assistant / Agent). Not for normal canvas ops. |
| `list_properties` | List properties | Aliases: `list_sites` |
| `get_performance_overview` | Performance overview | Aliases: `get_performance_summary` |
| `get_search_analytics` | Search analytics | Rows for Filter / Sort / Analysis |
| `compare_search_periods` | Compare periods | Aliases: `compare_periods` |
| `inspect_url_enhanced` | Inspect URL | Aliases: `inspect_url` |

Blocked: `reauthenticate` (OpsAi owns OAuth). Write tools gated by `allowWriteTools` (off by default).

## Intelligence (6) — OpsAi-side (GSC MCP Tools processor)

| Id | Label |
| --- | --- |
| `ctr_opportunities` | CTR opportunities |
| `ranking_opportunities` | Ranking opportunities |
| `content_decay` | Content decay |
| `keyword_cannibalization` | Keyword cannibalization |
| `query_gap_analysis` | Query gap analysis |
| `page_optimization_suggestions` | Page optimization suggestions |

All intelligence tools accept `{ rows }` (+ optional filters) from upstream GSC WorkflowItems and return:

```
{
  kind,
  count,
  opportunities: [{
    opportunity_type, // ctr_opportunity | ranking_opportunity | content_decay | keyword_conflict
    entity: { query, page, label },
    metrics: { clicks, impressions, ctr, position, ... },
    reason,           // data-specific explanation with numbers
    recommendation,   // concrete next action (not generic)
    score,
    score_breakdown   // transparent formula + inputs
  }]
}
```

### Configurable filters (GSC MCP Tools UI)

| Capability | Filters |
| --- | --- |
| CTR opportunities | `minImpressions`, `maxPosition`, `minScore`, `limit` |
| Ranking opportunities | `minImpressions`, `minPosition`–`maxPosition`, `limit` |
| Content decay | `comparisonPeriod` (`snapshot` \| `prior_period`), `dropPercentage`, `limit` |
| Keyword cannibalization | `minPages`, `minImpressions`, `limit` |


## Action handoffs (2) — OpsAi-side

| Id | Label | Handoff |
| --- | --- | --- |
| `prepare_sheet_rows` | Prepare sheet rows | Google Sheets shape |
| `prepare_email_digest` | Prepare email digest | Gmail subject/body |

## Metrics (for future Filter / Sort / Analysis)

Stable metric ids (not MCP tools): `get_impressions`, `get_clicks`, `get_ctr`, `get_position` — labels via `contracts/metrics.js`.

## Audiences

| Audience | Includes `get_capabilities` |
| --- | --- |
| `assistant` | yes |
| `agent` | yes |
| `workflow_future` | no |

## Consumers

- **Workflow canvas** — `gscMcpTool` after `googleSearchConsole` (processor capabilities only; no auth)
- **AI Assistant** — execute via plugin host with workspace credential when live MCP is needed
- **Future GSC nodes** — same capability registry (`executeCapability` / `processUpstreamItems`)
- **Normal workflow users** — Google account + property only on `googleSearchConsole`
