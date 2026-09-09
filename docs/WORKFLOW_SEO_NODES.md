# Workflow SEO / reporting nodes (OpsAi)

Part 14D.5 native capabilities used by SEO and marketing automations. n8n import mappings are **not** upgraded here (Part 14D.6).

## Nodes

| Engine type | Library id | Role |
| --- | --- | --- |
| `googleSearchConsole` | `google-search-console` | GSC Search Analytics |
| `googleAnalytics` | `google-analytics` | GA4 reports |
| `gmail` / `gmailTrigger` | `gmail` / `gmail-trigger` | Mail send/read + polling trigger |
| `googleSheets` | `google-sheets` | Tabular read/write |
| `xlsxBuilder` | `xlsx-builder` | Multi-sheet XLSX binary |
| `aiGenerate` | `ai-generate` | One LLM call per item |

Do not duplicate Schedule, HTTP, Set, Merge, Filter, Code, AI Agent, or Chat Model.

## AI Generate vs AI Agent vs Chat Model

- **AI Generate** — main-flow execution node. One model request per incoming item. No tools, memory, or agent loop. Output `{ text }`.
- **AI Agent** — iterative tool-using agent; requires auxiliary Chat Model.
- **Chat Model** — auxiliary resource only (not a main-flow step).

## XLSX Builder

In-memory ExcelJS workbook. Limits: 20 sheets, 10k rows/sheet, 200k cells, 8 MB, 8k chars/cell. Output:

```
json: { fileName, sheetCount, rowCounts, size }
binary.data: { fileName, mimeType, data (base64), size }
```

MIME: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

Connect **XLSX Builder → Gmail** with `binaryProperty: data`. No Code conversion node.

## Side effects

| Node | Class |
| --- | --- |
| GSC / GA4 / Sheets read | READ (external) |
| Sheets append/update/clear | WRITE_EXTERNAL |
| Gmail send/reply/delete/labels | WRITE_EXTERNAL |
| Gmail Trigger | STATEFUL / TRIGGER (poll) |
| AI Generate | EXTERNAL / COST |
| XLSX Builder | PURE |

Manual Run Step performs the real call (Google / model). Confirm credentials on test accounts.

## Page performance compare

The reviewed SEO workflow’s 17-column `compare_page_performance` Code is **not** a 14D.5 native node. Recommendation: reusable **subworkflow/template** (or later generic compare/aggregate), not a one-client report node. Defer to 14D.6 / SEO templates.

## Copilot

Available nodes can be planned (Schedule → GSC/GA4 → XLSX → Gmail). Missing credential, site URL, property ID, and recipient stay **unresolved** — never invented.

## Limits

GSC row cap 5k (return-all 10k). GA4 rows 10k. Gmail list 100. Sheets read 10k rows. Gmail attachments 10 MB from binary only.
