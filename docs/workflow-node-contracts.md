# Workflow Node Contracts

> **Governance:** See [`workflow-builder-rules.md`](./workflow-builder-rules.md) — implement contracts in OpsAi architecture; do not clone external UIs.

Machine-readable spec: `frontend/src/modules/workflows/nodeContract.ts`  
Backend mirror: `backend/config/nodeContract.js`

## Cross-cutting engine invariants

1. **Ports from registry** — `inputs.length > 0` → show INPUT panel; merge has 2 main inputs; condition has true/false outputs; result has no outputs.
2. **pairedItem policies** — `identity1to1` | `fanOut` | `identityBySurvival` | `fanIn` | `multiPort` | `routing` | `manual` | `none`
3. **Dirty graph** — param/edge/pin/disabled/typedPort change → node + all downstream descendants; pins cut propagation in manual runs.
4. **Expression errors** — broken thread / ambiguous thread (see `EXPRESSION_ERRORS` in nodeContract.ts).

## Build order (dependency-aware)

| Phase | Work | Status |
|-------|------|--------|
| 1 | `nodeContract.ts` — ports, cardinality, pairedItem, params schema | **Done** |
| 2 | Registry drives inspector layout (`hasInputPanel`, settings matrix) | **Partial** — triggers fixed |
| 3 | Generic param renderer from `params[]` + `displayOptions` | **Not started** |
| 4 | `pairedItem` auto-linking in engine | **Not started** |
| 5 | Dirty invalidation graph in editor session | **Not started** |
| 6 | Schedule anchor-date scheduling (N>1 weeks/months/days) | **Not started** |
| 7 | Expression autocomplete + thread-walk resolver | **Not started** |
| 8 | Merge multi-input tabs + combine modes | **Not started** |
| 9 | Auto-layout (dagre/elkjs) + fitView | **Not started** |

## Per-node quick reference

| Node | Inputs | Outputs | Cardinality | pairedItem |
|------|--------|---------|-------------|------------|
| trigger | 0 | main | 0→1 | none |
| schedule | 0 | main | 0→1 | none |
| webhook | 0 | main | 0→1 | none |
| set | main | main | N→N | identity1to1 |
| splitOut | main | main | 1→N | fanOut |
| filter | main | main | N→≤N | identityBySurvival |
| limit | main | main | N→≤N | identityBySurvival |
| sort | main | main | N→N reorder | identityBySurvival |
| removeDuplicates | main | main | N→≤N | identityBySurvival (+ stateful) |
| aggregate | main | main | N→1 | fanIn |
| merge | main×2 | main | barrier | multiPort |
| code | main | main+error | arbitrary | manual |
| condition | main | true+false | N split | routing |
| document | main | main | N→N | identity1to1 |
| spreadsheet | main | main | read 1→N / write N→1 | fanOut/fanIn by op |
| email | main | main | N→N | identity1to1 |
| http | main | main+error | N→N | identity1to1 (+ pagination fanOut) |
| result | main | 0 | N→0 | none |
| noop | main | main | N→N | identity1to1 |
| integration | main | main | N→N | identity1to1 |
| ai | main | main+error | N→N | identity1to1 |
| bot | main + AI ports | main+error | N→N | identity1to1 |

Full param schemas, edge cases, and settings matrices are in `nodeContract.ts`.
