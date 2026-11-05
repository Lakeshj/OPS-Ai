# OpsAi test matrix (scheduling, not reduction)

Do **not** delete tests. Do **not** skip security, migrations, typecheck, or relevant regressions. Do **not** run the full workflow suite after every tiny edit.

Level 3 = `cd backend && npm run test:workflows` (registers GSC/GA4/Ads/Meta/Gmail/engine smokes). Frontend typecheck: `cd frontend && npx tsc --noEmit`. Inspector: `cd frontend && npx tsx scripts/smoke-inspector-view.ts`.

## LEVEL 1 — Targeted (during implementation)

Changed layer only.

| Area | Command |
|------|---------|
| One backend smoke | `cd backend && node scripts/smoke-workflow-<name>.js` |
| GSC MCP plugin | `cd plugins/gsc-mcp && npm test` (or `cd backend && npm run test:gsc-mcp`) |
| GA4 MCP plugin | `cd backend && npm run test:ga4-mcp` |
| Google Ads MCP plugin | `cd plugins/google-ads-mcp && npm test` |
| Meta Ads MCP plugin | `cd plugins/meta-ads-mcp && npm test` |
| Inspector / Table sort | `cd frontend && npx tsx scripts/smoke-inspector-view.ts` |
| Frontend types (UI/TS change) | `cd frontend && npx tsc --noEmit` |
| Schema | add migration; `cd backend && npm run db:migrate` |

## LEVEL 2 — Feature regression (after the fix)

Run the **affected family**, not everything.

| Change | Also run |
|--------|----------|
| GSC native / sort | `smoke-workflow-gsc-sort.js`, 14D.5 GSC parts in engine or `smoke-workflow-14d5.js` if it self-runs; `npm run test:gsc-mcp` |
| GSC MCP | `test:gsc-mcp` + GSC-SORT if analytics order |
| GA4 native/MCP | `test:ga4-mcp`; `smoke-workflow-ga4-ai-grounding.js` if grounding |
| Google Ads | `smoke-workflow-google-ads-v1.js`, `smoke-workflow-google-ads-mcp.js`, `plugins/google-ads-mcp` smoke |
| Meta Ads | `smoke-workflow-meta-ads-m2.js` … `m6.js`; `plugins/meta-ads-mcp` smoke |
| Inspector display | inspector smoke + `tsc --noEmit` |
| Expressions / items / `$first` | engine file that owns the smoke; do not skip if item order changed |
| AI Agent | `node scripts/smoke-workflow-ai-12b.js` (includes 12B-7/8/28 + AGENT-CONTEXT-*) |
| Workflow engine core | targeted `smoke-workflow-engine.js` **only if** you changed scheduler/occurrences/edges — else Level 3 at milestone |

If Copilot, connections, Wait, Loop, or credentials changed, include that family’s smoke.

## LEVEL 3 — Milestone (explicit request, Git checkpoint, or deploy)

1. `cd frontend && npx tsc --noEmit`
2. `cd backend && npm run test:workflows`
3. Provider extras not fully inside the engine file: `test:gsc-mcp`, `test:ga4-mcp`, plugin `npm test` as needed
4. Report **exact failing IDs**. Do not hide new failures under 12B-7/8/28.

Known parked (unrelated unless you touched Agent prompts): `TEST 12B-7`, `TEST 12B-8`, `TEST 12B-28`.
