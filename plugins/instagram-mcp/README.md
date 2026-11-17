# Instagram MCP plugin (OpsAi M7)

Read-only Instagram MCP tools for `instagramMcpTool`.

- Deploy under root **`/plugins/instagram-mcp`** (outside `/backend`).
- Graph HTTP, OAuth, insights catalog, and comments stay in backend Instagram services.
- V1 tools: account_summary, list_media, media_details, comments, account_insights, media_insights.
- No publish or reply tools.

```bash
cd plugins/instagram-mcp && npm test
```
