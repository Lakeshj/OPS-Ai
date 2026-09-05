# OpsAi Workflow Engine Rules

**Canonical governance for all workflow work.**

This file is the entry point referenced by implementation specs. Full rules:

→ **[workflow-builder-rules.md](./workflow-builder-rules.md)**

Quick summary:

- OpsAi owns this product; external tools are **behavior reference only**
- Do not clone external UI/CSS/copy
- Preserve expression syntax: `{{input}}`, `{{steps.<nodeId>.field}}`, `{{items.field}}`
- Incremental changes + regression tests (`npm run test:workflows`, `npx tsc --noEmit`)
- Node contracts: `frontend/src/modules/workflows/nodeContract.ts`

## Schedule trigger semantics (frozen — Part 7/7B/7C)

Authoritative calculator: `backend/utils/scheduleRecurrence.js`. Preview API and production scheduler share it.

### Timezone

Precedence: rule `timezone` → schedule node `timezone` → workflow `settings.timezone` → `UTC`.

### Recurrence strategies

- **Cron-compatible** — seconds, minutes, hours, daily, weekly (every 1 week), monthly (every 1 month), custom cron.
- **Anchored** — every N days/weeks/months where N > 1. `recurrenceAnchor` is set on publish and preserved across restarts.

### Calendar intervals

Days, weeks, and months use timezone-aware calendar math (Luxon), not fixed millisecond durations.

### Edge cases

- **Day 31 monthly** — skip months that do not have that day.
- **Feb 29** — only in leap years.
- **Spring-forward** — nonexistent local time shifts forward to the next valid local instant (e.g. 02:30 → 03:30).
- **Fall-back** — one execution per intended local wall-clock occurrence; repeated UTC instants for the same local time dedupe.

### Downtime

Future-only: missed occurrences are not backfilled after restart or downtime.

### Idempotency

Key: `schedule:{workflowId}:{nodeId}:{ruleId}:{localOccurrenceKey}:{timezone}` where `localOccurrenceKey` is `yyyy-MM-dd'T'HH:mm:ss` in the resolved timezone (local wall time, not UTC instant).

### Scheduler runtime

Anchored rules use bounded reconciliation (`MAX_SCHEDULER_WAKE_MS` = 24h): the scheduler never sleeps longer than 24h without recalculating; once within the bound, the timer uses the actual remaining delay. No multi-month `setTimeout`. `refreshAll()` re-registers from persisted definition; anchor and idempotency remain authoritative.

## Wait node semantics (Part 8A / 8A.1 / 8B) — FROZEN

Authoritative service: `backend/services/workflowWait.service.js`.

### Modes

| Mode | Resume trigger | `resume_at` |
|------|----------------|-------------|
| **time** | Absolute duration / waitUntil | Set at suspend |
| **manual** | Authenticated `POST .../runs/:runId/resume` | `null` until signalled → NOW |
| **external** | Opaque token `POST /workflow-resume` body `{ token }` | `null` until signalled → NOW |

All modes converge: signal (or due time) → job available → worker `claimDueWaitForRun` → same `runId` continues from snapshot.

### Lifecycle

`queued → running → waiting → running → succeeded|failed|cancelled`

### Persistence

- Definition snapshot at enqueue; Wait snapshot serializes scheduler + context + `runData` (v2).
- Legacy v1 Wait snapshots normalize to occurrence 0.
- Suspension is transactional; claim leases recover crash-after-claim.

### Editor vs production

- Full Execute / Schedule / Webhook: durable suspension.
- Run Step / Run To: preview only; no durable wait/token.
- Editor run status poll interval is **60** seconds for waiting runs (UI limitation; production resume is signal/job driven, not poll-driven).

### Deactivation / delete

Deactivate does **not** cancel already-waiting runs. Delete cascades waits/jobs/runs.

## Execution occurrences + controlled cycles (Part 9A — foundation)

Authoritative services:

- `backend/services/workflowOccurrence.service.js` — `runData[nodeId][]`
- `backend/services/workflowLoopGraph.service.js` — Loop topology + DAG projection

