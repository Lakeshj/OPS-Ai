# Roadmap

## Phase 1 (this package)

- [x] Plugin scaffold + contracts
- [x] Stdio / mock connector + connection manager
- [x] Auth bridge for Assistant live MCP only
- [x] Essential catalog + capability/metric contracts
- [x] **GSC MCP Tools** as main-flow processor (no auth on node)
- [x] Docs + smoke tests

## Phase 2 — native OpsAi MCP

1. Implement native TypeScript MCP with the same OpsAi tool ids
2. Swap transport to `native`
3. Feature-flag per workspace

## Phase 2+ — GSC intelligence nodes

Filter / Sort / Analysis consume the same capability registry without duplicating Google OAuth.
