# OpsAi core context (compact)

Stable invariants for Cursor. Deep specs stay in `docs/WORKFLOW_ENGINE_RULES.md`, `docs/workflow-builder-rules.md`, `docs/workflow-node-contracts.md`. Do not paste this file into every prompt.

## A. Core stack

- Frontend: Next.js App Router + TypeScript — `frontend/` (port 3001)
- Backend: Express + Node — `backend/` (port 5013)
- DB: MySQL; schema only via `backend/migrations/` + `npm run db:migrate`
- Canvas: React Flow (`WorkflowCanvas.tsx`); OpsAi visual identity
- Plugins: `plugins/*-mcp/` for MCP tools; Graph HTTP/OAuth stay in backend services
- n8n is **behavior reference only** — never clone UI/CSS/copy

## B. Workflow execution invariants

- Item shape: `{ json, pairedItem?, binary? }`. One entity/row = one WorkflowItem unless a node contract says otherwise.
- **Execution edges** carry WorkflowItem[] (scheduler, provenance, expressions).
- **Auxiliary edges** bind model/tool/memory. Not item flow. Providers are not scheduled as steps and create no `workflow_run_steps`.
- Occurrences: `runData[nodeId][]` with `runIndex`. `context.items` / `steps` = **latest** occurrence.
- `pairedItem` is provenance policy (`identity1to1` | `fanOut` | …). `inputSources` names the exact predecessor occurrence per port.
- Merge/barriers wait for required execution inputs; Filter empty ≠ failure.
- Dirty/stale: param/edge/pin/credential change dirties the node + execution descendants. Pins cut editor-run propagation. Auxiliary bindings invalidate, they do not schedule.
- Pins/saved runs are canonical execution data. Do not rewrite historical pins.

## C. Expression invariants

OpsAi syntax only:

- `{{input}}`
- `{{steps.<nodeId>.field}}`
- `{{items.field}}`
- accessors: `$first` / `$last` / `$item` / `$all[n]`

Not n8n: `$json`, `$('Node')`. HTTP Tool may use `{{tool.<arg>}}` **inside that tool only**.

## D. Native node vs MCP

- Native provider node owns credential + account/property/customer context.
- Dedicated MCP node (`*McpTool`) inherits that context. Source binding is **node config**, not main item flow.
- Do not persist inherited `credentialId` / account ids on the MCP node.
- Generic Dynamic MCP node is hidden from normal users.
- Share HTTP/auth/catalog infrastructure; do **not** clone another provider’s semantics.

## E. Security

- Credentials encrypted server-side (`secretBox`). Never tokens, app secrets, proofs, or paging URLs in node JSON, logs, `_meta`, or errors.
- Scopes: only what is implemented. No `ads_management` on Meta. Google Ads reporting is read-only unless a scoped write is explicitly added.
- No Marketing/Ads mutations unless a later phase explicitly implements them.
- Schema: next migration file only; never edit applied migrations; never live-GUI-only MySQL.

## F. Provider status (current)

| Provider | Native | MCP | Notes (frozen) |
|----------|--------|-----|----------------|
| GSC | `googleSearchConsole` | `gscMcp` processor + data tools | Search Analytics canonical order: CTR DESC → impressions DESC → clicks DESC → position ASC → query/page ASC. Date series stay chronological. |
| GA4 | `googleAnalytics` | `ga4-mcp` intelligence | Curated metrics/dims; MCP processes upstream rows. |
| Google Ads | `googleAds` | `googleAdsMcpTool` | Read-only reports/GAQL. **Next audit target.** |
| Meta Ads | `metaAds` (4 Insights reports) | `metaAdsMcpTool` Common + Performance | Graph v26.0, `ads_read`, GET-only. MCP inherits `credentialId`+`adAccountId` from `metaAds`. Dates in account timezone. Action arrays stay `array<object>`. |

Inspector Table header sort is **display-only** and does not change these canonical orders.

## G. AI / Agent

- Agent is an execution node. Model/tools/memory are auxiliary.
- Exactly one model binding. Memory runtime not supported (`AI_MEMORY_NOT_SUPPORTED`).
- Per input item: independent Agent turn; `pairedItem` 1:1; max 8 tool rounds.
- Provider grounding: Meta/Google Ads/GA4/GSC rules apply only when `_meta.provider` matches. Do not cross-label.
- Agent prompts are item-scoped by default: `{{item.*}}` resolves per item and does **not** append a full workflow runtime JSON blob. Use `contextScope: "dataset"` (or `{{items}}`) for one dataset-level Agent turn.

## H. Inspector

- Shared: `inspectorViewModel.ts` + `ItemDataViewer.tsx` (Table / JSON / Schema / Binary).
- Table header sort: none → DESC → ASC → none. Stable ties. Does **not** mutate WorkflowItems, JSON, Schema, pins, `$first`, or downstream order.
- Structured arrays (`labelIds`, Meta `actions`) stay arrays.

## I. Development rule

Working code stays frozen unless an audit proves a bug. Prefer the smallest layer fix. No speculative refactors.

Prompt delta: future tasks state problem, subsystem, extra invariants, acceptance, focused tests — and point here instead of restating architecture.

---

## CURRENT PRIORITIES

1. Google Ads / Google Ads MCP correctness audit + fixes
2. MCP Tool → AI data-flow/tool-context fix
3. AI repeated-data / Agent-context fix
4. Cross-provider audit/testing
5. Resume platform integrations afterward
