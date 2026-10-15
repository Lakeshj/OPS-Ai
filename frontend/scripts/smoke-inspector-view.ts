/**
 * Inspector UX — structured table/schema/json + 50/50 input layout.
 * Run: npx --yes tsx scripts/smoke-inspector-view.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSPECTOR_CELL_MAX,
  INSPECTOR_ITEM_SPLIT_CLASS,
  INSPECTOR_PANE_SCROLL_CLASS,
  applyTableSort,
  buildDisplayTable,
  cloneValue,
  cycleTableSort,
  formatCompactCell,
  inferItemSchema,
  inferSchemaKind,
  inspectItems,
  parseResultPayloadForDisplay,
  prettyJson,
  tableSortDatasetKey,
  toCanonicalItems,
} from "../src/modules/workflows/inspectorViewModel";
import {
  EMPTY_TABLE_SORT,
  ariaSortValue,
  isTableSortMissing,
  nextTableSortForDataset,
} from "../src/modules/workflows/inspectorTableSort";
import { resolveLatestNodeResult } from "../src/modules/workflows/occurrenceView";
import type { WorkflowItem } from "../src/modules/workflows/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const read = (rel: string) =>
  fs.readFileSync(path.join(frontendRoot, rel), "utf8");

let passed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const gscRows = [
  {
    ctr: 0.16666666666666666,
    query: "evincera",
    clicks: 2,
    position: 1.9166666666666663,
    impressions: 12,
  },
  {
    ctr: 0.11111111111111111,
    query: "site:evincera.com",
    clicks: 1,
    position: 12.11111111111111,
    impressions: 9,
  },
];

const gmailJson = {
  id: "1a11132abc",
  labelIds: ["UNREAD", "SENT", "INBOX"],
};

const metaActions = {
  actions: [
    { action_type: "link_click", value: 10 },
    { action_type: "purchase", value: 2 },
  ],
};

async function main() {
  console.log("\nInspector view model + layout");

  await check("INSPECTOR-1 multiple WorkflowItems -> multiple rows", () => {
    const items: WorkflowItem[] = gscRows.map((json) => ({ json }));
    const table = buildDisplayTable(items);
    assert.equal(table.rows.length, 2);
    assert.equal(table.unwrappedResult, false);
  });

  await check("INSPECTOR-2 flat object -> columns", () => {
    const table = buildDisplayTable([{ json: gscRows[0] }]);
    for (const col of ["query", "clicks", "impressions", "ctr", "position"]) {
      assert.ok(table.columns.includes(col), `missing ${col}`);
    }
    assert.equal(table.rows[0].query, "evincera");
    assert.equal(table.rows[0].clicks, 2);
  });

  await check("INSPECTOR-3 array<string> compact display", () => {
    const cell = formatCompactCell(["UNREAD", "SENT", "INBOX"]);
    assert.equal(cell.kind, "array<string>");
    assert.equal(cell.text, "UNREAD · SENT · INBOX");
    assert.ok(!cell.text.includes("["));
  });

  await check("INSPECTOR-4 array<object> compact display", () => {
    const cell = formatCompactCell(metaActions.actions);
    assert.equal(cell.kind, "array<object>");
    assert.equal(cell.text, "2 objects");
    assert.ok(!cell.text.includes("[object Object]"));
  });

  await check("INSPECTOR-5 nested object readable preview", () => {
    const cell = formatCompactCell({ id: "123", name: "Brand" });
    assert.equal(cell.kind, "object");
    assert.match(cell.text, /id/);
    assert.match(cell.text, /Brand/);
    assert.ok(!cell.text.includes("\n"));
  });

  await check("INSPECTOR-6 long cell bounded", () => {
    const long = "q".repeat(800);
    const cell = formatCompactCell(long, { maxLen: 120 });
    assert.equal(cell.truncated, true);
    assert.ok(cell.text.length <= 121);
    assert.ok(INSPECTOR_CELL_MAX >= 120);
  });

  await check("INSPECTOR-7 structured Result array renders rows", () => {
    const table = buildDisplayTable([{ json: { result: gscRows } }]);
    assert.equal(table.unwrappedResult, true);
    assert.equal(table.rows.length, 2);
    assert.ok(table.columns.includes("query"));
    assert.ok(!table.columns.includes("result"));
    assert.equal(table.rows[0].query, "evincera");
    assert.equal(table.rows[1].query, "site:evincera.com");
  });

  await check("INSPECTOR-8 Result primitive string remains string", () => {
    const items: WorkflowItem[] = [{ json: { result: "hello world" } }];
    const table = buildDisplayTable(items);
    assert.equal(table.unwrappedResult, false);
    assert.equal(table.rows[0].result, "hello world");
    const parsed = parseResultPayloadForDisplay("hello world");
    assert.equal(parsed.parsed, false);
    assert.equal(parsed.value, "hello world");
  });

  await check("INSPECTOR-9 JSON preserves canonical data", () => {
    const items: WorkflowItem[] = [{ json: { result: gscRows } }];
    const view = inspectItems(items);
    assert.deepEqual(view.jsonValue, { result: gscRows });
    assert.match(view.json, /"result"/);
    assert.ok(!view.json.includes('\\"query\\"'));
    const asString = prettyJson({ result: JSON.stringify(gscRows) });
    assert.ok(asString.includes("\\"));
  });

  await check("INSPECTOR-10 Schema array<string>", () => {
    assert.equal(inferSchemaKind(["UNREAD", "SENT", "INBOX"]), "array<string>");
    assert.equal(inferItemSchema(gmailJson).labelIds, "array<string>");
  });

  await check("INSPECTOR-11 Schema array<object>", () => {
    assert.equal(inferSchemaKind(metaActions.actions), "array<object>");
    assert.equal(inferItemSchema(metaActions).actions, "array<object>");
  });

  await check("INSPECTOR-12 Gmail labelIds", () => {
    const items: WorkflowItem[] = [{ json: gmailJson }];
    const view = inspectItems(items);
    assert.equal(view.table.rows.length, 1);
    assert.equal(formatCompactCell(view.table.rows[0].labelIds).text, "UNREAD · SENT · INBOX");
    assert.deepEqual((view.jsonValue as { labelIds: unknown }).labelIds, [
      "UNREAD",
      "SENT",
      "INBOX",
    ]);
    assert.equal(view.schema.labelIds, "array<string>");
  });

  await check("INSPECTOR-13 GSC multi-row output", () => {
    const items: WorkflowItem[] = gscRows.map((json) => ({ json }));
    const view = inspectItems(items);
    assert.equal(view.table.rows.length, 2);
    assert.ok(view.table.columns.includes("query"));
    assert.ok(view.table.columns.includes("clicks"));
    assert.ok(Array.isArray(view.jsonValue));
  });

  await check("INSPECTOR-14 Google Ads nested object", () => {
    const json = {
      campaign: { id: "123", name: "Brand" },
      impressions: 40,
      clicks: 3,
    };
    const view = inspectItems([{ json }]);
    assert.equal(view.table.rows.length, 1);
    const preview = formatCompactCell(view.table.rows[0].campaign);
    assert.match(preview.text, /123/);
    assert.match(preview.text, /Brand/);
    assert.equal(view.schema.campaign, "object");
    assert.deepEqual((view.jsonValue as { campaign: unknown }).campaign, json.campaign);
  });

  await check("INSPECTOR-15 Meta-style actions fixture", () => {
    const view = inspectItems([{ json: metaActions }]);
    assert.equal(formatCompactCell(view.table.rows[0].actions).text, "2 objects");
    assert.equal(view.schema.actions, "array<object>");
    assert.equal(
      JSON.stringify((view.jsonValue as { actions: unknown }).actions),
      JSON.stringify(metaActions.actions)
    );
  });

  await check("INSPECTOR-16 pin/unpin preserves data shape", () => {
    const items: WorkflowItem[] = [{ json: gmailJson }];
    const output = { result: gscRows };
    const pinnedItems = cloneValue(items);
    const pinnedOutput = cloneValue(output);
    assert.deepEqual(pinnedItems, items);
    assert.deepEqual(pinnedOutput, output);
    const canvas = read("src/components/workflows/WorkflowCanvas.tsx");
    assert.match(canvas, /pinnedItems:\s*Array\.isArray\(sessionResult\?\.items\)/);
    assert.doesNotMatch(
      canvas,
      /pinnedItems:[\s\S]{0,80}JSON\.stringify\(sessionResult/
    );
  });

  await check("INSPECTOR-17 failed occurrence stays failed", () => {
    const failed = resolveLatestNodeResult({
      nodeId: "n1",
      sessionResult: {
        nodeId: "n1",
        status: "failed",
        error: "Ads permission denied",
        output: { ok: false, error: "Ads permission denied", items: [] },
        items: [],
        updatedAt: "2026-10-14T12:00:00.000Z",
      },
      dirty: true,
      dirtyReason: "execution_failed",
    });
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error, "Ads permission denied");
    const panel = read("src/components/workflows/NodeOutputPanel.tsx");
    assert.match(panel, /effectiveResult\?\.status === "failed"/);
    assert.match(panel, /nodeFailureDisplay/);
  });

  await check("INSPECTOR-18 stale output behavior unchanged", () => {
    const stale = resolveLatestNodeResult({
      nodeId: "n1",
      sessionResult: {
        nodeId: "n1",
        status: "succeeded",
        output: { result: "old" },
        items: [{ json: { result: "old" } }],
        updatedAt: "2026-10-14T12:00:00.000Z",
      },
      dirty: true,
      dirtyReason: "config",
    });
    assert.equal(stale?.status, "succeeded");
    assert.equal(stale?.cacheState, "dirty");
    assert.deepEqual(stale?.items, []);
    assert.equal((stale?.output as { stale?: boolean }).stale, true);
  });

  await check("INSPECTOR-19 binary metadata unchanged", () => {
    const binary = { file: { mimeType: "text/plain", fileName: "a.txt" } };
    const items = toCanonicalItems([
      { json: { id: "1" }, binary },
    ]);
    assert.deepEqual(items[0].binary, binary);
    const view = inspectItems(items);
    assert.equal((view.jsonValue as { id: string }).id, "1");
    assert.deepEqual(items[0].binary, binary);
  });

  await check("INSPECTOR-20 presentation normalization is non-mutating", () => {
    const original: WorkflowItem[] = [
      { json: { result: gscRows, labelIds: ["UNREAD"] } },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    inspectItems(original);
    buildDisplayTable(original);
    formatCompactCell(original[0].json.result);
    cloneValue(original)[0].json.result = "mutated";
    assert.deepEqual(original, snapshot);
  });

  await check("INSPECTOR extra: Result JSON string unwrap is display-only", () => {
    const stored = JSON.stringify(gscRows);
    const items: WorkflowItem[] = [{ json: { result: stored } }];
    const table = buildDisplayTable(items);
    assert.equal(table.unwrappedResult, true);
    assert.equal(table.rows[0].query, "evincera");
    const json = inspectItems(items).jsonValue as { result: unknown };
    assert.equal(json.result, stored);
    const arbitrary = parseResultPayloadForDisplay("not-json");
    assert.equal(arbitrary.parsed, false);
  });

  const viewer = read("src/components/workflows/ItemDataViewer.tsx");
  const inputPanel = read("src/components/workflows/NodeInputPanel.tsx");
  const dialog = read("src/components/workflows/WorkflowNodeDialog.tsx");
  const viewModel = read("src/modules/workflows/inspectorViewModel.ts");

  await check("LAYOUT-1 input pane has two vertical regions", () => {
    assert.match(viewer, /data-inspector-region="item-selector"/);
    assert.match(viewer, /data-inspector-region="item-data"/);
    assert.ok(INSPECTOR_ITEM_SPLIT_CLASS.includes("grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"));
    assert.match(viewer, /INSPECTOR_ITEM_SPLIT_CLASS/);
  });

  await check("LAYOUT-2 item selector cannot exceed its region", () => {
    assert.match(viewer, /INSPECTOR_PANE_SCROLL_CLASS/);
    assert.match(viewModel, /min-h-0 overflow-y-auto/);
    assert.match(viewModel, /minmax\(0, ?1fr\)/);
    assert.doesNotMatch(viewer, /50vh/);
    assert.doesNotMatch(inputPanel, /50vh/);
  });

  await check("LAYOUT-3 item selector has independent vertical scroll", () => {
    assert.equal(INSPECTOR_PANE_SCROLL_CLASS, "min-h-0 overflow-y-auto");
    const selectorBlock = viewer.split('data-inspector-region="item-selector"')[1];
    assert.ok(selectorBlock);
    assert.match(selectorBlock.slice(0, 400), /INSPECTOR_PANE_SCROLL_CLASS/);
  });

  await check("LAYOUT-4 data viewer has independent vertical scroll", () => {
    const dataBlock = viewer.split('data-inspector-region="item-data"')[1];
    assert.ok(dataBlock);
    assert.match(dataBlock.slice(0, 400), /INSPECTOR_PANE_SCROLL_CLASS/);
  });

  await check("LAYOUT-5 141-item fixture keeps data viewer visible", () => {
    const items: WorkflowItem[] = Array.from({ length: 141 }, (_, i) => ({
      json: { n: i },
    }));
    const selected = buildDisplayTable([items[140]]);
    assert.equal(selected.rows.length, 1);
    assert.equal(selected.rows[0].n, 140);
    assert.match(viewer, /min-h-\[10rem\]/);
    assert.match(inputPanel, /h-full min-h-0 flex-col/);
    assert.match(dialog, /overflow-hidden border-r p-4/);
  });

  await check("LAYOUT-6 selecting item updates bottom pane only", () => {
    assert.doesNotMatch(viewer, /scrollIntoView/);
    assert.match(viewer, /onSelectedItemIndexChange\?\.\(i\)/);
    assert.match(viewer, /splitItems \? \[canonical\[selectedIndex\]\] : canonical/);
  });

  await check("LAYOUT-7 small viewport retains both sections", () => {
    assert.match(viewer, /min-h-\[6rem\]/);
    assert.match(viewer, /min-h-\[10rem\]/);
    assert.ok(INSPECTOR_ITEM_SPLIT_CLASS.includes("minmax(0,1fr)"));
  });

  await check("LAYOUT-8 no horizontal layout regression", () => {
    assert.match(dialog, /ResizablePanelGroup direction="horizontal"/);
    assert.match(dialog, /showInputPanel/);
    assert.doesNotMatch(dialog, /50vh/);
  });

  await check("GSC-SORT-22 frontend default Table preserves canonical WorkflowItem order", () => {
    const items: WorkflowItem[] = [
      { json: { query: "aerospace seo consultants", ctr: 0, impressions: 1 } },
      { json: { query: "ai google penalty recovery agent", ctr: 0, impressions: 30 } },
    ];
    const table = buildDisplayTable(items);
    assert.equal(table.rows[0].query, "aerospace seo consultants");
    assert.equal(table.rows[1].query, "ai google penalty recovery agent");
  });

  await check("GSC-SORT-23 JSON view preserves same row/item order", () => {
    const items: WorkflowItem[] = [
      { json: { query: "aerospace seo consultants", ctr: 0, impressions: 1 } },
      { json: { query: "ai google penalty recovery agent", ctr: 0, impressions: 30 } },
    ];
    const view = inspectItems(items);
    const jsonRows = view.jsonValue as Array<{ query: string }>;
    assert.equal(Array.isArray(jsonRows), true);
    assert.equal(jsonRows[0].query, "aerospace seo consultants");
    assert.equal(jsonRows[1].query, "ai google penalty recovery agent");
    assert.match(view.json, /aerospace seo consultants[\s\S]*ai google penalty recovery agent/);
  });

  const gscCanonicalItems: WorkflowItem[] = [
    { json: { query: "A", ctr: 0.5, impressions: 5, clicks: 1, position: 20 } },
    { json: { query: "B", ctr: 0.4, impressions: 10000, clicks: 500, position: 1 } },
  ];
  const gscCanonicalTable = buildDisplayTable(gscCanonicalItems);
  const queries = (table: { rows: Array<Record<string, unknown>> }) =>
    table.rows.map((row) => row.query);
  const viewerSrc = read("src/components/workflows/ItemDataViewer.tsx");
  const inputSrc = read("src/components/workflows/NodeInputPanel.tsx");
  const outputSrc = read("src/components/workflows/NodeOutputPanel.tsx");
  const occSrc = read("src/modules/workflows/occurrenceView.ts");
  const gscSortSrc = read("../backend/services/gscPerformanceSort.js");

  await check("TABLE-SORT-1 Default state preserves canonical source order", () => {
    const sorted = applyTableSort(gscCanonicalTable, EMPTY_TABLE_SORT);
    assert.deepEqual(queries(sorted), ["A", "B"]);
    assert.equal(sorted.rows, gscCanonicalTable.rows);
  });

  await check("TABLE-SORT-2 First header click = DESC", () => {
    const next = cycleTableSort(EMPTY_TABLE_SORT, "impressions");
    assert.equal(next.columnKey, "impressions");
    assert.equal(next.direction, "desc");
  });

  await check("TABLE-SORT-3 Second click = ASC", () => {
    const next = cycleTableSort({ columnKey: "impressions", direction: "desc" }, "impressions");
    assert.equal(next.direction, "asc");
  });

  await check("TABLE-SORT-4 Third click clears sorting", () => {
    const next = cycleTableSort({ columnKey: "impressions", direction: "asc" }, "impressions");
    assert.equal(next.columnKey, null);
    assert.equal(next.direction, null);
  });

  await check("TABLE-SORT-5 Clear returns EXACT original canonical order", () => {
    const desc = applyTableSort(gscCanonicalTable, {
      columnKey: "impressions",
      direction: "desc",
    });
    assert.deepEqual(queries(desc), ["B", "A"]);
    const none = cycleTableSort({ columnKey: "impressions", direction: "asc" }, "impressions");
    assert.deepEqual(queries(applyTableSort(gscCanonicalTable, none)), ["A", "B"]);
    assert.deepEqual(queries(applyTableSort(gscCanonicalTable, EMPTY_TABLE_SORT)), ["A", "B"]);
  });

  await check("TABLE-SORT-6 Switching to another column clears previous active column", () => {
    const next = cycleTableSort({ columnKey: "impressions", direction: "desc" }, "query");
    assert.equal(next.columnKey, "query");
    assert.equal(next.direction, "desc");
  });

  await check("TABLE-SORT-7 Numeric DESC works", () => {
    const table = buildDisplayTable([
      { json: { n: 2 } },
      { json: { n: 10 } },
      { json: { n: 100 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "n", direction: "desc" });
    assert.deepEqual(sorted.rows.map((row) => row.n), [100, 10, 2]);
  });

  await check("TABLE-SORT-8 Numeric ASC works", () => {
    const table = buildDisplayTable([
      { json: { n: 100 } },
      { json: { n: 2 } },
      { json: { n: 10 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "n", direction: "asc" });
    assert.deepEqual(sorted.rows.map((row) => row.n), [2, 10, 100]);
  });

  await check("TABLE-SORT-9 Numeric-looking metric strings sort numerically", () => {
    const table = buildDisplayTable([
      { json: { impressions: "2" } },
      { json: { impressions: "100" } },
      { json: { impressions: "10" } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "impressions", direction: "desc" });
    assert.deepEqual(sorted.rows.map((row) => row.impressions), ["100", "10", "2"]);
  });

  await check("TABLE-SORT-10 Text DESC = Z–A", () => {
    const table = buildDisplayTable([
      { json: { name: "Apple" } },
      { json: { name: "banana" } },
      { json: { name: "Campaign" } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "name", direction: "desc" });
    assert.deepEqual(sorted.rows.map((row) => row.name), ["Campaign", "banana", "Apple"]);
  });

  await check("TABLE-SORT-11 Text ASC = A–Z", () => {
    const table = buildDisplayTable([
      { json: { name: "Campaign" } },
      { json: { name: "Apple" } },
      { json: { name: "banana" } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "name", direction: "asc" });
    assert.deepEqual(sorted.rows.map((row) => row.name), ["Apple", "banana", "Campaign"]);
  });

  await check("TABLE-SORT-12 Boolean sorting deterministic", () => {
    const table = buildDisplayTable([
      { json: { ok: false } },
      { json: { ok: true } },
      { json: { ok: false } },
    ]);
    const desc = applyTableSort(table, { columnKey: "ok", direction: "desc" });
    assert.deepEqual(desc.rows.map((row) => row.ok), [true, false, false]);
    const asc = applyTableSort(table, { columnKey: "ok", direction: "asc" });
    assert.deepEqual(asc.rows.map((row) => row.ok), [false, false, true]);
  });

  await check("TABLE-SORT-13 ISO date sorting chronological", () => {
    const table = buildDisplayTable([
      { json: { date: "2026-10-01" } },
      { json: { date: "2026-10-15T08:30:00Z" } },
      { json: { date: "2026-10-03" } },
    ]);
    const desc = applyTableSort(table, { columnKey: "date", direction: "desc" });
    assert.equal(desc.rows[0].date, "2026-10-15T08:30:00Z");
    const asc = applyTableSort(table, { columnKey: "date", direction: "asc" });
    assert.equal(asc.rows[0].date, "2026-10-01");
  });

  await check("TABLE-SORT-14 Missing values stay last in DESC", () => {
    const table = buildDisplayTable([
      { json: { n: null } },
      { json: { n: 10 } },
      { json: { n: undefined } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "n", direction: "desc" });
    assert.equal(sorted.rows[0].n, 10);
    assert.equal(isTableSortMissing(sorted.rows[1].n), true);
    assert.equal(isTableSortMissing(sorted.rows[2].n), true);
  });

  await check("TABLE-SORT-15 Missing values stay last in ASC", () => {
    const table = buildDisplayTable([
      { json: { n: null } },
      { json: { n: 10 } },
      { json: { n: 2 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "n", direction: "asc" });
    assert.deepEqual(sorted.rows.map((row) => row.n), [2, 10, null]);
  });

  await check("TABLE-SORT-16 0 is not treated as missing", () => {
    const table = buildDisplayTable([
      { json: { n: null } },
      { json: { n: 0 } },
      { json: { n: 5 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "n", direction: "asc" });
    assert.deepEqual(sorted.rows.map((row) => row.n), [0, 5, null]);
  });

  await check("TABLE-SORT-17 false is not treated as missing", () => {
    const table = buildDisplayTable([
      { json: { ok: null } },
      { json: { ok: false } },
      { json: { ok: true } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "ok", direction: "asc" });
    assert.deepEqual(sorted.rows.map((row) => row.ok), [false, true, null]);
  });

  await check("TABLE-SORT-18 array<string> does not crash", () => {
    const table = buildDisplayTable([
      { json: { labelIds: ["UNREAD"] } },
      { json: { labelIds: ["SENT", "INBOX"] } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "labelIds", direction: "desc" });
    assert.equal(Array.isArray(sorted.rows[0].labelIds), true);
    assert.equal((sorted.rows[0].labelIds as unknown[]).length, 2);
  });

  await check("TABLE-SORT-19 array<object> does not crash", () => {
    const table = buildDisplayTable([
      { json: { actions: [{ action_type: "purchase", value: 1 }] } },
      { json: { actions: [{ action_type: "link_click", value: 2 }, { action_type: "purchase", value: 3 }] } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "actions", direction: "desc" });
    assert.equal(Array.isArray(sorted.rows[0].actions), true);
    assert.equal((sorted.rows[0].actions as unknown[]).length, 2);
  });

  await check("TABLE-SORT-20 nested object does not crash", () => {
    const table = buildDisplayTable([
      { json: { campaign: { id: "2", name: "Beta" } } },
      { json: { campaign: { id: "1", name: "Alpha" } } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "campaign", direction: "asc" });
    assert.equal(typeof sorted.rows[0].campaign, "object");
    assert.equal(Array.isArray(sorted.rows[0].campaign), false);
  });

  await check("TABLE-SORT-21 mixed-type column deterministic", () => {
    const table = buildDisplayTable([
      { json: { v: "unknown" } },
      { json: { v: 10 } },
      { json: { v: null } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "v", direction: "desc" });
    assert.equal(sorted.rows[0].v, 10);
    assert.equal(sorted.rows[1].v, "unknown");
    assert.equal(sorted.rows[2].v, null);
  });

  await check("TABLE-SORT-22 equal selected-column values preserve canonical source order", () => {
    const table = buildDisplayTable([
      { json: { query: "B", impressions: 10 } },
      { json: { query: "C", impressions: 10 } },
      { json: { query: "A", impressions: 30 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "impressions", direction: "desc" });
    assert.deepEqual(queries(sorted), ["A", "B", "C"]);
  });

  await check("TABLE-SORT-23 sort does not mutate canonical rows array", () => {
    const table = buildDisplayTable(gscCanonicalItems);
    const original = table.rows;
    const snapshot = original.slice();
    applyTableSort(table, { columnKey: "impressions", direction: "desc" });
    assert.equal(table.rows, original);
    assert.deepEqual(table.rows, snapshot);
  });

  await check("TABLE-SORT-24 sort does not mutate row objects", () => {
    const table = buildDisplayTable(gscCanonicalItems);
    Object.freeze(table.rows[0]);
    Object.freeze(table.rows[1]);
    const sorted = applyTableSort(table, { columnKey: "impressions", direction: "desc" });
    assert.equal(sorted.rows[0], table.rows[1]);
    assert.equal(table.rows[0].query, "A");
    assert.equal(table.rows[0].impressions, 5);
  });

  await check("TABLE-SORT-25 JSON output remains canonical after Table sort", () => {
    const view = inspectItems(gscCanonicalItems);
    applyTableSort(view.table, { columnKey: "impressions", direction: "desc" });
    const jsonRows = view.jsonValue as Array<{ query: string }>;
    assert.deepEqual(jsonRows.map((row) => row.query), ["A", "B"]);
  });

  await check("TABLE-SORT-26 Schema unchanged after Table sort", () => {
    const view = inspectItems(gscCanonicalItems);
    const before = { ...view.schema };
    applyTableSort(view.table, { columnKey: "impressions", direction: "desc" });
    assert.deepEqual(view.schema, before);
  });

  await check("TABLE-SORT-27 Pinned canonical data unchanged", () => {
    assert.match(occSrc, /stepItems\[nodeId\] = pinnedNode!\.data!\.pinnedItems/);
    assert.equal(viewerSrc.includes("pinnedItems"), false);
    assert.equal(gscSortSrc.includes("applyTableSort"), false);
  });

  await check("TABLE-SORT-28 INPUT Table uses shared sorting", () => {
    assert.match(inputSrc, /ItemDataViewer/);
    assert.equal(inputSrc.includes("applyTableSort"), false);
  });

  await check("TABLE-SORT-29 OUTPUT Table uses shared sorting", () => {
    assert.match(outputSrc, /ItemDataViewer/);
    assert.equal(outputSrc.includes("applyTableSort"), false);
  });

  await check("TABLE-SORT-30 Result display-unwrapped rows are sortable", () => {
    const table = buildDisplayTable([
      {
        json: {
          result: [
            { name: "low", score: 1 },
            { name: "high", score: 9 },
          ],
        },
      },
    ]);
    assert.equal(table.unwrappedResult, true);
    const sorted = applyTableSort(table, { columnKey: "score", direction: "desc" });
    assert.deepEqual(sorted.rows.map((row) => row.name), ["high", "low"]);
  });

  await check("TABLE-SORT-31 Gmail labelIds remain arrays", () => {
    const labels = ["UNREAD", "SENT"];
    const table = buildDisplayTable([{ json: { id: "1", subject: "Hello", labelIds: labels } }]);
    const sorted = applyTableSort(table, { columnKey: "subject", direction: "desc" });
    assert.equal(sorted.rows[0].labelIds, labels);
    assert.equal(Array.isArray(sorted.rows[0].labelIds), true);
  });

  await check("TABLE-SORT-32 Meta action arrays remain arrays", () => {
    const actions = [{ action_type: "purchase", value: 2 }];
    const table = buildDisplayTable([
      { json: { campaign_name: "A", spend: 100, actions } },
      { json: { campaign_name: "B", spend: 500, actions: [{ action_type: "link_click", value: 1 }] } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "spend", direction: "desc" });
    assert.equal(Array.isArray(sorted.rows[1].actions), true);
    assert.equal((sorted.rows[1].actions as Array<{ action_type: string }>)[0].action_type, "purchase");
  });

  await check("TABLE-SORT-33 GSC initial Table order remains canonical backend ranking", () => {
    assert.deepEqual(queries(gscCanonicalTable), ["A", "B"]);
    assert.deepEqual(queries(applyTableSort(gscCanonicalTable, EMPTY_TABLE_SORT)), ["A", "B"]);
  });

  await check("TABLE-SORT-34 GSC Impressions click sorts display by impressions only", () => {
    const sorted = applyTableSort(gscCanonicalTable, { columnKey: "impressions", direction: "desc" });
    assert.deepEqual(queries(sorted), ["B", "A"]);
  });

  await check("TABLE-SORT-35 GSC clearing sort restores exact backend ranking", () => {
    const desc = cycleTableSort(EMPTY_TABLE_SORT, "impressions");
    const asc = cycleTableSort(desc, "impressions");
    const none = cycleTableSort(asc, "impressions");
    assert.deepEqual(queries(applyTableSort(gscCanonicalTable, none)), ["A", "B"]);
  });

  await check("TABLE-SORT-36 GSC $first / canonical items unaffected by UI sorting", () => {
    const items = gscCanonicalItems.slice();
    applyTableSort(buildDisplayTable(items), { columnKey: "impressions", direction: "desc" });
    assert.equal(items[0].json.query, "A");
    assert.equal(viewerSrc.includes("gscPerformanceSort"), false);
  });

  await check("TABLE-SORT-37 Google Ads output sortable without runtime mutation", () => {
    const json = { campaignName: "Brand", impressions: 12, clicks: 3 };
    const table = buildDisplayTable([
      { json },
      { json: { campaignName: "Search", impressions: 90, clicks: 1 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "impressions", direction: "desc" });
    assert.equal(sorted.rows[0].campaignName, "Search");
    assert.equal(json.impressions, 12);
  });

  await check("TABLE-SORT-38 Meta output sortable without runtime mutation", () => {
    const json = { campaign_name: "A", spend: 100, impressions: 10 };
    const table = buildDisplayTable([
      { json },
      { json: { campaign_name: "B", spend: 500, impressions: 2 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "spend", direction: "desc" });
    assert.equal(sorted.rows[0].campaign_name, "B");
    assert.equal(json.spend, 100);
  });

  await check("TABLE-SORT-39 GA4 output sortable without runtime mutation", () => {
    const json = { pagePath: "/", sessions: 10 };
    const table = buildDisplayTable([
      { json },
      { json: { pagePath: "/pricing", sessions: 40 } },
    ]);
    const sorted = applyTableSort(table, { columnKey: "sessions", direction: "desc" });
    assert.equal(sorted.rows[0].pagePath, "/pricing");
    assert.equal(json.sessions, 10);
  });

  await check("TABLE-SORT-40 active sort indicator correct", () => {
    assert.match(viewerSrc, /ArrowUpDown/);
    assert.match(viewerSrc, /ArrowDown/);
    assert.match(viewerSrc, /ArrowUp/);
    assert.match(viewerSrc, /cycleTableSort/);
  });

  await check("TABLE-SORT-41 aria-sort correct", () => {
    assert.equal(ariaSortValue("impressions", EMPTY_TABLE_SORT), "none");
    assert.equal(
      ariaSortValue("impressions", { columnKey: "impressions", direction: "desc" }),
      "descending"
    );
    assert.equal(
      ariaSortValue("impressions", { columnKey: "impressions", direction: "asc" }),
      "ascending"
    );
    assert.match(viewerSrc, /aria-sort=\{ariaSortValue/);
  });

  await check("TABLE-SORT-42 keyboard sorting works", () => {
    assert.match(viewerSrc, /type="button"/);
    assert.match(viewerSrc, /onClick=\{\(\) => onSort\(columnKey\)\}/);
  });

  await check("TABLE-SORT-43 changing inspected node/dataset resets manual sort", () => {
    const kept = nextTableSortForDataset(
      "same",
      "same",
      { columnKey: "impressions", direction: "desc" }
    );
    assert.equal(kept.columnKey, "impressions");
    const reset = nextTableSortForDataset(
      "node-a",
      "node-b",
      { columnKey: "impressions", direction: "desc" }
    );
    assert.equal(reset.columnKey, null);
    assert.equal(reset.direction, null);
    assert.match(viewerSrc, /tableSortDatasetKey/);
  });

  await check("TABLE-SORT-44 ordinary React re-render does not unnecessarily clear active sort", () => {
    const a = buildDisplayTable(gscCanonicalItems);
    const b = buildDisplayTable(
      gscCanonicalItems.map((item) => ({ json: { ...item.json } }))
    );
    assert.equal(tableSortDatasetKey(a), tableSortDatasetKey(b));
    const kept = nextTableSortForDataset(
      tableSortDatasetKey(a),
      tableSortDatasetKey(b),
      { columnKey: "impressions", direction: "desc" }
    );
    assert.equal(kept.direction, "desc");
  });

  console.log(`\n${passed} inspector checks passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

void main();
