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

## Wait node semantics (Part 8A — durable time-based)

Authoritative service: `backend/services/workflowWait.service.js`.

### Lifecycle

`queued → running → waiting → running → succeeded|failed|cancelled`

Wait step: `running → waiting → succeeded` (same step row).

Job: `queued → locked → queued(available_at=resumeAt) → locked → done`.

Wait record: `waiting → claimed → resumed` (or `cancelled`).

### Persistence

- `workflow_runs.definition_snapshot_json` freezes the graph at enqueue (resume never uses a later edit).
- `workflow_waits` stores absolute `resumeAt`, execution snapshot (steps/items/portOutputs/scheduler state), and claim status.
- No long `setTimeout` as source of truth; worker requeues with `available_at = resumeAt`.
- Suspension is a single DB transaction (wait row + run waiting + step waiting + job requeue).
- After claim, a progress snapshot (`waitCompleted: true`) is written so crash mid-downstream can restore without cold-starting.
- Stale `locked` jobs and `claimed` waits are reclaimed after `WORKFLOW_WAIT_CLAIM_LEASE_MS` / `WORKFLOW_JOB_LOCK_LEASE_MS` (default 5m).

### Parallel branches

The engine is single-threaded per run. Reaching Wait suspends the **entire** run; sibling ready branches are frozen in the scheduler snapshot and continue only after resume. Part 8A does **not** keep other branches executing while one arm waits.

### Binary durability

Snapshot keeps `storageKey` / `filePath` / mime metadata refs only. Inlined Buffer/base64 `data` is stripped. Classification: **SUPPORTED ONLY IF EXTERNAL FILE STILL EXISTS**.

### Editor vs production

- Full Execute / Schedule / Webhook: real durable suspension.
- Run Step / Run To: preview only (`wouldResumeAt`); no durable wait row.

### Cancellation

`POST /workflows/:id/runs/:runId/cancel` cancels queued/running/waiting runs and marks waits cancelled. Cancel vs resume uses CAS: claim requires run still `waiting`; terminal run updates require status `running`.

### Deactivation

Deactivating a workflow unregisters schedule triggers only. It does **not** cancel already-waiting runs (frozen policy).

### Editor poll limitation

Editor run polling stops after ~60s; open Run history later to see still-waiting runs.