### Occurrence identity

Node identity ≠ execution occurrence. Each execution has `runIndex` (0 for normal workflows).

Canonical storage: `runData[nodeId] = [{ runIndex, items, output, portOutputs, inputSources, status, ... }]`.

Compatibility views: `context.items` / `steps` / `portOutputs` = **latest** occurrence.

`inputSources` names the exact predecessor occurrence per input port (not encoded in `pairedItem`).

### Persistence

`workflow_run_steps.execution_index` (migration `017`). Multiple rows per `(run_id, node_id)` allowed.

**Occurrence identity (Part 9A.1):** UNIQUE `(run_id, node_id, execution_index)` (migration `018`). Retries and Wait resume update the same step row / same `execution_index`. Status changes do not allocate a new index. `runData[nodeId][runIndex]` aligns 1:1 with `execution_index`.

### Loop contract (Part 9B — production runtime)

Ports: `items` + `continue` (in); `batch` + `done` (out). Param: `batchSize` default 1 (integer ≥ 1).

Finite iterations: `ceil(initialItemCount / batchSize)`. Body fan-out / empty output does not change iteration count.

Controller state lives on `context.loopControllers[loopNodeId]` (serializable; included in Wait snapshots).

Body region alone reactivates per iteration (new `runIndex` each time). `done` emits once with collected continue results; per-item `inputSources.continue` preserves body occurrence identity.

Reject: Wait-in-body, nested Loop, body side exits, invalid batchSize, missing continue/batch edges.

Library: **Loop Over Items** is available (`available: true`). Semantic ports: Items / Continue / Batch / Done.

### Editor execution (Part 9C)

- Full **Execute workflow** runs production Loop.
- **Run Step** on Loop or body: unsupported (clear message).
- **Run To** / **Execute Previous** on Loop or body: unsupported.
- **Run To** / **Execute Previous** on a node after `Loop.done`: executes the Loop region as a complete unit, then (for Run To) the target path.
- Inspector: occurrence selector when `occurrences.length > 1`; Loop Batch / Done views; expression preview accepts `runIndex`.
- Outside Loop, `{{steps.<bodyId>.field}}` with multiple body occurrences remains `OCCURRENCE_AMBIGUOUS`.

Crash during Loop: at-least-once worker semantics (no mid-loop checkpoint beyond existing Wait durability).

Known V1 limits: nested Loop, Wait-in-Loop, break/continue, mid-loop crash resume, Tidy/auto-layout of Continue back-edges (dedicated layout phase later). Clipboard: selecting Loop + full body + Continue remaps IDs safely; duplicating Loop alone does not copy the body.

## Sub-workflow execution foundation (Part 10A)

Authoritative service: `backend/services/workflowSubworkflow.service.js`.

- Parent and child are **separate** `workflow_runs` (not inlined nodes).
- Lineage: `parent_run_id`, `parent_node_id`, `parent_execution_index`, `root_run_id`.
- Idempotent invocation per parent occurrence (UNIQUE).
- Child freezes its own `definition_snapshot_json` at invoke.
- Durable parent wait uses `workflow_run_dependencies` + `waiting_reason=child_run` (not Wait-node rows).
- Child terminal → wake parent job; `reconcileOrphanedChildWaits` recovers missed wakes.
- Recursion rejected via ancestor workflow IDs; `MAX_SUBWORKFLOW_DEPTH = 10`.
- Internal entry type: `workflowTrigger` (library not enabled until Part 10B).
- V1 callable contract: exactly one Result + Workflow Trigger entry.

Do **not** enable Execute Workflow / Workflow Trigger UI until Part 10B.

## Execute Workflow + Workflow Trigger (Part 10B)

Authoritative services:

- `backend/services/workflowSubworkflow.service.js` — `validateCallableWorkflow`, `invokeSubworkflow`
- `handlers.executeWorkflow` / `handlers.workflowTrigger` in `workflowNodes.service.js`

