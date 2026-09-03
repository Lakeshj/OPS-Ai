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

## Wait node semantics (Part 8A / 8A.1 / 8B)

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

Wait step: `running → waiting → succeeded` (same step row).

Job: `queued → locked → queued(available_at) → locked → done`.

Wait record: `waiting → claimed → resumed` (or `cancelled`).

### External token security

- 256-bit `crypto.randomBytes` → base64url
- At rest: SHA-256 hash for lookup + AES ciphertext for authorized UI reveal only
- Raw token never in snapshot, step output, or public list APIs
- Transport: **body / Bearer header only** (not URL path/query — avoids access-log leakage)
- One-time / idempotent signal; invalid/cancelled tokens → generic `404 { ok: false, code: "INVALID" }`

### Persistence

- `workflow_runs.definition_snapshot_json` freezes the graph at enqueue (resume never uses a later edit).
- `workflow_waits` stores mode, absolute/null `resumeAt`, execution snapshot, claim status, token hash.
- No long `setTimeout` as source of truth; worker requeues with `available_at`.
- Suspension is a single DB transaction.
- After claim, progress snapshot (`waitCompleted: true`) enables crash mid-downstream recovery.
- Stale locks reclaimed after lease (default 5m).

### Parallel branches

The engine is single-threaded per run. Reaching Wait suspends the **entire** run; sibling ready branches are frozen in the scheduler snapshot and continue only after resume.

### Binary durability

Snapshot keeps `storageKey` / `filePath` / mime metadata refs only. Inlined Buffer/base64 `data` is stripped. Classification: **SUPPORTED ONLY IF EXTERNAL FILE STILL EXISTS**.

### Editor vs production

- Full Execute / Schedule / Webhook: real durable suspension.
- Run Step / Run To: preview only (`wouldResumeAt` / `wouldWaitFor`); no durable wait row or tokens.

### Cancellation

`POST /workflows/:id/runs/:runId/cancel` cancels queued/running/waiting runs and marks waits cancelled. Cancel vs resume uses CAS.

### Deactivation

Deactivating a workflow unregisters schedule triggers only. It does **not** cancel already-waiting runs (manual/external tokens remain valid until cancel/delete).

### Webhook + Wait

Webhook trigger returns `201` with the queued run immediately — it does **not** hold the HTTP connection until the workflow finishes. Wait does not hang the inbound webhook request.

### Editor poll limitation

Editor run polling stops after ~60s; open Run history later to see still-waiting runs.
