# OpsAi GSC MCP Plugin (Phase 1)

Plugin package that connects OpsAi to a **ready-made external GSC MCP server** (stdio), with stable contracts for a future **native OpsAi TypeScript MCP** (Phase 2).

## Purpose

- Validate MCP connectivity for the **AI Assistant** capability APIs
- Provide **GSC MCP Tools** as a **main-flow intelligence/action processor** after the native Google Search Console node
- Keep a **capability registry** for future Filter / Sort / Analysis nodes
- Keep transport swappable (`stdio` → `native`) without rewriting adapters

**Not** a second GSC connection. Auth and property selection stay on **Google Search Console** (`googleSearchConsole`).

## Correct workflow

```
Trigger → Google Search Console → GSC MCP Tools → Filter / Sort / AI → Destination
```

GSC MCP Tools consumes previous-node rows only (no Google account, OAuth, or site picker on this node).

## Consumers

| Consumer | How |
| --- | --- |
| Workflow canvas | `gscMcpTool` after `googleSearchConsole` |
| AI Assistant | `GET /plugins/gsc-mcp/tools?audience=assistant` + execute API (uses workspace GSC credential when calling live MCP) |
| Future GSC intelligence nodes | `executeCapability` + `contracts.capabilities` / `contracts.metrics` |

## Architecture (Phase 1)

```
OpsAi → GSC MCP Plugin → External GSC MCP (stdio) → Google Search Console API
         └─ processUpstreamItems (no auth) ← WorkflowItems from googleSearchConsole
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick setup

```bash
cd plugins/gsc-mcp && npm test
# or: cd backend && npm run test:gsc-mcp
```

## Essential catalog

See [docs/TOOLS.md](docs/TOOLS.md).

## APIs

- `GET /api/workflows/plugins/gsc-mcp/tools?audience=assistant|agent|workflow_future`
- `POST /api/workflows/plugins/gsc-mcp/execute`
- `POST /api/workflows/plugins/gsc-mcp/intent`
