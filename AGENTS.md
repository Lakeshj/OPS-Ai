<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:opsai-cursor-context -->
# Cursor work rules (token-efficient)

Architecture: read **`docs/OPSAI_CORE_CONTEXT.md`** when the task depends on workflow/provider/AI invariants. Do not restate it in replies.

Tests: **`docs/OPSAI_TEST_MATRIX.md`**. Level 1 while iterating, Level 2 after the fix, Level 3 only when asked or at milestone/deploy. Do not run `test:workflows` after every tiny edit. Do not delete tests.

- Do not scan the whole repo. Start from files named in the task; follow imports only as needed.
- Do not reread frozen providers unless that provider is in scope.
- Use `git status` / `git diff` for current changes; do not reconstruct milestone history.
- Before editing: name the root cause and the smallest layer. Prefer targeted fixes. Working code stays frozen unless a bug is proven.
- No huge reports. Default: root cause (≤3), files, fix (≤5), tests + exit codes, new failures only.
- Future prompts should state problem, subsystem, extra invariants, acceptance, focused tests — and cite `docs/OPSAI_CORE_CONTEXT.md` instead of repeating architecture.
- Never skip security, migrations, relevant regressions, or typecheck to save tokens. Never ignore failures.
<!-- END:opsai-cursor-context -->

<!-- BEGIN:workflow-builder-rules -->
# Workflow builder (OpsAi)

When editing anything under `frontend/src/components/workflows/`, `frontend/src/modules/workflows/`, or `backend/**/workflow*`:

1. Read **`docs/OPSAI_CORE_CONTEXT.md`** for invariants, then **`docs/workflow-builder-rules.md`** for builder law. n8n is **behavior reference only**; never clone n8n UI/CSS/copy.
2. Preserve OpsAi visual identity, React Flow canvas, expression syntax (`{{input}}`, `{{steps.<nodeId>.field}}`, `{{items.field}}`), and existing APIs/DB unless a scoped migration is required.
3. Node semantics: `docs/workflow-node-contracts.md` + `frontend/src/modules/workflows/nodeContract.ts`.
4. Tests: **`docs/OPSAI_TEST_MATRIX.md`** (Level 1/2/3). After frontend TS/UI: `cd frontend && npx tsc --noEmit`. Full `test:workflows` is Level 3.
5. Changes must be **incremental** and **regression-tested** — extend existing components; do not redesign the product to resemble n8n.
<!-- END:workflow-builder-rules -->

<!-- BEGIN:database-migration-rules -->
# Database schema (local → live)

Any new table, column, index, or ENUM change **must** be added as the next file under `backend/migrations/` and applied with `cd backend && npm run db:migrate`. Do not edit already-applied migrations. Do not change live MySQL only in a GUI. After deploy, live must run migrate (see `docs/database-migrations.md`, root `deploy.sh`, backend `prestart`).
<!-- END:database-migration-rules -->