### Nodes

| Node | Role |
|------|------|
| **Workflow Trigger** | Callable entry; emits invocation `WorkflowItem[]` when `input.source === "subworkflow"` |
| **Execute Workflow** | Invokes child via Part 10A; param `workflowId` only |

### Callable contract

Exactly one Workflow Trigger + exactly one Result, and Result reachable from Trigger.
Additional Schedule/Webhook triggers allowed for other modes.

### Editor

Run Step / Run To on Execute Workflow: **controlled unsupported** (`EXECUTE_WORKFLOW_PARTIAL_UNSUPPORTED`).
Full durable Execute (worker) uses Part 10A parent wait / child wake.

### Picker

`GET /workflows/callable-targets?workspaceId=&excludeWorkflowId=` — metadata only, same-workspace.

## Result node + callable return (Part 10B.1)

Two concepts (do not conflate):

| Concept | Meaning |
|---------|---------|
| **Result NODE** | Terminal scalar `output.result` from `mapFrom` (historical pre-10B contract). Occurrence `items` are derived from that output wrapper. No output port (`N-to-0`). |
| **Callable RETURN** | Canonical `WorkflowItem[]` that **arrived at** Result (`context.inputItems`), persisted on the Result step as `__callableReturnItems`. |

`getSubworkflowResult` reads the Result step’s `__callableReturnItems` (authoritative).  
`run.output.__subworkflowItems` is a **compatibility mirror** written once from the same array at child success — not a second source of truth.

Multiple succeeded Result occurrences on one child run → `SUBWORKFLOW_AMBIGUOUS_OUTPUT` (never silently pick latest).

## Sub-workflow workspace UX (Part 10C)

- Lineage: `GET /workflows/:id/runs/:runId/lineage` — safe metadata only (names, status, parent/child ids). No credentials, tokens, or snapshots.
- Occurrence child link: `GET .../runs/:runId/nodes/:nodeId/child-invocation?executionIndex=`
- Editor: `?runId=` deep-link; breadcrumb `RunLineageBadge`; Execute Workflow inspector `SubworkflowRunSummary`.
- Display names use **current** workflow name when live; soft-deleted workflows use `workflow_name_snapshot` / retained row name, else “Deleted workflow”.
- Partial execution (Run Step / Run To / Execute Previous) for Execute Workflow remains **unsupported**.
- UI never shows `__callableReturnItems` / `__subworkflowItems` as business fields.

## Historical run retention (Part 10C.1)

- Live workflow **delete** is soft-delete (`workflows.deleted_at`). Hard `DELETE` remains for workspace teardown (CASCADE) only.
- Deleting a live definition does **not** cascade-erase `workflow_runs` / steps / dependencies for that workflow.
- Active-run policy: **block** delete while `queued` / `running` / `waiting` runs exist (`WORKFLOW_HAS_ACTIVE_RUNS`).
- Soft-deleted workflows are absent from lists and callable picker; new Execute Workflow → `CHILD_WORKFLOW_NOT_FOUND`.
- Historical runs remain readable via `getRun` / lineage (workspace-authorized). Open run works; Open workflow is hidden.
- Run identity: `workflow_id` FK retained + optional `workflow_name_snapshot` at run start.
- Explicit run retention/cleanup (if any) is separate from definition soft-delete.

## Error Workflow (Parts 11A–11C)

- Source run terminal `FAILED` may create one durable `workflow_error_dispatches` row (UNIQUE on `source_run_id`).
- Source remains `FAILED` regardless of Error Workflow outcome; source worker does not await the Error run.
- `workflows.error_workflow_id` + `workflow_runs.error_workflow_id_snapshot` freeze routing at run start.
- Configure via workflow settings (`PATCH /workflows/:id/error-workflow`) and picker (`GET /workflows/error-targets`).
- Lineage: `GET /workflows/:id/runs/:runId/error-routing` — bidirectional source ↔ handler navigation (safe metadata only).
- `suppress_error_routing` on Error runs (and descendants) prevents recursive error storms.
- `errorTrigger` node is library-available; emits one safe failure event item.
- Cancelled / retries / job lease recovery do not dispatch.
- Retry Failed Run / node error branches are out of scope.

