# Architecture

## Layers

1. **Connector** (`src/connector`) — MCP transport for Assistant live calls
2. **Auth bridge** (`src/auth`) — maps OpsAi `google_gsc` tokens for Assistant MCP execute only
3. **Registry / contracts** — capability + metric ids for all consumers
4. **Adapters**
   - `processUpstream` — main-flow GSC MCP Tools (no auth)
   - `aiAgentTool` / `chatIntent` — Assistant-oriented helpers
5. **Intelligence / Actions** — OpsAi-owned post-processors

## Product boundaries

| Surface | Role |
| --- | --- |
| `googleSearchConsole` | Only place for Google account + property selection |
| `gscMcpTool` | Main-flow processor on upstream WorkflowItems |
| Capability APIs | Assistant + future Filter / Sort / Analysis |
| Legacy `gscMcp` | Soft-deprecated; execution refuses |

## Auth separation

| Concern | Owner |
| --- | --- |
| Google account + site | `googleSearchConsole` node only |
| Row processing | `gscMcpTool` / `processUpstreamItems` |
| Live MCP (Assistant) | Plugin host with workspace credential |

Phase 2 replaces only the transport implementation.
