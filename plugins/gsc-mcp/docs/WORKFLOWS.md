# Workflows

## Correct canvas chain

1. **Trigger** (Manual / Schedule / …)
2. **Google Search Console** — account + property + analytics fetch
3. **GSC MCP Tools** — intelligence/action on those rows (no Google login)
4. **Filter / Sort / AI** — refine results
5. **Destination** (Sheets / Gmail / XLSX / …)

```
Trigger → Google Search Console → GSC MCP Tools → Filter/Sort/AI → Destination
```

## GSC MCP Tools params

- **Capability only** (CTR / ranking / content decay / prepare sheet / prepare email)
- No credential, OAuth, site, or property fields

## AI Assistant

Live MCP data tools still use a workspace `google_gsc` credential via the plugin host APIs — not via the GSC MCP Tools canvas node.

## Future GSC intelligence nodes

Call the same contracts:

- `plugin.processUpstreamItems({ capability, inputItems })`
- `plugin.executeCapability(toolId, args, authContext)` when live MCP is required
- `plugin.contracts.capabilities` / `plugin.contracts.metrics`

## Real property checklist

1. Connect `google_gsc` on the **Google Search Console** node
2. Run GSC → GSC MCP Tools (e.g. CTR opportunities)
3. Confirm Filter/Sort works on the enriched rows
4. Confirm native GSC auth was never prompted on GSC MCP Tools
