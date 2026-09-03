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

`workflow_run_steps.execution_index` (migration `017`). Multiple rows per `(run_id, node_id)` allowed. Retries update the same step row (same occurrence).

### Loop contract (runtime NOT enabled)

Ports: `items` + `continue` (in); `batch` + `done` (out). Param: `batchSize` default 1.

Only sanctioned `Loop.continue` back-edges from that Loop's batch body are valid cycles. Generic cycles rejected. Nested Loop rejected. Exactly one continue edge. Forward DAG = graph minus sanctioned back-edges.

Execute with a Loop node → `LOOP_RUNTIME_NOT_ENABLED` until Part 9B.

Library entry remains `available: false`.
