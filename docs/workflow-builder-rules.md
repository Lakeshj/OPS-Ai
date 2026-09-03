# OpsAi Workflow Builder — Non-Negotiable Rules

This repository contains **our own workflow automation product**. Read this document before any workflow-related change.

**Related docs:** `workflow-builder-reference.md` (behavior), `workflow-node-contracts.md` (node spec)

---

## n8n is reference only

n8n may be used **only** as a functional/behavioral engineering reference — execution semantics, node schemas, ports, provenance, partial execution, triggers, merge, loops, expressions, credentials, errors, AI typed connections.

### DO NOT

- Clone n8n UI
- Copy n8n CSS, typography, spacing, or color tokens
- Copy node card appearance, panel layout, menu styling, or connector visuals
- Copy icon placement or visual hierarchy from n8n
- Copy wording merely because n8n uses it
- Redesign the existing OpsAi product to resemble n8n

### DO

- Translate comparable **behavior** into OpsAi's own architecture and UX
- Preserve OpsAi visual identity and existing React Flow canvas
- Reuse existing components where they remain functionally correct
- Keep existing API contracts unless a breaking change is justified and documented
- Keep existing database schema unless migration is genuinely required
- When a schema change **is** required: add the next `backend/migrations/NNN_*.sql`, run `npm run db:migrate` locally, commit the file, and ensure live runs migrate after deploy (`docs/database-migrations.md`)
- Keep existing working behavior unless fixing a verified bug or completing a scoped feature
- Use OpsAi expression syntax only:
  - `{{input}}`
  - `{{steps.<nodeId>.field}}`
  - `{{items.field}}`

---

## Preserve (unless explicitly scoped otherwise)

| Area | Constraint |
|------|------------|
| Visual identity | OpsAi design system (`components/ui`, existing workflow chrome) |
| Canvas | React Flow (`WorkflowCanvas.tsx`, custom nodes/edges) |
| Components | Extend `NodeInspector`, `WorkflowNodeDialog`, etc. — don't replace wholesale for parity |
| APIs | `/workflows/*` routes and partial-execution endpoints |
| Database | `workflows`, `workflow_runs`, `workflow_run_steps`, `workflow_jobs`, `workflow_credentials` |
| Expressions | OpsAi template syntax above — not `$json`, `$('Node')`, or n8n expression APIs |
| Credentials | Encrypted by ID via `secretBox` — never inline secrets in definition JSON |

---

## Implementation discipline

1. **Incremental changes** — one behavior or contract at a time; avoid large “make it like n8n” refactors.
2. **Regression-test** — after engine changes: `npm run test:workflows` (backend). After frontend changes: `npx tsc --noEmit`.
3. **Contract-first** — node ports, cardinality, and pairedItem policies live in `frontend/src/modules/workflows/nodeContract.ts` and `backend/config/nodeContract.js`; implement engine/UI against those contracts, not against n8n screenshots.
4. **Behavior vs chrome** — when n8n docs say “show INPUT tab,” implement the **data rule** (hide INPUT when `inputs.length === 0`); do not copy n8n panel dimensions, labels, or empty-state copy verbatim.
5. **No silent breakage** — changing partial execution, pins, schedule, or expression resolution requires updating smoke tests or adding a targeted test case.

---

## Concepts we may align with industry patterns (behavior only)

These are **semantic** targets, not UI clones:

- Item array model between nodes
- Registry-driven ports and inspector layout rules
- pairedItem provenance for expression back-references
- Dirty invalidation for editor session cache
- Trigger types: manual, schedule, webhook
- Merge blocking and combine modes
- Partial execution: run step, run to node, execute upstream
- Error policy: stop / continue / route
- AI cluster typed ports (model, memory, tools) — OpsAi port IDs and wiring

---

## Review checklist (before merge)

- [ ] No n8n-specific UI/CSS copied
- [ ] Existing APIs and expression syntax unchanged (or migration noted)
- [ ] `nodeContract.ts` updated if node behavior/ports changed
- [ ] Backend smoke tests pass
- [ ] Frontend typecheck passes
- [ ] Change is incremental; working flows still run
