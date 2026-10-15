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
  buildDisplayTable,
  cloneValue,
  formatCompactCell,
  inferItemSchema,
  inferSchemaKind,
  inspectItems,
  parseResultPayloadForDisplay,
  prettyJson,
  toCanonicalItems,
} from "../src/modules/workflows/inspectorViewModel";
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

  console.log(`\n${passed} inspector checks passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

void main();
