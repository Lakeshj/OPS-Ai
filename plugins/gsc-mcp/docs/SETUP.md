# Setup

## Local validation (mock)

```bash
cd plugins/gsc-mcp
npm test
```

Host default transport is `mock` (`OPSAI_GSC_MCP_TRANSPORT` unset or `mock`) so CI and local UI work without spawning an external MCP.

## Live external MCP (stdio)

1. Ensure Node 18+ and network for `npx`.
2. Set:

```bash
set OPSAI_GSC_MCP_TRANSPORT=stdio
# optional overrides:
# set OPSAI_GSC_MCP_COMMAND=npx
# set OPSAI_GSC_MCP_ARGS=["-y","mcp-server-google-search-console"]
```

3. Restart backend. Connect a `google_gsc` credential in OpsAi; auth bridge injects access/refresh tokens into the child env.

4. Consume via **AI Assistant** APIs or **GSC MCP Tools** on an AI Agent — not a primary canvas GSC MCP node.

## Google scopes

OpsAi GSC OAuth currently uses `webmasters.readonly` by default. Inspection / write sitemap tools may need broader scopes — see `src/auth/scopes.js`. Phase 1 allowlists read tools; write tools require `allowWriteTools: true` in config.

## Backend script

```bash
cd backend && npm run test:gsc-mcp
```
