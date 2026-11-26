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
| Instagram MCP plugin | `cd plugins/instagram-mcp && npm test` |
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
| Meta Ads | `smoke-workflow-meta-ads-m2.js` … `m6.js`; M8.18 Native: `node scripts/smoke-workflow-meta-ads-m818.js`; M8.18.1 presentation: `cd frontend && npx tsx scripts/smoke-meta-ads-m8181.ts`; M8.18.2 data-path: `node scripts/smoke-workflow-meta-ads-m8182.js` (+ optional live `node scripts/diagnose-meta-ads-m8182.js`); `plugins/meta-ads-mcp` smoke |
| Instagram | M2: `node scripts/smoke-workflow-instagram-m2.js`; M2.1: `node scripts/smoke-workflow-instagram-m21.js`; M3: `node scripts/smoke-workflow-instagram-m3.js`; M4: `node scripts/smoke-workflow-instagram-m4.js`; M5: `node scripts/smoke-workflow-instagram-m5.js`; M6: `node scripts/smoke-workflow-instagram-m6.js`; M7: `node scripts/smoke-workflow-instagram-m7.js` + `plugins/instagram-mcp` smoke; M7.1 UX: `node scripts/smoke-workflow-instagram-m71.js` |
| Inspector display | inspector smoke + `tsc --noEmit` |
| Expressions / items / `$first` | engine file that owns the smoke; do not skip if item order changed |
| AI Agent | `node scripts/smoke-workflow-ai-12b.js`; M8.15 reliability: `node scripts/smoke-workflow-ai-m815.js`; M8.15.1 usage logging: `node scripts/smoke-workflow-ai-m8151.js`; M8.15.2 grounding: `node scripts/smoke-workflow-ai-m8152.js`; M8.15.3 Run Step graph tools: `node scripts/smoke-workflow-ai-m8153.js`; dataset Ads: `node scripts/smoke-workflow-ai-dataset-ads.js`; AI scope: `node scripts/smoke-workflow-ai-scope.js`; live AI scope: `node scripts/smoke-workflow-ai-live-scope.js` |
| Workflow Copilot context | M8.16 bridge: `node scripts/smoke-workflow-copilot-m816.js`; M8.16.1 local mock MCP + Copilot: `node scripts/smoke-workflow-ai-m8161.js`, `node scripts/smoke-workflow-copilot-m8161.js`; M8.16.2 Instagram MCP structural (no Meta): `node scripts/smoke-workflow-instagram-m8162.js` (+ affected 14B/14D smokes if plan path changed) |
| Instagram / Meta Ads isolation | M8.17: `node scripts/smoke-workflow-isolation-m817.js` (do not touch GSC/GA4/AI/Copilot implementations) |
| Facebook Page Native | M9.1: `node scripts/smoke-workflow-facebook-page-m91.js`; M9.1.1: `node scripts/smoke-workflow-facebook-page-m911.js` |
| LinkedIn Lead Discovery Native | M10.1: `node scripts/smoke-workflow-linkedin-lead-m101.js`; M10.2: `node scripts/smoke-workflow-linkedin-lead-m102.js`; M10.3 Apify: `node scripts/smoke-workflow-linkedin-lead-m103.js`; M10.3.1 credential/native UI: `node scripts/smoke-workflow-linkedin-lead-m1031.js`; M10.3.3 feed DNS: `node scripts/smoke-workflow-linkedin-lead-m1033.js`; M10.3.4 Perigon: `node scripts/smoke-workflow-linkedin-lead-m1034.js`; M10.3.5 credential ENUM/HTTP: `node scripts/smoke-workflow-linkedin-lead-m1035.js`; M10.3.6 session isolation: `node scripts/smoke-workflow-linkedin-lead-m1036.js`; M10.3.7 credential delete/duplicate: `node scripts/smoke-workflow-linkedin-lead-m1037.js` |
| Workflow engine core | targeted `smoke-workflow-engine.js` **only if** you changed scheduler/occurrences/edges — else Level 3 at milestone |

If Copilot, connections, Wait, Loop, or credentials changed, include that family’s smoke.

## LEVEL 3 — Milestone (explicit request, Git checkpoint, or deploy)

1. `cd frontend && npx tsc --noEmit`
2. `cd backend && npm run test:workflows`
3. Provider extras not fully inside the engine file: `test:gsc-mcp`, `test:ga4-mcp`, plugin `npm test` as needed
4. Report **exact failing IDs**. Do not hide new failures under 12B-7/8/28.

Known parked (unrelated unless you touched Agent prompts): `TEST 12B-7`, `TEST 12B-8`, `TEST 12B-28`.
