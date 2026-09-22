# GA4 MCP Tools — architecture (Step 3)

```
Trigger → googleAnalytics (OAuth + runReport)
       → ga4McpTool (this plugin: upstream-row processor)
       → Filter / Sort / AI / Sheets / Gmail
```

## Boundaries

| Owns | Does not own |
|------|----------------|
| Capability registry + multi-select processor | Google OAuth |
| Output / warning contracts | `runReport` / Analytics Data API |
| Per-capability identity stamping | External / remote MCP server |
| Upstream row validation entry | UI registration (deferred) |

## Package layout

- `src/index.js` — `createPlugin` facade
- `src/contracts/` — capabilities, output, filters, input validation, node schema
- `src/adapters/processUpstream.js` — multi-select independent execution
- `src/capabilities/` — one module per capability (stubs in Step 3)
- `src/testing/smoke-scaffold.js` — scaffold proofs

## Multi-select

Selected capabilities each receive a **clone** of the same upstream rows.
Every emitted item is stamped with its originating `capability` (and
`opportunity_type` or DATA `row_kind`). One capability never overwrites another.
