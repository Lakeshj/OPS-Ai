# Workflow Builder — Behavioral Reference

> **Governance:** All workflow work must follow [`workflow-builder-rules.md`](./workflow-builder-rules.md). n8n and similar tools are behavioral references only — not UI templates.

Vendor-neutral functional spec derived from industry workflow automation patterns (editor interactions, execution model, inspector architecture). OpsAi uses `{{steps.<nodeId>.<path>}}` expressions and modal-based inspectors.

## Glossary

| Term | Definition |
|------|------------|
| **Item** | Unit of data between nodes: `{ json, binary?, pairedItem? }` inside `Item[]` |
| **Execution** | One workflow run (manual, partial, or production trigger) |
| **Trigger** | Start node (manual, schedule, webhook) |
| **Credential** | Encrypted secret referenced by ID, never stored in workflow JSON |
| **Dirty node** | Cached output stale after param/upstream/pin change |
| **Pin** | Editor-only frozen output; ignored in production |

## Editor semantics

- **Execute step**: Run one node; reuse pinned/cached upstream if valid; else run upstream chain first
- **Disable node**: Passthrough — forward input to output 0; no API calls
- **Insert on edge**: A→C becomes A→B→C; downstream default input becomes B's output
- **Rename**: May break expression references — use stable node IDs in expressions

## Settings (runtime)

| Setting | Default | Behavior |
|---------|---------|----------|
| `alwaysOutputData` | false | Emit `[{ json: {} }]` when output would be empty |
| `executeOnce` | false | Process only first input item |
| `onError` | stop | stop / continue / route (error output) |
| `retries` + `retryDelayMs` | 0 / 1000 | Fixed-delay retry on failure |
| `timeoutMs` | — | Per-node execution ceiling |
| `disabled` | false | Skip operation; passthrough input |

## Phased roadmap (OpsAi)

- **Phase 1**: Canvas toolbar, context menu, edges, clipboard, undo/redo, disable
- **Phase 2**: 3-panel inspector, partial execution, data viewers, expression preview
- **Phase 3**: Multi-rule schedule UI + production scheduler daemon
- **Phase 4**: Sub-workflows, pairedItem, cluster AI nodes, error workflow