## Typed auxiliary ports (Part 12A)

Authoritative service: `backend/services/workflowConnection.service.js` (FE mirror: `connectionPorts.ts`).

### Connection classes

- **execution** — WorkflowItem[] dependency / routing (scheduler, provenance, expressions, tidy rank).
- **auxiliary** — resource/capability binding (model / tool / memory). Not WorkflowItem flow.

`connectionKind` is **derived** from endpoint port contracts. Do not persist a conflicting edge-level kind.

### Port data types (V1)

`workflow-items`, `ai-model`, `ai-tool`, `ai-memory`. Future types (embedding, vector-store, …) may be added without changing this projection model.

### Stable port IDs

Once introduced on production Agent/provider contracts, do **not** casually rename persisted handle IDs such as `model`, `tools`, `memory` (or bot’s `ai_languageModel` / `ai_tool` / `ai_memory`).

### Graph projections

- `getExecutionEdges(definition)` — scheduling / item ancestry / expression reachability / ELK primary rank.
- `getAuxiliaryEdges(definition)` — bindings + dirty invalidation only.
- `resolveAuxiliaryBindings({ nodeId, definition })` — graph metadata only (no credentials/clients). Tool order: stable by `edge.id` ascending.

### Dirty invalidation

Auxiliary bindings participate in **invalidation** (provider param / reconnect / delete → consumer + execution downstream dirty) but **not** in the WorkflowItem scheduler.

### Runtime

Part 12A does **not** enable AI Agent / model / tool / memory execution. Test fixtures (`ai*Test`) are structural only.

## AI Agent + Model + Tool runtime (Part 12B)

Authoritative services:

- `backend/services/workflowAiResources.service.js` — descriptors, adapters, tool validation
- `backend/services/workflowAiAgent.service.js` — per-item Agent loop

### Canonical types

- **aiAgent** — normal WorkflowItem execution node (not a rename of legacy `bot`)
- **aiChatModel** — auxiliary model provider (OpenAI-compatible adapter)
- **aiCalculatorTool** — auxiliary calculator tool
- Legacy **ai** / **bot** handlers unchanged

### Runtime rules

- Providers are **never** scheduled as WorkflowItem steps and produce no `workflow_run_steps`.
- Agent requires exactly one model binding at execution (`AI_MODEL_REQUIRED`).
- Connected memory fails with `AI_MEMORY_NOT_SUPPORTED` (memory runtime deferred).
- Per input item: one independent Agent interaction; `pairedItem` identity 1:1.
- Bounded tool loop: `MAX_AGENT_TOOL_ROUNDS = 8`.
- Tool side effects are **at-least-once** under node retries (same `executionIndex`).
- Descriptors are serializable; runtime clients are ephemeral and rebuilt after Wait/resume.
- **HTTP Tool (`aiHttpTool`)** — Part 13A: auxiliary `ai-tool` provider; reuses HTTP fetch/credentials; `{{tool.*}}` arg mapping scoped to tool request resolution; model cannot override method/URL host/credentials; no `workflow_run_steps`; Code-as-tool remains unavailable.

## AI workspace UX (Part 12C)

UI-only polish on top of 12A/12B. No Memory/RAG/streaming in 12C.

## HTTP Tool (Part 13A)

- Library: **HTTP Tool** (`http-request-tool` → `aiHttpTool`), distinct from Core **HTTP Request** (`http`).
- Tool-argument syntax: `{{tool.<arg>}}` only inside HTTP Tool URL/query/headers/body resolution (does not change global `{{input}}` / `{{steps.*}}`).
- Failures (4xx/5xx/timeout) → tool failure → Agent failure (12B semantics).
- Redirects not followed; metadata hosts blocked. Broader private-network SSRF remains a known limitation shared with HTTP Request.
- POST/PUT/PATCH/DELETE may repeat under Agent/node at-least-once retries.

