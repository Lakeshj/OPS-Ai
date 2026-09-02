<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:workflow-builder-rules -->
# Workflow builder (OpsAi)

When editing anything under `frontend/src/components/workflows/`, `frontend/src/modules/workflows/`, or `backend/**/workflow*`:

1. Read **`docs/workflow-builder-rules.md`** — non-negotiable. n8n is **behavior reference only**; never clone n8n UI/CSS/copy.
2. Preserve OpsAi visual identity, React Flow canvas, expression syntax (`{{input}}`, `{{steps.<nodeId>.field}}`, `{{items.field}}`), and existing APIs/DB unless a scoped migration is required.
3. Node semantics: `docs/workflow-node-contracts.md` + `frontend/src/modules/workflows/nodeContract.ts`.
4. After backend engine changes: `cd backend && npm run test:workflows`. After frontend: `cd frontend && npx tsc --noEmit`.
5. Changes must be **incremental** and **regression-tested** — extend existing components; do not redesign the product to resemble n8n.
<!-- END:workflow-builder-rules -->