## Webhook Respond + HTTP security (Part 13B)

- Default webhook mode remains **immediate**: enqueue run → `201` + run JSON (caller does not wait).
- **Respond to Webhook** (`respondToWebhook`): bounded **synchronous** execute in the HTTP process; no Express `res` serialization; no worker job for that delivery.
- Respond mode rejects reachable Wait, Execute Workflow, multiple Respond nodes, and Respond inside Loop body.
- Shared `workflowHttpSecurity.service.js`: http(s) only; default-deny loopback/private/link-local/metadata after DNS; redirects followed manually with per-hop revalidation; strip Authorization on cross-origin redirect.
- Tests inject `withHttpSecurityTestPolicy({ allowLoopback: true })` — production defaults stay deny.

## Workflow Copilot foundation (Part 14A)

Copilot is an **editor assistant**, not an AI Agent node and not a workflow run.

- Context: bounded, redacted (`workflowCopilot.service.js`); no decrypted credentials / Wait resume tokens.
- Mutations only via constrained operations (`addNode`, `removeNode`, `updateNodeParameters`, `connectNodes`, `disconnectEdge`, `reconnectEdge`, `setWorkflowSetting`, optional `renameNode`).
- Validate → preview → explicit apply; apply returns a draft definition (no auto-save / execute / activate).
- Stale plans rejected via `revisionHash` (`COPILOT_PLAN_STALE`).
- Authoritative graph rules remain `validateDefinition` / connection / Loop / Respond / Error / Subworkflow validators.
- API: `POST /workflows/:id/copilot/{context,validate-plan,apply-plan,diagnose}`.

## Workflow Copilot planning turn (Part 14B / 14B.2 — drawer contract)

Future 14D floating button + right drawer will call a **stateless** planning turn:

`POST /workflows/:id/copilot/plan`

**Request (drawer → API):** `message`, `workflowId`, `revisionHash`, optional `selectedNodeId`, `runId`, `recentConversation`, `clarification`, optional draft `definition`.

**Response:** `intent`, `assistantMessage`, `summary`, `plan`, `preview`, `unresolvedInputs`, `clarifyingQuestions`, `assumptions`, `warnings`, `unsupportedCapabilities`, `revisionHash`, `needsClarification`, `createdWorkflowRun: false`.

### Part 14B.2 — real NL planner

- Production: `ModelCopilotPlanner` → existing `AI_MODEL_ADAPTERS` (`openai` / `deepseek` / `gemini`) with **server** keys (`COPILOT_PROVIDER` / `COPILOT_MODEL`).
- Tests: `DeterministicCopilotPlanner` fixtures only — no network.
- Pipeline: structured JSON plan → strict parse → `validateCopilotOperations` → bounded repair (`MAX_COPILOT_PLAN_REPAIR_ROUNDS=2`) → preview / `COPILOT_PLAN_INVALID`.
- LLM is never authoritative. Planning never creates `workflow_run` / steps / jobs.
- Production without provider keys returns `COPILOT_PROVIDER_UNAVAILABLE` (no silent test-planner fallback).
- Multi-turn clarification via client-supplied `recentConversation` + `clarification` (no server chat DB in V1).
- CREATE / MODIFY planning in 14B; DEBUG / FIX return structured deferral until 14C.
- No floating button / drawer UI in 14B (14D).

- Agent card shows Model required / Model label + Tools count (via `getAiAgentReadiness`).
- Auxiliary edges labeled Model / Tool (not generic “Resource” when type known).
- Memory handle hidden until a production memory provider is Available.
- Chat Model / Calculator are resource cards; Run Step is controlled-unsupported.
- Inspector: Resources summary separate from INPUT items; tool-call trace from safe `agentMeta`.
- Typed resource picker from Agent Model/Tools handles (filtered NodePickerDialog).
- Error codes mapped through `mapAiErrorCodeToMessage` / `backend/utils/aiAgentUx.js`.
