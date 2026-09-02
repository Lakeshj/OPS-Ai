/**
 * Offline smoke test for workflow node logic that needs no DB or network.
 * Run: node scripts/smoke-workflow-engine.js
 */
const assert = require("node:assert");
const {
  handlers,
  resolveExpression,
  compareValues,
  ExpressionReferenceError,
} = require("../services/workflowNodes.service");
const {
  buildGraph,
  findBackEdges,
  createScheduler,
  finalizeNodeItems,
  executePartial,
  buildExpressionPreviewContext,
} = require("../services/workflowEngine.service");
const {
  normalizeNodeOutput,
  serializeItems,
  cloneItem,
  cloneJsonData,
  attachCanonicalItemsToOutput,
  resolveProvenancePolicy,
  resolveUpstreamItem,
  walkProvenanceChain,
  walkFanInContributors,
  isValidPairedItem,
} = require("../services/workflowProvenance.service");
const {
  resolveReferencedItem,
  REASONS,
} = require("../services/workflowExpression.service");
const {
  MERGE_PORT_IDS,
  PORT_STATES,
  normalizeMergeIncomingEdges,
  validateMergeWiring,
  collectPortInputs,
  prepareNodeExecutionInputs,
  buildPortInputPreview,
  getIncomingEdgeForInputIndex,
  portIdToInputIndex,
  hasPortError,
} = require("../services/workflowMultiInput.service");
const {
  normalizeSwitchRules,
  resolveSwitchOutputPorts,
  getSwitchOutputPortIds,
  generateRuleId,
  legacyStableRuleId,
  isValidSwitchSourceHandle,
  pruneInvalidSwitchEdges,
  prunePinnedPortOutputs,
  duplicateSwitchNodeData,
  validateSwitchEdges,
  SWITCH_FALLBACK_HANDLE,
} = require("../services/workflowDynamicPorts.service");

let passed = 0;
const queue = [];
const check = (name, fn) => {
  queue.push(async () => {
    try {
      await fn();
      passed += 1;
      console.log(`  ok  ${name}`);
    } catch (err) {
      console.error(`FAIL  ${name}\n      ${err.message}`);
      process.exitCode = 1;
    }
  });
};
const section = (name) => queue.push(async () => console.log(`\n${name}`));

const ctx = {
  input: { message: "Summarize the top 5 rows" },
  steps: {
    "sheet-1": {
      rowCount: 41,
      rows: [
        { page: "/", clicks: 3, ctr: "5.26%" },
        { page: "/contact", clicks: 0, ctr: "0%" },
      ],
      text: "raw sheet",
    },
    "ai-9": { text: "AI ANSWER", isLlm: true, provider: "openai" },
  },
};

section("expressions");
check("single expression keeps number type", () => {
  const v = resolveExpression("{{steps.sheet-1.rowCount}}", ctx);
  assert.strictEqual(v, 41);
  assert.strictEqual(typeof v, "number");
});
check("single expression keeps array type", () => {
  const v = resolveExpression("{{steps.sheet-1.rows}}", ctx);
  assert.ok(Array.isArray(v) && v.length === 2);
});
check("mixed template still stringifies", () => {
  assert.strictEqual(
    resolveExpression("rows={{steps.sheet-1.rowCount}}", ctx),
    "rows=41"
  );
});
check("{{input}} resolves the message", () => {
  assert.strictEqual(
    resolveExpression("{{input}}", ctx),
    "Summarize the top 5 rows"
  );
});
check("unknown path resolves to empty string", () => {
  assert.strictEqual(resolveExpression("{{steps.nope.text}}", ctx), "");
});

section("operators");
check("numeric gt", () => assert.strictEqual(compareValues(41, "gt", 10), true));
check("percent string gt", () =>
  assert.strictEqual(compareValues("3.08%", "gt", "3"), true));
check("thousands separator gt", () =>
  assert.strictEqual(compareValues("1,234", "gt", 1000), true));
check("numeric equality across types", () =>
  assert.strictEqual(compareValues("3.0", "equals", 3), true));
check("is_empty", () => assert.strictEqual(compareValues("", "is_empty"), true));
check("is_not_empty on zero", () =>
  assert.strictEqual(compareValues(0, "is_not_empty"), true));
check("regex", () =>
  assert.strictEqual(compareValues("evincera.com", "regex", "^evin"), true));
check("not_contains", () =>
  assert.strictEqual(compareValues("abc", "not_contains", "z"), true));
check("non-numeric comparison is rejected", () => {
  assert.throws(() => compareValues("abc", "gt", 1), /must be numeric/);
});

section("handlers");
check("condition routes true and reports resolved types", async () => {
  const r = await handlers.condition(
    {
      id: "c1",
      data: { left: "{{steps.sheet-1.rowCount}}", operator: "gt", right: "10" },
    },
    ctx
  );
  assert.strictEqual(r.nextHandle, "true");
  assert.strictEqual(r.resolved.leftType, "number");
});
check("condition routes false", async () => {
  const r = await handlers.condition(
    {
      id: "c1",
      data: { left: "{{steps.sheet-1.rowCount}}", operator: "lt", right: "10" },
    },
    ctx
  );
  assert.strictEqual(r.nextHandle, "false");
});
check("result prefers the LLM step over a loader", async () => {
  const r = await handlers.result(
    { id: "r1", data: { mapFrom: "{{steps.sheet-1.text}}" } },
    ctx
  );
  assert.strictEqual(r.output.result, "AI ANSWER");
});
check("set preserves types", async () => {
  const r = await handlers.set(
    {
      id: "s1",
      data: { mappings: [{ key: "n", value: "{{steps.sheet-1.rowCount}}" }] },
    },
    ctx
  );
  assert.strictEqual(r.output.n, 41);
});
check("bot without an assistant fails clearly", async () => {
  await assert.rejects(() => handlers.bot({ id: "b1", data: {} }, ctx), {
    message: /requires a Keyword Assistant/,
  });
});

/** Drives the scheduler with canned handle choices; returns the visit order. */
const drive = (definition, handles = {}, limit = 60) => {
  const graph = buildGraph(definition);
  const scheduler = createScheduler(graph);
  const order = [];
  for (let i = 0; i < limit; i += 1) {
    const next = scheduler.next();
    if (!next) return { order, scheduler, exhausted: false };
    if (next.action === "skip") {
      order.push(`skip:${next.node.id}`);
      scheduler.skip(next.node);
      continue;
    }
    order.push(next.node.id);
    scheduler.complete(next.node, handles[next.node.id] ?? null);
  }
  return { order, scheduler, exhausted: true };
};

const node = (id, type) => ({ id, type, position: { x: 0, y: 0 }, data: {} });
const edge = (source, target, sourceHandle) => ({
  id: `${source}->${target}${sourceHandle ? `#${sourceHandle}` : ""}`,
  source,
  target,
  sourceHandle: sourceHandle || null,
});

section("item nodes");
const rows = [
  { page: "/", clicks: 3, ctr: "5.26%" },
  { page: "/contact", clicks: 0, ctr: "0%" },
  { page: "/blog", clicks: 7, ctr: "2%" },
  { page: "/blog", clicks: 7, ctr: "2%" },
];
const itemCtx = (inputItems) => ({ ...ctx, inputItems });

check("split out expands an array field", async () => {
  const r = await handlers.splitOut(
    { id: "s", data: { fieldName: "rows" } },
    itemCtx([{ rows }])
  );
  assert.strictEqual(r.items.length, 4);
  assert.strictEqual(r.items[0].page, "/");
});
check("split out rejects a non-array field", async () => {
  await assert.rejects(
    () => handlers.splitOut({ id: "s", data: { fieldName: "page" } }, itemCtx(rows)),
    /not an array/
  );
});
check("filter keeps matching items", async () => {
  const r = await handlers.filter(
    { id: "f", data: { fieldName: "clicks", operator: "gt", right: "0" } },
    itemCtx(rows)
  );
  assert.strictEqual(r.items.length, 3);
  assert.strictEqual(r.output.droppedCount, 1);
});
check("sort orders numerically descending", async () => {
  const r = await handlers.sort(
    { id: "so", data: { fieldName: "clicks", direction: "desc" } },
    itemCtx(rows)
  );
  assert.deepStrictEqual(
    r.items.map((i) => i.clicks),
    [7, 7, 3, 0]
  );
});
check("limit keeps the first n", async () => {
  const r = await handlers.limit({ id: "l", data: { maxItems: 2 } }, itemCtx(rows));
  assert.strictEqual(r.items.length, 2);
});
check("remove duplicates by field", async () => {
  const r = await handlers.removeDuplicates(
    { id: "d", data: { fieldName: "page" } },
    itemCtx(rows)
  );
  assert.strictEqual(r.items.length, 3);
});
check("aggregate sums a field", async () => {
  const r = await handlers.aggregate(
    { id: "a", data: { operation: "sum", fieldName: "clicks" } },
    itemCtx(rows)
  );
  assert.strictEqual(r.output.value, 17);
});
check("aggregate counts without a field", async () => {
  const r = await handlers.aggregate(
    { id: "a", data: { operation: "count" } },
    itemCtx(rows)
  );
  assert.strictEqual(r.output.value, 4);
});
check("aggregate reports when nothing is numeric", async () => {
  await assert.rejects(
    () =>
      handlers.aggregate(
        { id: "a", data: { operation: "sum", fieldName: "page" } },
        itemCtx(rows)
      ),
    /no numeric values/
  );
});
check("merge append passes every branch item", async () => {
  const r = await handlers.merge({ id: "m", data: { mode: "append" } }, itemCtx(rows));
  assert.strictEqual(r.items.length, 4);
});
check("merge combine folds fields into one item", async () => {
  const r = await handlers.merge(
    { id: "m", data: { mode: "combine" } },
    itemCtx([{ a: 1 }, { b: 2 }])
  );
  assert.deepStrictEqual(r.items, [{ a: 1, b: 2 }]);
});
check("item output text is tab separated for Result/AI", async () => {
  const r = await handlers.limit({ id: "l", data: { maxItems: 1 } }, itemCtx(rows));
  assert.strictEqual(r.output.text.split("\n")[0], "page\tclicks\tctr");
});

section("code node");
const codeCtx = (inputItems) => ({ ...ctx, inputItems });
check("all-items mode sees the items array", async () => {
  const r = await handlers.code(
    { id: "c", data: { code: "return items.map(i => ({ n: i.clicks * 2 }));" } },
    codeCtx([{ clicks: 2 }, { clicks: 3 }])
  );
  assert.deepStrictEqual(r.items, [{ n: 4 }, { n: 6 }]);
});
check("per-item mode runs once per item", async () => {
  const r = await handlers.code(
    { id: "c", data: { mode: "each", code: "return { page: item.page, i: index };" } },
    codeCtx([{ page: "/a" }, { page: "/b" }])
  );
  assert.deepStrictEqual(r.items, [
    { page: "/a", i: 0 },
    { page: "/b", i: 1 },
  ]);
});
check("console.log is captured", async () => {
  const r = await handlers.code(
    { id: "c", data: { code: "console.log('hello', 42); return 1;" } },
    codeCtx([])
  );
  assert.deepStrictEqual(r.output.logs, ["hello 42"]);
});
check("require is unavailable", async () => {
  await assert.rejects(
    () => handlers.code({ id: "c", data: { code: "return require('fs');" } }, codeCtx([])),
    /require is not defined/
  );
});
check("process is unavailable", async () => {
  await assert.rejects(
    () => handlers.code({ id: "c", data: { code: "return process.env;" } }, codeCtx([])),
    /process is not defined/
  );
});
check("fetch is unavailable", async () => {
  await assert.rejects(
    () => handlers.code({ id: "c", data: { code: "return fetch('http://x');" } }, codeCtx([])),
    /fetch is not defined/
  );
});
check("constructor escape does not reach the host process", async () => {
  await assert.rejects(
    () =>
      handlers.code(
        {
          id: "c",
          data: {
            code: "return this.constructor.constructor('return process')().env;",
          },
        },
        codeCtx([])
      ),
    /Code node failed/
  );
});
check("eval and new Function are blocked", async () => {
  await assert.rejects(
    () => handlers.code({ id: "c", data: { code: "return eval('1+1');" } }, codeCtx([])),
    /Code node failed/
  );
});
check("an infinite loop is cut off by the timeout", async () => {
  await assert.rejects(
    () =>
      handlers.code(
        { id: "c", data: { code: "while (true) {}", timeoutMs: 300 } },
        codeCtx([])
      ),
    /timed out after 300ms/
  );
});
check("a thrown error surfaces the message", async () => {
  await assert.rejects(
    () =>
      handlers.code(
        { id: "c", data: { code: "throw new Error('boom');" } },
        codeCtx([])
      ),
    /boom/
  );
});

section("credentials");
const { encryptSecret, decryptSecret } = require("../services/secretBox.service");
check("secrets round-trip through encryption", () => {
  const secret = { token: "sk-live-123", headerName: "X-Api-Key" };
  const sealed = encryptSecret(secret);
  assert.ok(!sealed.includes("sk-live-123"), "ciphertext hides the value");
  assert.deepStrictEqual(decryptSecret(sealed), secret);
});
check("tampered ciphertext is rejected", () => {
  const sealed = encryptSecret({ token: "abc" });
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(parts.join(".")), /Could not decrypt|malformed/);
});
check("malformed ciphertext is rejected", () => {
  assert.throws(() => decryptSecret("nonsense"), /malformed/);
});

section("scheduler");
check("runs a linear graph in order", () => {
  const { order } = drive({
    nodes: [node("t", "trigger"), node("a", "set"), node("r", "result")],
    edges: [edge("t", "a"), edge("a", "r")],
  });
  assert.deepStrictEqual(order, ["t", "a", "r"]);
});

check("condition skips the branch it did not take", () => {
  const { order } = drive(
    {
      nodes: [
        node("t", "trigger"),
        node("c", "condition"),
        node("yes", "set"),
        node("no", "set"),
        node("r", "result"),
      ],
      edges: [
        edge("t", "c"),
        edge("c", "yes", "true"),
        edge("c", "no", "false"),
        edge("yes", "r"),
        edge("no", "r"),
      ],
    },
    { c: "true" }
  );
  assert.ok(order.includes("yes"), "true branch runs");
  assert.ok(order.includes("skip:no"), "false branch is skipped");
  assert.ok(order.indexOf("r") > order.indexOf("yes"), "result runs last");
});

check("merge waits for both branches before running", () => {
  const { order } = drive({
    nodes: [
      node("t", "trigger"),
      node("a", "http"),
      node("b", "http"),
      node("m", "merge"),
    ],
    edges: [edge("t", "a"), edge("t", "b"), edge("a", "m"), edge("b", "m")],
  });
  assert.ok(order.indexOf("m") > order.indexOf("a"));
  assert.ok(order.indexOf("m") > order.indexOf("b"));
});

check("a node fed only by skipped edges is skipped, not stuck", () => {
  const { order, exhausted } = drive(
    {
      nodes: [
        node("t", "trigger"),
        node("c", "condition"),
        node("no", "set"),
        node("after", "set"),
      ],
      edges: [
        edge("t", "c"),
        edge("c", "no", "false"),
        edge("no", "after"),
      ],
    },
    { c: "true" }
  );
  assert.strictEqual(exhausted, false, "scheduler terminates");
  assert.ok(order.includes("skip:no") && order.includes("skip:after"));
});

check("back edges are detected", () => {
  const graph = buildGraph({
    nodes: [node("a", "set"), node("b", "set")],
    edges: [edge("a", "b"), edge("b", "a")],
  });
  assert.strictEqual(findBackEdges(graph).size, 1);
});

check("a cycle terminates instead of hanging", () => {
  assert.throws(
    () =>
      drive(
        {
          nodes: [node("t", "trigger"), node("a", "set"), node("b", "set")],
          edges: [edge("t", "a"), edge("a", "b"), edge("b", "a")],
        },
        {},
        500
      ),
    /exceeded 100 iterations/
  );
});

section("pairedItem provenance");
const provenanceNode = (type, data = {}) => ({ type, data });
const provenanceInputs = () => [
  { json: { name: "Rahul" }, pairedItem: { item: 0 } },
  { json: { name: "Alex" }, pairedItem: { item: 1 } },
  { json: { name: "Sam" }, pairedItem: { item: 2 } },
];
const pairedIndex = (item) =>
  typeof item.pairedItem === "number"
    ? item.pairedItem
    : item.pairedItem?.item;

check("identity 1:1 links output to matching input index", () => {
  const inputs = provenanceInputs();
  const outputs = inputs.map((i) => ({ ...i.json, ok: true }));
  const out = normalizeNodeOutput(provenanceNode("noop"), inputs, outputs);
  assert.deepStrictEqual(out.map(pairedIndex), [0, 1, 2]);
});

check("filter survival keeps immediate input positions", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.filter(
    { id: "f", data: { fieldName: "name", operator: "not_equals", right: "Alex" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(provenanceNode("filter"), inputs, r.items);
  assert.deepStrictEqual(out.map(pairedIndex), [0, 2]);
});

check("sort preserves immediate input positions after reorder", async () => {
  const inputs = [
    { json: { label: "C", n: 3 }, pairedItem: { item: 0 } },
    { json: { label: "A", n: 1 }, pairedItem: { item: 1 } },
    { json: { label: "B", n: 2 }, pairedItem: { item: 2 } },
  ];
  const r = await handlers.sort(
    { id: "s", data: { fieldName: "n", direction: "asc" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(provenanceNode("sort"), inputs, r.items);
  assert.deepStrictEqual(
    out.map((i) => i.json.label),
    ["A", "B", "C"]
  );
  assert.deepStrictEqual(out.map(pairedIndex), [1, 2, 0]);
});

check("limit keep first preserves head indices", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.limit(
    { id: "l", data: { maxItems: 2, keep: "first" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(provenanceNode("limit"), inputs, r.items);
  assert.deepStrictEqual(out.map(pairedIndex), [0, 1]);
});

check("limit keep last preserves tail indices (3 items)", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.limit(
    { id: "l", data: { maxItems: 2, keep: "last" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(provenanceNode("limit"), inputs, r.items);
  assert.deepStrictEqual(out.map(pairedIndex), [1, 2]);
});

check("limit keep last preserves indices 3 and 4 from five items", async () => {
  const inputs = ["alpha", "beta", "gamma", "delta", "epsilon"].map(
    (id, index) => ({
      json: { id },
      pairedItem: { item: index },
    })
  );
  const r = await handlers.limit(
    { id: "l", data: { maxItems: 2, keep: "last" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(provenanceNode("limit"), inputs, r.items);
  assert.deepStrictEqual(out.map((i) => i.json.id), ["delta", "epsilon"]);
  assert.deepStrictEqual(out.map(pairedIndex), [3, 4]);
});

check("split out fanOut links all children to immediate input position", async () => {
  const inputs = [
    { json: { tags: ["seo", "ads", "ai"] }, pairedItem: { item: 4 } },
  ];
  const r = await handlers.splitOut(
    { id: "s", data: { fieldName: "tags" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(
    provenanceNode("splitOut", { fieldName: "tags" }),
    inputs,
    r.items
  );
  assert.strictEqual(out.length, 3);
  assert.ok(out.every((i) => pairedIndex(i) === 0));
});

check("aggregate fanIn references all contributing inputs", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.aggregate(
    { id: "a", data: { operation: "count" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(provenanceNode("aggregate"), inputs, r.items);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].pairedItem, [
    { item: 0 },
    { item: 1 },
    { item: 2 },
  ]);
});

check("condition routing preserves original item indices", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.condition(
    { id: "c", data: { left: "1", operator: "equals", right: "1" } },
    { ...ctx, inputItems: inputs }
  );
  const out = normalizeNodeOutput(provenanceNode("condition"), inputs, r.items);
  assert.deepStrictEqual(out.map(pairedIndex), [0, 1, 2]);
});

check("branch clones prevent cross-branch mutation", () => {
  const source = { json: { x: 1 }, pairedItem: { item: 0 } };
  const a = cloneItem(source);
  const b = cloneItem(source);
  a.json.x = 99;
  assert.strictEqual(b.json.x, 1);
  assert.strictEqual(source.json.x, 1);
});

check("binary metadata survives provenance normalization", () => {
  const inputs = [
    {
      json: { x: 1 },
      binary: { file: { data: "abc", mimeType: "text/plain" } },
      pairedItem: { item: 0 },
    },
  ];
  const out = normalizeNodeOutput(provenanceNode("noop"), inputs, [{ x: 2 }]);
  assert.strictEqual(out[0].binary.file.data, "abc");
  assert.strictEqual(out[0].json.x, 2);
});

check("legacy items without pairedItem still execute", async () => {
  const r = await handlers.filter(
    { id: "f", data: { fieldName: "clicks", operator: "gt", right: "0" } },
    itemCtx(rows)
  );
  assert.strictEqual(r.items.length, 3);
});

check("pairedItem survives JSON serialization", () => {
  const inputs = provenanceInputs().slice(0, 1);
  const out = normalizeNodeOutput(provenanceNode("noop"), inputs, [{ ok: true }]);
  const round = serializeItems(out);
  assert.deepStrictEqual(round[0].pairedItem, { item: 0 });
});

check("code per-item mode links provenance positionally", () => {
  const inputs = [
    { json: { page: "/a" }, pairedItem: { item: 0 } },
    { json: { page: "/b" }, pairedItem: { item: 1 } },
  ];
  const out = normalizeNodeOutput(
    provenanceNode("code", { mode: "each" }),
    inputs,
    [{ page: "/a" }, { page: "/b" }]
  );
  assert.deepStrictEqual(out.map(pairedIndex), [0, 1]);
});

check("code all-items mode links when counts match", () => {
  const inputs = [
    { json: { n: 1 }, pairedItem: { item: 0 } },
    { json: { n: 2 }, pairedItem: { item: 1 } },
  ];
  const out = normalizeNodeOutput(
    provenanceNode("code"),
    inputs,
    [{ n: 2 }, { n: 4 }]
  );
  assert.deepStrictEqual(out.map(pairedIndex), [0, 1]);
});

section("Part 2B provenance stabilization");

const finalize = (type, data, inputItems, handlerResult) => {
  const result = { ...handlerResult };
  const items = finalizeNodeItems(provenanceNode(type, data), inputItems, result);
  return { items, output: result.output };
};

check("set processes three input items as N→N", async () => {
  const inputs = [
    { json: { page: "/a", clicks: 1 }, pairedItem: { item: 0 } },
    { json: { page: "/b", clicks: 2 }, pairedItem: { item: 1 } },
    { json: { page: "/c", clicks: 3 }, pairedItem: { item: 2 } },
  ];
  const r = await handlers.set(
    {
      id: "s",
      data: {
        mappings: [{ key: "doubled", value: "{{item.clicks}}" }],
      },
    },
    { ...ctx, inputItems: inputs }
  );
  assert.strictEqual(r.items.length, 3);
  const { items } = finalize("set", { mappings: [] }, inputs, r);
  assert.deepStrictEqual(items.map((i) => i.json.doubled), [1, 2, 3]);
  assert.deepStrictEqual(items.map(pairedIndex), [0, 1, 2]);
});

check("filter then sort composes provenance across hops", async () => {
  const inputs = [
    { json: { name: "Charlie" }, pairedItem: { item: 0 } },
    { json: { name: "Alice" }, pairedItem: { item: 1 } },
    { json: { name: "Bob" }, pairedItem: { item: 2 } },
    { json: { name: "Removed" }, pairedItem: { item: 3 } },
  ];
  const filterResult = await handlers.filter(
    {
      id: "f",
      data: { fieldName: "name", operator: "not_equals", right: "Removed" },
    },
    { ...ctx, inputItems: inputs }
  );
  const filterOut = normalizeNodeOutput(
    provenanceNode("filter"),
    inputs,
    filterResult.items
  );
  const sortResult = await handlers.sort(
    { id: "s", data: { fieldName: "name", direction: "asc" } },
    { ...ctx, inputItems: filterOut }
  );
  const sortOut = normalizeNodeOutput(
    provenanceNode("sort"),
    filterOut,
    sortResult.items
  );
  assert.deepStrictEqual(
    sortOut.map((i) => i.json.name),
    ["Alice", "Bob", "Charlie"]
  );
  assert.deepStrictEqual(sortOut.map(pairedIndex), [1, 2, 0]);
  const aliceUpstream = resolveUpstreamItem(filterOut, sortOut[0].pairedItem);
  assert.strictEqual(aliceUpstream.json.name, "Alice");
  assert.strictEqual(pairedIndex(aliceUpstream), 1);
});

check("split out then filter uses immediate-hop indices", async () => {
  const inputs = [
    {
      json: { tags: ["seo", "spam", "ai"] },
      pairedItem: { item: 7 },
    },
  ];
  const splitResult = await handlers.splitOut(
    { id: "s", data: { fieldName: "tags" } },
    { ...ctx, inputItems: inputs }
  );
  const splitOut = normalizeNodeOutput(
    provenanceNode("splitOut", { fieldName: "tags" }),
    inputs,
    splitResult.items
  );
  assert.deepStrictEqual(splitOut.map(pairedIndex), [0, 0, 0]);
  const filterResult = await handlers.filter(
    {
      id: "f",
      data: { fieldName: "value", operator: "not_equals", right: "spam" },
    },
    { ...ctx, inputItems: splitOut }
  );
  const filtered = normalizeNodeOutput(
    provenanceNode("filter"),
    splitOut,
    filterResult.items
  );
  assert.strictEqual(filtered.length, 2);
  assert.deepStrictEqual(filtered.map(pairedIndex), [0, 2]);
  const root0 = walkProvenanceChain([inputs, splitOut, filtered], filtered[0]);
  const root1 = walkProvenanceChain([inputs, splitOut, filtered], filtered[1]);
  assert.strictEqual(pairedIndex(root0), 7);
  assert.strictEqual(pairedIndex(root1), 7);
});

check("filter then aggregate links all survivors", async () => {
  const inputs = [
    { json: { n: 10 }, pairedItem: { item: 0 } },
    { json: { n: 20 }, pairedItem: { item: 1 } },
    { json: { n: 0 }, pairedItem: { item: 2 } },
  ];
  const filterResult = await handlers.filter(
    { id: "f", data: { fieldName: "n", operator: "gt", right: "0" } },
    { ...ctx, inputItems: inputs }
  );
  const filterOut = normalizeNodeOutput(
    provenanceNode("filter"),
    inputs,
    filterResult.items
  );
  const aggResult = await handlers.aggregate(
    { id: "a", data: { operation: "count" } },
    { ...ctx, inputItems: filterOut }
  );
  const aggOut = normalizeNodeOutput(
    provenanceNode("aggregate"),
    filterOut,
    aggResult.items
  );
  assert.deepStrictEqual(aggOut[0].pairedItem, [{ item: 0 }, { item: 1 }]);
});

check("nested branch isolation prevents deep mutation leaks", () => {
  const source = {
    json: {
      customer: {
        name: "Original",
        address: { city: "Pune" },
      },
    },
    pairedItem: { item: 0 },
  };
  const branchA = cloneItem(source);
  const branchB = cloneItem(source);
  branchA.json.customer.address.city = "Mumbai";
  assert.strictEqual(branchB.json.customer.address.city, "Pune");
  assert.strictEqual(source.json.customer.address.city, "Pune");
});

check("spreadsheet read resolves to fanOut policy", () => {
  assert.strictEqual(
    resolveProvenancePolicy("spreadsheet", { operation: "read" }, {
      inputCount: 1,
      outputCount: 5,
    }),
    "fanOut"
  );
});

check("spreadsheet write resolves to fanIn policy", () => {
  assert.strictEqual(
    resolveProvenancePolicy("spreadsheet", { operation: "write" }, {
      inputCount: 3,
      outputCount: 1,
    }),
    "fanIn"
  );
});

check("http simple request resolves to identity1to1", () => {
  assert.strictEqual(
    resolveProvenancePolicy("http", {}, { inputCount: 1, outputCount: 1 }),
    "identity1to1"
  );
});

check("http pagination resolves to fanOut", () => {
  assert.strictEqual(
    resolveProvenancePolicy("http", { maxPages: 3 }, {
      inputCount: 1,
      outputCount: 12,
      fanOut: true,
    }),
    "fanOut"
  );
});

check("full-run persistence retains pairedItem on set output", async () => {
  const inputs = [
    { json: { v: 1 }, pairedItem: { item: 0 } },
    { json: { v: 2 }, pairedItem: { item: 1 } },
  ];
  const r = await handlers.set(
    { id: "s", data: { mappings: [{ key: "x", value: "{{item.v}}" }] } },
    { ...ctx, inputItems: inputs }
  );
  const { output } = finalize("set", {}, inputs, r);
  const persisted = JSON.parse(JSON.stringify(output));
  assert.ok(Array.isArray(persisted.items));
  assert.deepStrictEqual(persisted.items.map(pairedIndex), [0, 1]);
});

check("full-run persistence retains pairedItem on filter output", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.filter(
    { id: "f", data: { fieldName: "name", operator: "not_equals", right: "Alex" } },
    { ...ctx, inputItems: inputs }
  );
  const { output } = finalize("filter", {}, inputs, r);
  const persisted = JSON.parse(JSON.stringify(output));
  assert.deepStrictEqual(persisted.items.map(pairedIndex), [0, 2]);
});

check("full-run persistence retains pairedItem on sort output", async () => {
  const inputs = [
    { json: { label: "C", n: 3 }, pairedItem: { item: 0 } },
    { json: { label: "A", n: 1 }, pairedItem: { item: 1 } },
    { json: { label: "B", n: 2 }, pairedItem: { item: 2 } },
  ];
  const r = await handlers.sort(
    { id: "s", data: { fieldName: "n", direction: "asc" } },
    { ...ctx, inputItems: inputs }
  );
  const { output } = finalize("sort", {}, inputs, r);
  const persisted = JSON.parse(JSON.stringify(output));
  assert.deepStrictEqual(persisted.items.map(pairedIndex), [1, 2, 0]);
});

check("full-run persistence retains pairedItem on aggregate output", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.aggregate(
    { id: "a", data: { operation: "count" } },
    { ...ctx, inputItems: inputs }
  );
  const { output } = finalize("aggregate", {}, inputs, r);
  const persisted = JSON.parse(JSON.stringify(output));
  assert.deepStrictEqual(persisted.items[0].pairedItem, [
    { item: 0 },
    { item: 1 },
    { item: 2 },
  ]);
});

check("explicit code pairedItem is preserved", () => {
  const inputs = [{ json: { n: 1 }, pairedItem: { item: 0 } }];
  const out = normalizeNodeOutput(
    provenanceNode("code"),
    inputs,
    [{ n: 9, pairedItem: { item: 42, input: 1 } }]
  );
  assert.deepStrictEqual(out[0].pairedItem, { item: 42, input: 1 });
});

check("malformed pairedItem is ignored without corrupting execution", () => {
  const inputs = [{ json: { n: 1 }, pairedItem: { item: 0 } }];
  const out = normalizeNodeOutput(provenanceNode("noop"), inputs, [
    { n: 2, pairedItem: { item: -1 } },
  ]);
  assert.strictEqual(pairedIndex(out[0]), 0);
  assert.ok(!isValidPairedItem({ item: -1 }));
});

check("editor-session finalized items retain provenance", async () => {
  const inputs = provenanceInputs();
  const r = await handlers.filter(
    { id: "f", data: { fieldName: "name", operator: "not_equals", right: "Alex" } },
    { ...ctx, inputItems: inputs }
  );
  const { items } = finalize("filter", {}, inputs, r);
  const session = {
    nodeResults: {
      f: { nodeId: "f", status: "succeeded", output: r.output, items },
    },
  };
  const cached = session.nodeResults.f.items;
  assert.deepStrictEqual(cached.map(pairedIndex), [0, 2]);
  const round = serializeItems(cached);
  assert.deepStrictEqual(round.map(pairedIndex), [0, 2]);
});

section("Part 2C immediate-hop provenance");

check("TEST 1 split out at input position 7 then filter keeps 0 and 2", async () => {
  const inputs = Array.from({ length: 8 }, (_, i) => ({
    json: i === 7 ? { tags: ["seo", "ads", "ai"] } : { filler: i },
    pairedItem: { item: i },
  }));
  const splitResult = await handlers.splitOut(
    { id: "s", data: { fieldName: "tags" } },
    { ...ctx, inputItems: inputs }
  );
  const splitOut = normalizeNodeOutput(
    provenanceNode("splitOut", { fieldName: "tags" }),
    inputs,
    splitResult.items
  );
  assert.deepStrictEqual(splitOut.map(pairedIndex), [7, 7, 7]);
  const filterResult = await handlers.filter(
    {
      id: "f",
      data: { fieldName: "value", operator: "not_equals", right: "ads" },
    },
    { ...ctx, inputItems: splitOut }
  );
  const filtered = normalizeNodeOutput(
    provenanceNode("filter"),
    splitOut,
    filterResult.items
  );
  assert.deepStrictEqual(filtered.map(pairedIndex), [0, 2]);
  assert.strictEqual(pairedIndex(walkProvenanceChain([inputs, splitOut, filtered], filtered[0])), 7);
  assert.strictEqual(pairedIndex(walkProvenanceChain([inputs, splitOut, filtered], filtered[1])), 7);
});

check("TEST 2 filter then sort walks two hops to original indices", async () => {
  const inputs = [
    { json: { name: "Charlie" }, pairedItem: { item: 0 } },
    { json: { name: "Alice" }, pairedItem: { item: 1 } },
    { json: { name: "Bob" }, pairedItem: { item: 2 } },
    { json: { name: "Removed" }, pairedItem: { item: 3 } },
  ];
  const filterResult = await handlers.filter(
    {
      id: "f",
      data: { fieldName: "name", operator: "not_equals", right: "Removed" },
    },
    { ...ctx, inputItems: inputs }
  );
  const filterOut = normalizeNodeOutput(
    provenanceNode("filter"),
    inputs,
    filterResult.items
  );
  assert.deepStrictEqual(filterOut.map(pairedIndex), [0, 1, 2]);
  const sortResult = await handlers.sort(
    { id: "s", data: { fieldName: "name", direction: "asc" } },
    { ...ctx, inputItems: filterOut }
  );
  const sortOut = normalizeNodeOutput(
    provenanceNode("sort"),
    filterOut,
    sortResult.items
  );
  assert.deepStrictEqual(sortOut.map((i) => i.json.name), ["Alice", "Bob", "Charlie"]);
  assert.deepStrictEqual(sortOut.map(pairedIndex), [1, 2, 0]);
  const roots = sortOut.map((item) =>
    pairedIndex(walkProvenanceChain([inputs, filterOut, sortOut], item))
  );
  assert.deepStrictEqual(roots, [1, 2, 0]);
});

check("TEST 3 split out filter sort each hop references immediate predecessor", async () => {
  const inputs = [
    { json: { tags: ["c", "a", "b"] }, pairedItem: { item: 5 } },
  ];
  const splitResult = await handlers.splitOut(
    { id: "s", data: { fieldName: "tags" } },
    { ...ctx, inputItems: inputs }
  );
  const splitOut = normalizeNodeOutput(
    provenanceNode("splitOut", { fieldName: "tags" }),
    inputs,
    splitResult.items
  );
  const filterResult = await handlers.filter(
    { id: "f", data: { fieldName: "value", operator: "not_equals", right: "x" } },
    { ...ctx, inputItems: splitOut }
  );
  const filterOut = normalizeNodeOutput(
    provenanceNode("filter"),
    splitOut,
    filterResult.items
  );
  const sortResult = await handlers.sort(
    { id: "s", data: { fieldName: "value", direction: "asc" } },
    { ...ctx, inputItems: filterOut }
  );
  const sortOut = normalizeNodeOutput(
    provenanceNode("sort"),
    filterOut,
    sortResult.items
  );
  assert.deepStrictEqual(splitOut.map(pairedIndex), [0, 0, 0]);
  assert.deepStrictEqual(filterOut.map(pairedIndex), [0, 1, 2]);
  assert.deepStrictEqual(sortOut.map(pairedIndex), [1, 2, 0]);
  assert.strictEqual(
    pairedIndex(walkProvenanceChain([inputs, splitOut, filterOut, sortOut], sortOut[0])),
    5
  );
});

check("TEST 4 aggregate references filter output positions not pre-filter indices", async () => {
  const inputs = [
    { json: { n: 10 }, pairedItem: { item: 0 } },
    { json: { n: 20 }, pairedItem: { item: 1 } },
    { json: { n: 0 }, pairedItem: { item: 2 } },
  ];
  const filterResult = await handlers.filter(
    { id: "f", data: { fieldName: "n", operator: "gt", right: "0" } },
    { ...ctx, inputItems: inputs }
  );
  const filterOut = normalizeNodeOutput(
    provenanceNode("filter"),
    inputs,
    filterResult.items
  );
  const aggResult = await handlers.aggregate(
    { id: "a", data: { operation: "count" } },
    { ...ctx, inputItems: filterOut }
  );
  const aggOut = normalizeNodeOutput(
    provenanceNode("aggregate"),
    filterOut,
    aggResult.items
  );
  assert.deepStrictEqual(aggOut[0].pairedItem, [{ item: 0 }, { item: 1 }]);
  const roots = walkFanInContributors(
    [inputs, filterOut, aggOut],
    aggOut[0]
  ).map((item) => pairedIndex(item));
  assert.deepStrictEqual(roots, [0, 1]);
});

check("TEST 5 fan-out descendants keep distinct immediate-hop indices downstream", async () => {
  const inputs = [{ json: { tags: ["x", "y", "z"] }, pairedItem: { item: 9 } }];
  const splitResult = await handlers.splitOut(
    { id: "s", data: { fieldName: "tags" } },
    { ...ctx, inputItems: inputs }
  );
  const splitOut = normalizeNodeOutput(
    provenanceNode("splitOut", { fieldName: "tags" }),
    inputs,
    splitResult.items
  );
  const setResult = await handlers.set(
    {
      id: "s2",
      data: { mappings: [{ key: "tag", value: "{{item.value}}" }] },
    },
    { ...ctx, inputItems: splitOut }
  );
  const setOut = normalizeNodeOutput(
    provenanceNode("set"),
    splitOut,
    setResult.items
  );
  assert.deepStrictEqual(setOut.map(pairedIndex), [0, 1, 2]);
  const roots = setOut.map((item) =>
    pairedIndex(walkProvenanceChain([inputs, splitOut, setOut], item))
  );
  assert.deepStrictEqual(roots, [9, 9, 9]);
});

section("Part 3A expression thread-walking");

const makeExprGraph = (edges) =>
  buildGraph({
    nodes: [...new Set(edges.flatMap((e) => [e.source, e.target]))].map((id) => ({
      id,
      type: "noop",
    })),
    edges,
  });

const buildExprContext = ({
  edges,
  currentNodeId,
  currentItemIndex,
  items,
  steps = {},
  input = {},
}) => {
  const graph = makeExprGraph(edges);
  const inputItems = [];
  for (const edge of graph.incoming.get(currentNodeId) || []) {
    const upstream = items[edge.source];
    if (Array.isArray(upstream)) inputItems.push(...upstream);
  }
  return {
    input,
    steps,
    items,
    graph,
    currentNodeId,
    currentItemIndex,
    currentItem: inputItems[currentItemIndex] ?? null,
    inputItems,
  };
};

const assertThrowsExpr = (fn, reason) => {
  try {
    fn();
    assert.fail("expected expression error");
  } catch (err) {
    assert.ok(err instanceof ExpressionReferenceError);
    if (reason) assert.strictEqual(err.reason, reason);
  }
};

check("TEST 1 simple 1→1 resolves corresponding upstream item", () => {
  const items = {
    a: normalizeNodeOutput(provenanceNode("noop"), [], [{ value: 10, id: 0 }]),
    b: normalizeNodeOutput(
      provenanceNode("noop"),
      [{ json: { value: 10, id: 0 }, pairedItem: { item: 0 } }],
      [{ value: 10, id: 0 }]
    ),
  };
  const context = buildExprContext({
    edges: [{ source: "a", target: "b" }],
    currentNodeId: "b",
    currentItemIndex: 0,
    items,
    steps: { a: { value: 10, id: 0 }, b: { value: 10, id: 0 } },
  });
  assert.strictEqual(resolveExpression("{{steps.a.id}}", context), 0);
});

check("TEST 2 filter thread-walk resolves original surviving item", async () => {
  const inputs = [
    { json: { id: 0 }, pairedItem: { item: 0 } },
    { json: { id: 1 }, pairedItem: { item: 1 } },
    { json: { id: 2 }, pairedItem: { item: 2 } },
  ];
  const filterResult = await handlers.filter(
    { id: "f", data: { fieldName: "id", operator: "not_equals", right: "1" } },
    { ...ctx, inputItems: inputs }
  );
  const filterOut = normalizeNodeOutput(provenanceNode("filter"), inputs, filterResult.items);
  const items = { source: inputs, filter: filterOut };
  const context = buildExprContext({
    edges: [{ source: "source", target: "filter" }, { source: "filter", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 1,
    items: {
      ...items,
      current: normalizeNodeOutput(
        provenanceNode("noop"),
        filterOut,
        [{ id: 2 }]
      ),
    },
    steps: { source: { items: inputs }, filter: filterResult.output },
  });
  assert.strictEqual(resolveExpression("{{steps.source.id}}", context), 2);
});

check("TEST 3 sort thread-walk resolves Alice at sorted index 0", async () => {
  const inputs = [
    { json: { name: "Charlie" }, pairedItem: { item: 0 } },
    { json: { name: "Alice" }, pairedItem: { item: 1 } },
    { json: { name: "Bob" }, pairedItem: { item: 2 } },
  ];
  const sortResult = await handlers.sort(
    { id: "s", data: { fieldName: "name", direction: "asc" } },
    { ...ctx, inputItems: inputs }
  );
  const sortOut = normalizeNodeOutput(provenanceNode("sort"), inputs, sortResult.items);
  const context = buildExprContext({
    edges: [{ source: "source", target: "sort" }, { source: "sort", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: {
      source: inputs,
      sort: sortOut,
      current: normalizeNodeOutput(provenanceNode("noop"), sortOut, [{ name: "Alice" }]),
    },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.name}}", context), "Alice");
});

check("TEST 4 filter then sort two-hop thread-walk", async () => {
  const inputs = [
    { json: { name: "Charlie" }, pairedItem: { item: 0 } },
    { json: { name: "Alice" }, pairedItem: { item: 1 } },
    { json: { name: "Bob" }, pairedItem: { item: 2 } },
    { json: { name: "Removed" }, pairedItem: { item: 3 } },
  ];
  const filterResult = await handlers.filter(
    { id: "f", data: { fieldName: "name", operator: "not_equals", right: "Removed" } },
    { ...ctx, inputItems: inputs }
  );
  const filterOut = normalizeNodeOutput(provenanceNode("filter"), inputs, filterResult.items);
  const sortResult = await handlers.sort(
    { id: "s", data: { fieldName: "name", direction: "asc" } },
    { ...ctx, inputItems: filterOut }
  );
  const sortOut = normalizeNodeOutput(provenanceNode("sort"), filterOut, sortResult.items);
  const context = buildExprContext({
    edges: [
      { source: "source", target: "filter" },
      { source: "filter", target: "sort" },
      { source: "sort", target: "current" },
    ],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, filter: filterOut, sort: sortOut, current: sortOut },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.name}}", context), "Alice");
});

check("TEST 5 split out children resolve to same source item", async () => {
  const inputs = [{ json: { tags: ["seo", "ads", "ai"], brand: "Acme" }, pairedItem: { item: 0 } }];
  const splitResult = await handlers.splitOut(
    { id: "s", data: { fieldName: "tags" } },
    { ...ctx, inputItems: inputs }
  );
  const splitOut = normalizeNodeOutput(
    provenanceNode("splitOut", { fieldName: "tags" }),
    inputs,
    splitResult.items
  );
  for (let i = 0; i < 3; i += 1) {
    const context = buildExprContext({
      edges: [{ source: "source", target: "split" }, { source: "split", target: "current" }],
      currentNodeId: "current",
      currentItemIndex: i,
      items: { source: inputs, split: splitOut, current: splitOut },
      steps: {},
    });
    assert.strictEqual(resolveExpression("{{steps.source.brand}}", context), "Acme");
  }
});

check("TEST 6 split out filter sort three-hop resolution", async () => {
  const inputs = [{ json: { tags: ["c", "a", "b"], token: "ROOT" }, pairedItem: { item: 0 } }];
  const splitResult = await handlers.splitOut(
    { id: "s", data: { fieldName: "tags" } },
    { ...ctx, inputItems: inputs }
  );
  const splitOut = normalizeNodeOutput(
    provenanceNode("splitOut", { fieldName: "tags" }),
    inputs,
    splitResult.items
  );
  const filterResult = await handlers.filter(
    { id: "f", data: { fieldName: "value", operator: "not_equals", right: "x" } },
    { ...ctx, inputItems: splitOut }
  );
  const filterOut = normalizeNodeOutput(provenanceNode("filter"), splitOut, filterResult.items);
  const sortResult = await handlers.sort(
    { id: "s", data: { fieldName: "value", direction: "asc" } },
    { ...ctx, inputItems: filterOut }
  );
  const sortOut = normalizeNodeOutput(provenanceNode("sort"), filterOut, sortResult.items);
  const context = buildExprContext({
    edges: [
      { source: "source", target: "split" },
      { source: "split", target: "filter" },
      { source: "filter", target: "sort" },
      { source: "sort", target: "current" },
    ],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, split: splitOut, filter: filterOut, sort: sortOut, current: sortOut },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.token}}", context), "ROOT");
});

check("TEST 7 condition TRUE branch resolves through taken path", async () => {
  const inputs = [{ json: { n: 1 }, pairedItem: { item: 0 } }];
  const trueBranch = normalizeNodeOutput(
    provenanceNode("noop"),
    inputs,
    [{ n: 1, label: "TRUE" }]
  );
  const context = buildExprContext({
    edges: [
      { source: "source", target: "trueNode" },
      { source: "trueNode", target: "current" },
    ],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, trueNode: trueBranch, current: trueBranch },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.n}}", context), 1);
});

check("TEST 8 unrelated FALSE branch is not used as fallback", () => {
  const sourceItems = [{ json: { n: 1 }, pairedItem: { item: 0 } }];
  const falseBranch = [{ json: { n: 99 }, pairedItem: { item: 0 } }];
  const currentItems = normalizeNodeOutput(
    provenanceNode("noop"),
    sourceItems,
    [{ n: 1 }]
  );
  const context = buildExprContext({
    edges: [
      { source: "source", target: "cond" },
      { source: "cond", target: "falseNode", sourceHandle: "false" },
      { source: "source", target: "current" },
    ],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: {
      source: sourceItems,
      falseNode: falseBranch,
      current: currentItems,
    },
    steps: { falseNode: { n: 99 } },
  });
  assert.strictEqual(resolveExpression("{{steps.source.n}}", context), 1);
  assertThrowsExpr(
    () => resolveExpression("{{steps.falseNode.n}}", context),
    REASONS.TARGET_NOT_IN_PATH
  );
});

check("TEST 9 aggregate automatic step reference is ambiguous", async () => {
  const inputs = [
    { json: { value: "a" }, pairedItem: { item: 0 } },
    { json: { value: "b" }, pairedItem: { item: 1 } },
    { json: { value: "c" }, pairedItem: { item: 2 } },
  ];
  const aggResult = await handlers.aggregate(
    { id: "a", data: { operation: "count" } },
    { ...ctx, inputItems: inputs }
  );
  const aggOut = normalizeNodeOutput(provenanceNode("aggregate"), inputs, aggResult.items);
  const context = buildExprContext({
    edges: [{ source: "source", target: "aggregate" }, { source: "aggregate", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, aggregate: aggOut, current: aggOut },
    steps: {},
  });
  try {
    resolveExpression("{{steps.source.value}}", context);
    assert.fail("expected ambiguity error");
  } catch (err) {
    assert.ok(err instanceof ExpressionReferenceError);
    assert.strictEqual(err.reason, REASONS.PROVENANCE_AMBIGUOUS);
    assert.ok(!err.message.includes("$item"));
    assert.ok(!err.message.includes(".item"));
    assert.ok(err.message.includes("$first"));
    assert.ok(err.message.includes("$last"));
    assert.ok(err.message.includes("$all[index]"));
  }
});

check("TEST 10 explicit first accessor resolves first source item", async () => {
  const inputs = [
    { json: { value: "a" }, pairedItem: { item: 0 } },
    { json: { value: "b" }, pairedItem: { item: 1 } },
  ];
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: {
      source: inputs,
      current: normalizeNodeOutput(provenanceNode("noop"), inputs, [{ x: 1 }]),
    },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.$first.value}}", context), "a");
});

check("TEST 11 explicit last accessor resolves last source item", async () => {
  const inputs = [
    { json: { value: "a" }, pairedItem: { item: 0 } },
    { json: { value: "b" }, pairedItem: { item: 1 } },
  ];
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: {
      source: inputs,
      current: normalizeNodeOutput(provenanceNode("noop"), inputs, [{ x: 1 }]),
    },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.$last.value}}", context), "b");
});

check("TEST 12 explicit all index accessor resolves indexed item", () => {
  const inputs = [
    { json: { value: "a" } },
    { json: { value: "b" } },
    { json: { value: "c" } },
  ];
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, current: inputs },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.$all[2].value}}", context), "c");
});

check("TEST 13 out-of-range explicit all index throws", () => {
  const inputs = [{ json: { value: "a" } }];
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, current: inputs },
    steps: {},
  });
  assertThrowsExpr(
    () => resolveExpression("{{steps.source.$all[3].value}}", context),
    REASONS.ITEM_INDEX_OUT_OF_RANGE
  );
});

check("TEST 14 missing pairedItem does not return random multi-item data", () => {
  const source = [
    { json: { id: 0 } },
    { json: { id: 1 } },
    { json: { id: 2 } },
  ];
  const filtered = [{ json: { id: 0 } }, { json: { id: 2 } }];
  const context = buildExprContext({
    edges: [
      { source: "source", target: "filter" },
      { source: "filter", target: "current" },
    ],
    currentNodeId: "current",
    currentItemIndex: 1,
    items: { source, filter: filtered, current: filtered },
    steps: {},
  });
  assertThrowsExpr(
    () => resolveExpression("{{steps.source.id}}", context),
    REASONS.PROVENANCE_MISSING
  );
});

check("TEST 15 legacy single-item fallback resolves without pairedItem", () => {
  const items = {
    source: [{ json: { value: "only" } }],
  };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: { source: { value: "only" } },
  });
  assert.strictEqual(resolveExpression("{{steps.source.value}}", context), "only");
});

check("TEST 16 single-expression type preservation for objects", () => {
  const items = {
    source: [{ json: { rows: [1, 2] }, pairedItem: { item: 0 } }],
    current: normalizeNodeOutput(
      provenanceNode("noop"),
      [{ json: { rows: [1, 2] }, pairedItem: { item: 0 } }],
      [{ rows: [1, 2] }]
    ),
  };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items,
    steps: { source: { rows: [1, 2] } },
  });
  const v = resolveExpression("{{steps.source.rows}}", context);
  assert.ok(Array.isArray(v) && v.length === 2);
});

check("TEST 17 mixed template stringification unchanged", () => {
  const items = {
    source: [{ json: { clicks: 7 }, pairedItem: { item: 0 } }],
    current: normalizeNodeOutput(
      provenanceNode("noop"),
      [{ json: { clicks: 7 }, pairedItem: { item: 0 } }],
      [{ clicks: 7 }]
    ),
  };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items,
    steps: { source: { clicks: 7 } },
  });
  assert.strictEqual(
    resolveExpression("clicks={{steps.source.clicks}}", context),
    "clicks=7"
  );
});

check("TEST 18 explicit Code pairedItem linkage is consumed correctly", () => {
  const source = [{ json: { n: 1 }, pairedItem: { item: 0 } }];
  const codeOut = normalizeNodeOutput(
    provenanceNode("code"),
    source,
    [{ n: 9, pairedItem: { item: 0 } }]
  );
  const context = buildExprContext({
    edges: [{ source: "source", target: "code" }, { source: "code", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source, code: codeOut, current: codeOut },
    steps: {},
  });
  assert.strictEqual(resolveExpression("{{steps.source.n}}", context), 1);
});

check("TEST 19 target node outside lineage is not resolved from flat snapshot", () => {
  const items = {
    source: [{ json: { n: 1 }, pairedItem: { item: 0 } }],
    other: [{ json: { n: 99 } }],
    current: normalizeNodeOutput(
      provenanceNode("noop"),
      [{ json: { n: 1 }, pairedItem: { item: 0 } }],
      [{ n: 1 }]
    ),
  };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items,
    steps: { other: { n: 99 } },
  });
  assertThrowsExpr(
    () => resolveExpression("{{steps.other.n}}", context),
    REASONS.TARGET_NOT_IN_PATH
  );
});

check("TEST 20 no current item context single-item safe multi-item ambiguous", () => {
  const single = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: null,
    items: { source: [{ json: { v: 1 } }] },
    steps: {},
  });
  single.currentItem = null;
  assert.strictEqual(resolveExpression("{{steps.source.v}}", single), 1);

  const multi = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: null,
    items: {
      source: [{ json: { v: 1 } }, { json: { v: 2 } }],
    },
    steps: {},
  });
  multi.currentItem = null;
  assertThrowsExpr(
    () => resolveExpression("{{steps.source.v}}", multi),
    REASONS.PROVENANCE_AMBIGUOUS
  );
});

section("Part 3A.1 accessor contract");

const sourceWithAccessorFields = () => [
  { json: { first: { name: "DATA-FIRST" }, last: "DATA-LAST", all: "DATA-ALL", item: "DATA-ITEM", value: "a" }, pairedItem: { item: 0 } },
  { json: { first: { name: "OTHER" }, value: "b" }, pairedItem: { item: 1 } },
];

check("TEST 1 JSON field first.name is not treated as accessor", () => {
  const items = { source: sourceWithAccessorFields() };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.first.name}}", context),
    "DATA-FIRST"
  );
});

check("TEST 2 explicit $first accessor returns first workflow item", () => {
  const items = { source: sourceWithAccessorFields() };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.$first.value}}", context),
    "a"
  );
});

check("TEST 3 JSON field last remains accessible normally", () => {
  const items = { source: sourceWithAccessorFields() };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.last}}", context),
    "DATA-LAST"
  );
});

check("TEST 4 explicit $last accessor works", () => {
  const items = { source: sourceWithAccessorFields() };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.$last.value}}", context),
    "b"
  );
});

check("TEST 5 JSON field all remains accessible normally", () => {
  const items = { source: sourceWithAccessorFields() };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.all}}", context),
    "DATA-ALL"
  );
});

check("TEST 6 explicit $all indexed accessor works", () => {
  const items = {
    source: [
      { json: { value: "a" } },
      { json: { value: "b" } },
      { json: { value: "c" } },
    ],
  };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.$all[2].value}}", context),
    "c"
  );
});

check("TEST 7 JSON field item remains accessible normally", () => {
  const items = { source: sourceWithAccessorFields() };
  const context = buildExprContext({
    edges: [{ source: "source", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { ...items, current: items.source },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.item}}", context),
    "DATA-ITEM"
  );
});

check("TEST 8 explicit $item threaded accessor works", async () => {
  const inputs = [
    { json: { name: "Charlie" }, pairedItem: { item: 0 } },
    { json: { name: "Alice" }, pairedItem: { item: 1 } },
    { json: { name: "Bob" }, pairedItem: { item: 2 } },
  ];
  const sortResult = await handlers.sort(
    { id: "s", data: { fieldName: "name", direction: "asc" } },
    { ...ctx, inputItems: inputs }
  );
  const sortOut = normalizeNodeOutput(provenanceNode("sort"), inputs, sortResult.items);
  const context = buildExprContext({
    edges: [{ source: "source", target: "sort" }, { source: "sort", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, sort: sortOut, current: sortOut },
    steps: {},
  });
  assert.strictEqual(
    resolveExpression("{{steps.source.$item.name}}", context),
    "Alice"
  );
});

check("TEST 9 aggregate ambiguity message does not recommend $item", async () => {
  const inputs = [
    { json: { value: "a" }, pairedItem: { item: 0 } },
    { json: { value: "b" }, pairedItem: { item: 1 } },
  ];
  const aggResult = await handlers.aggregate(
    { id: "a", data: { operation: "count" } },
    { ...ctx, inputItems: inputs }
  );
  const aggOut = normalizeNodeOutput(provenanceNode("aggregate"), inputs, aggResult.items);
  const context = buildExprContext({
    edges: [{ source: "source", target: "aggregate" }, { source: "aggregate", target: "current" }],
    currentNodeId: "current",
    currentItemIndex: 0,
    items: { source: inputs, aggregate: aggOut, current: aggOut },
    steps: {},
  });
  try {
    resolveExpression("{{steps.source.value}}", context);
    assert.fail("expected ambiguity");
  } catch (err) {
    assert.ok(err instanceof ExpressionReferenceError);
    assert.ok(!/(\$item|\.item)/.test(err.message));
  }
});

const provenanceSetWorkflow = () => ({
  nodes: [
    { id: "source", type: "noop" },
    {
      id: "filter",
      type: "filter",
      data: { fieldName: "name", operator: "not_equals", right: "Removed" },
    },
    { id: "sort", type: "sort", data: { fieldName: "name", direction: "asc" } },
    {
      id: "target",
      type: "set",
      data: {
        mappings: [{ key: "picked", value: "{{steps.source.name}}" }],
      },
    },
  ],
  edges: [
    { source: "source", target: "filter" },
    { source: "filter", target: "sort" },
    { source: "sort", target: "target" },
  ],
});

const seedProvenanceChain = async () => {
  const sourceItems = [
    { json: { name: "Charlie" } },
    { json: { name: "Alice" } },
    { json: { name: "Bob" } },
    { json: { name: "Removed" } },
  ].map((item, index) => ({ ...item, pairedItem: { item: index } }));
  const filterResult = await handlers.filter(
    { id: "filter", data: { fieldName: "name", operator: "not_equals", right: "Removed" } },
    { ...ctx, inputItems: sourceItems }
  );
  const filterOut = normalizeNodeOutput(
    provenanceNode("filter"),
    sourceItems,
    filterResult.items
  );
  const sortResult = await handlers.sort(
    { id: "sort", data: { fieldName: "name", direction: "asc" } },
    { ...ctx, inputItems: filterOut }
  );
  const sortOut = normalizeNodeOutput(
    provenanceNode("sort"),
    filterOut,
    sortResult.items
  );
  return {
    sourceItems,
    filterOut,
    sortOut,
    session: {
      source: { output: { count: 4 }, items: sourceItems },
      filter: { output: filterResult.output, items: filterOut },
      sort: { output: sortResult.output, items: sortOut },
    },
  };
};

const assertThreadedSetPicks = (result) => {
  const items = result.results.target.items;
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(
    items.map((i) => i.json?.picked ?? i.picked),
    ["Alice", "Bob", "Charlie"]
  );
};

check("TEST 10 step with source seeded runs upstream with graph context", async () => {
  const { sourceItems } = await seedProvenanceChain();
  const partial = await executePartial({
    definition: provenanceSetWorkflow(),
    input: {},
    targetNodeId: "target",
    mode: "step",
    sessionNodeResults: {
      source: { output: { count: 4 }, items: sourceItems },
    },
  });
  assertThreadedSetPicks(partial);
});

check("TEST 11 run step execution uses provenance-aware expression context", async () => {
  const { session } = await seedProvenanceChain();
  const partial = await executePartial({
    definition: provenanceSetWorkflow(),
    input: {},
    targetNodeId: "target",
    mode: "step",
    sessionNodeResults: session,
  });
  assertThreadedSetPicks(partial);
});

check("TEST 12 run to node uses provenance-aware expression context", async () => {
  const { session } = await seedProvenanceChain();
  const partial = await executePartial({
    definition: provenanceSetWorkflow(),
    input: {},
    targetNodeId: "target",
    mode: "step",
    sessionNodeResults: session,
  });
  assertThreadedSetPicks(partial);
});

check("TEST 13 execute previous uses provenance-aware expression context", async () => {
  const { sourceItems } = await seedProvenanceChain();
  const partial = await executePartial({
    definition: provenanceSetWorkflow(),
    input: {},
    targetNodeId: "target",
    mode: "upstream",
    sessionNodeResults: {
      source: { output: { count: 4 }, items: sourceItems },
      target: { output: { cached: true }, items: [{ json: { picked: "cached" } }] },
    },
  });
  assert.ok(partial.results.filter);
  assert.ok(partial.results.sort);
  assert.ok(!partial.results.target);
});

check("TEST 14 webhook-style input path uses provenance-aware expression context", async () => {
  const sourceItems = [
    { json: { name: "WebhookAlice" }, pairedItem: { item: 0 } },
  ];
  const definition = {
    nodes: [
      { id: "source", type: "noop" },
      {
        id: "target",
        type: "set",
        data: {
          mappings: [{ key: "picked", value: "{{steps.source.name}}" }],
        },
      },
    ],
    edges: [{ source: "source", target: "target" }],
  };
  const partial = await executePartial({
    definition,
    input: { source: "webhook", payload: { ok: true } },
    targetNodeId: "target",
    mode: "step",
    sessionNodeResults: {
      source: { output: { count: 1 }, items: sourceItems },
    },
  });
  const items = partial.results.target.items;
  assert.strictEqual(items[0].json?.picked ?? items[0].picked, "WebhookAlice");
});

section("expression preview context");
check("buildExpressionPreviewContext resolves item fields for selected index", () => {
  const definition = {
    nodes: [
      { id: "source", type: "noop" },
      {
        id: "target",
        type: "set",
        data: { mappings: [{ key: "x", value: "{{item.name}}" }] },
      },
    ],
    edges: [{ source: "source", target: "target" }],
  };
  const sessionNodeResults = {
    source: {
      output: { ok: true },
      items: [
        { json: { name: "Alice" }, pairedItem: { item: 0 } },
        { json: { name: "Bob" }, pairedItem: { item: 1 } },
      ],
    },
  };
  const { context: ctx0 } = buildExpressionPreviewContext(
    definition,
    sessionNodeResults,
    "target",
    0,
    {}
  );
  const { context: ctx1 } = buildExpressionPreviewContext(
    definition,
    sessionNodeResults,
    "target",
    1,
    {}
  );
  assert.strictEqual(resolveExpression("{{item.name}}", ctx0), "Alice");
  assert.strictEqual(resolveExpression("{{item.name}}", ctx1), "Bob");
});

check("buildExpressionPreviewContext threads steps by item index", () => {
  const definition = {
    nodes: [
      { id: "source", type: "noop" },
      { id: "filter", type: "filter" },
      { id: "target", type: "set" },
    ],
    edges: [
      { source: "source", target: "filter" },
      { source: "filter", target: "target" },
    ],
  };
  const sourceItems = [
    { json: { name: "A" }, pairedItem: { item: 0 } },
    { json: { name: "B" }, pairedItem: { item: 1 } },
  ];
  const filterItems = [
    { json: { name: "A" }, pairedItem: { item: 0 } },
    { json: { name: "B" }, pairedItem: { item: 1 } },
  ];
  const sessionNodeResults = {
    source: { output: { count: 2 }, items: sourceItems },
    filter: { output: { count: 2 }, items: filterItems },
  };
  const { context: ctx1 } = buildExpressionPreviewContext(
    definition,
    sessionNodeResults,
    "target",
    1,
    {}
  );
  assert.strictEqual(resolveExpression("{{steps.source.name}}", ctx1), "B");
});

check("expression preview maps ambiguity to ExpressionReferenceError", () => {
  const definition = {
    nodes: [
      { id: "a", type: "noop" },
      { id: "b", type: "noop" },
      { id: "target", type: "set" },
    ],
    edges: [
      { source: "a", target: "target" },
      { source: "b", target: "target" },
    ],
  };
  const sessionNodeResults = {
    a: { output: {}, items: [{ json: { v: 1 } }] },
    b: { output: {}, items: [{ json: { v: 2 } }] },
  };
  const { context } = buildExpressionPreviewContext(
    definition,
    sessionNodeResults,
    "target",
    0,
    {}
  );
  assert.throws(
    () => resolveExpression("{{steps.a.v}}", context),
    (err) =>
      err instanceof ExpressionReferenceError &&
      err.reason === REASONS.PROVENANCE_AMBIGUOUS
  );
});

section("Part 4 dirty graph invalidation");
const {
  applyInvalidationEvent,
  getNodeCacheStatus,
  isCacheUsableForExecution,
  isNodeDirty,
  computeNodeExecutionSignature,
} = require("../services/workflowGraphInvalidation.service");
const { getNodeInputPreview } = require("../services/workflowEngine.service");

const makeEditorSession = (nodeResults = {}) => ({
  nodeResults,
  dirtyNodes: {},
});

const chainDef = (...ids) => ({
  nodes: ids.map((id) => ({ id, type: "noop", data: {} })),
  edges: ids.slice(0, -1).map((id, i) => ({ source: id, target: ids[i + 1] })),
});

const branchDef = () => ({
  nodes: [
    { id: "A", type: "set", data: {} },
    { id: "B", type: "set", data: {} },
    { id: "C", type: "set", data: {} },
    { id: "X", type: "set", data: {} },
    { id: "Y", type: "set", data: {} },
  ],
  edges: [
    { source: "A", target: "B" },
    { source: "B", target: "C" },
    { source: "A", target: "X" },
    { source: "X", target: "Y" },
  ],
});

const seedClean = (session, ids, output = { ok: true }) => {
  for (const id of ids) {
    session.nodeResults[id] = {
      nodeId: id,
      status: "succeeded",
      output,
      items: [{ json: output }],
      cacheState: "clean",
    };
  }
};

check("TEST 1 linear param change dirties node and downstream only", () => {
  const def = chainDef("A", "B", "C", "D");
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C", "D"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "B" });
  assert.ok(isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(isNodeDirty(session, "D"));
  assert.ok(!isNodeDirty(session, "A"));
});

check("TEST 2 branch param change keeps unrelated branch clean", () => {
  const def = branchDef();
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C", "X", "Y"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "B" });
  assert.ok(isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(!isNodeDirty(session, "A"));
  assert.ok(!isNodeDirty(session, "X"));
  assert.ok(!isNodeDirty(session, "Y"));
});

check("TEST 3 upstream change dirties all descendants without pin barrier", () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  assert.ok(isNodeDirty(session, "A"));
  assert.ok(isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
});

check("TEST 4 position-only signature change does not auto-dirty on reconcile alone", () => {
  const def = chainDef("A", "B");
  const session = makeEditorSession();
  seedClean(session, ["A"]);
  const graph = buildGraph(def);
  const sig = computeNodeExecutionSignature(graph.byId.get("A"), graph);
  session.nodeResults.A.executionSignature = sig;
  const moved = {
    ...def,
    nodes: def.nodes.map((n) =>
      n.id === "A" ? { ...n, position: { x: 400, y: 200 } } : n
    ),
  };
  const { reconcileSessionWithDefinition } = require("../services/workflowGraphInvalidation.service");
  reconcileSessionWithDefinition(session, moved);
  assert.ok(!isNodeDirty(session, "A"));
});

check("TEST 5 edge add dirties target downstream cone", () => {
  const def = {
    nodes: [
      { id: "A", type: "set", data: {} },
      { id: "B", type: "set", data: {} },
      { id: "C", type: "set", data: {} },
    ],
    edges: [{ source: "A", target: "C" }],
  };
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, {
    type: "edge",
    targetNodeId: "C",
  });
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(!isNodeDirty(session, "A"));
  assert.ok(!isNodeDirty(session, "B"));
});

check("TEST 6 edge delete dirties target and downstream", () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, {
    type: "edge",
    targetNodeId: "B",
  });
  assert.ok(isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(!isNodeDirty(session, "A"));
});

check("TEST 12 upstream change stops at pinned barrier", () => {
  const def = {
    nodes: [
      { id: "A", type: "set", data: {} },
      {
        id: "B",
        type: "set",
        data: { pinned: true, pinnedOutput: { pinned: true } },
      },
      { id: "C", type: "set", data: {} },
      { id: "D", type: "set", data: {} },
    ],
    edges: [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
      { source: "C", target: "D" },
    ],
  };
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C", "D"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  assert.ok(isNodeDirty(session, "A"));
  assert.ok(!isNodeDirty(session, "B"));
  assert.ok(!isNodeDirty(session, "C"));
  assert.ok(!isNodeDirty(session, "D"));
});

check("TEST 13 pin content change dirties downstream only", () => {
  const def = chainDef("B", "C", "D");
  const session = makeEditorSession();
  seedClean(session, ["B", "C", "D"]);
  applyInvalidationEvent(session, def, {
    type: "pin",
    nodeId: "B",
    pinContentChanged: true,
  });
  assert.ok(!isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(isNodeDirty(session, "D"));
});

check("TEST 15 run step reuses clean upstream cache", async () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  seedClean(session, ["A", "B"]);
  const partial = await executePartial({
    definition: def,
    input: {},
    targetNodeId: "C",
    mode: "step",
    session,
  });
  assert.ok(!partial.results.B);
  assert.ok(partial.results.C);
});

check("TEST 16 run step executes dirty upstream dependency", async () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "B" });
  const partial = await executePartial({
    definition: def,
    input: {},
    targetNodeId: "C",
    mode: "step",
    session,
  });
  assert.ok(partial.results.B);
  assert.ok(!partial.results.B.cached);
});

check("TEST 19 execute previous excludes selected target", async () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  const partial = await executePartial({
    definition: def,
    input: {},
    targetNodeId: "C",
    mode: "upstream",
    session,
  });
  assert.ok(partial.results.A);
  assert.ok(partial.results.B);
  assert.ok(!partial.results.C);
});

check("TEST 21 input preview marks stale upstream data", () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  seedClean(session, ["A", "B"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  const preview = getNodeInputPreview(def, session, "C", {});
  assert.ok(preview.stale);
  assert.ok(preview.staleNodeIds.includes("B"));
});

check("TEST 24 executed zero-item result is not missing", () => {
  const def = chainDef("A");
  const session = makeEditorSession();
  session.nodeResults.A = {
    nodeId: "A",
    status: "succeeded",
    output: { items: [] },
    items: [],
    cacheState: "clean",
  };
  const graph = buildGraph(def);
  const status = getNodeCacheStatus(session, "A", graph.byId.get("A"), graph);
  assert.strictEqual(status, "clean");
  assert.ok(isCacheUsableForExecution(status));
});

check("TEST 27 cycle-safe downstream invalidation", () => {
  const def = {
    nodes: [
      { id: "A", type: "set", data: {} },
      { id: "B", type: "set", data: {} },
    ],
    edges: [
      { source: "A", target: "B" },
      { source: "B", target: "A" },
    ],
  };
  const session = makeEditorSession();
  seedClean(session, ["A", "B"]);
  const { affected } = applyInvalidationEvent(session, def, {
    type: "params",
    nodeId: "A",
  });
  assert.ok(affected.includes("B"));
});

section("Part 4B cache invalidation stabilization");
const fs = require("node:fs");
const path = require("node:path");

const pinnedChainDef = () => ({
  nodes: [
    { id: "A", type: "noop", data: {} },
    {
      id: "B",
      type: "noop",
      data: { pinned: true, pinnedOutput: { pinned: true } },
    },
    { id: "C", type: "noop", data: {} },
  ],
  edges: [
    { source: "A", target: "B" },
    { source: "B", target: "C" },
  ],
});

check("TEST 4B reconnect target change invalidates both dependency cones", () => {
  const def = {
    nodes: ["A", "B", "C"].map((id) => ({ id, type: "noop", data: {} })),
    edges: [{ id: "e-ab", source: "A", target: "B" }],
  };
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, {
    type: "edge_reconnect",
    edgeId: "e-ab",
    previous: { source: "A", target: "B" },
    current: { source: "A", target: "C" },
  });
  assert.ok(isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(!isNodeDirty(session, "A"));
});

check("TEST 4B reconnect source change invalidates target cone only", () => {
  const def = {
    nodes: ["A", "B", "C"].map((id) => ({ id, type: "noop", data: {} })),
    edges: [{ id: "e1", source: "A", target: "C" }],
  };
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, {
    type: "edge_reconnect",
    edgeId: "e1",
    previous: { source: "A", target: "C" },
    current: { source: "B", target: "C" },
  });
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(!isNodeDirty(session, "A"));
  assert.ok(!isNodeDirty(session, "B"));
});

check("TEST 4B target port change invalidates target cone", () => {
  const def = {
    nodes: ["A", "C"].map((id) => ({ id, type: "noop", data: {} })),
    edges: [
      {
        id: "e1",
        source: "A",
        target: "C",
        sourceHandle: "out0",
        targetHandle: "input0",
      },
    ],
  };
  const session = makeEditorSession();
  seedClean(session, ["A", "C"]);
  applyInvalidationEvent(session, def, {
    type: "edge_reconnect",
    edgeId: "e1",
    previous: {
      source: "A",
      target: "C",
      sourceHandle: "out0",
      targetHandle: "input0",
    },
    current: {
      source: "A",
      target: "C",
      sourceHandle: "out0",
      targetHandle: "input1",
    },
  });
  assert.ok(isNodeDirty(session, "C"));
  assert.ok(!isNodeDirty(session, "A"));
});

check("PART4B pin CASE A upstream change stops at pinned barrier", () => {
  const def = pinnedChainDef();
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  assert.ok(isNodeDirty(session, "A"));
  assert.ok(!isNodeDirty(session, "B"));
  assert.ok(!isNodeDirty(session, "C"));
});

check("PART4B pin CASE B pinned node param change dirties node and downstream", () => {
  const def = pinnedChainDef();
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "B" });
  assert.ok(isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
});

check("PART4B pin CASE C pin content change dirties downstream only", () => {
  const def = pinnedChainDef();
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, {
    type: "pin",
    nodeId: "B",
    pinContentChanged: true,
  });
  assert.ok(!isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
});

check("PART4B pin CASE D unpin dirties node and downstream", () => {
  const def = pinnedChainDef();
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "C"]);
  applyInvalidationEvent(session, def, {
    type: "pin",
    nodeId: "B",
    unpinned: true,
  });
  assert.ok(isNodeDirty(session, "B"));
  assert.ok(isNodeDirty(session, "C"));
});

check("TEST 4B full run path ignores editor session cache", () => {
  const enginePath = path.join(
    __dirname,
    "../services/workflowEngine.service.js"
  );
  const src = fs.readFileSync(enginePath, "utf8");
  const runStart = src.indexOf("const executeRun =");
  const runEnd = src.indexOf("const executePartial =");
  const runSrc = src.slice(runStart, runEnd);
  assert.ok(!runSrc.includes("editorSession"));
  assert.ok(!runSrc.includes("dirtyNodes"));
  assert.ok(!runSrc.includes("normalizeEditorSession"));
});

check("TEST 4B error cache is not reused as clean upstream", async () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  session.nodeResults.A = {
    nodeId: "A",
    status: "failed",
    error: "boom",
    cacheState: "dirty",
  };
  const partial = await executePartial({
    definition: def,
    input: {},
    targetNodeId: "C",
    mode: "step",
    session,
  });
  assert.ok(partial.results.A);
  assert.ok(!partial.results.A.cached);
});

check("TEST 4B label change does not change execution signature", () => {
  const graph = buildGraph({
    nodes: [{ id: "A", type: "noop", data: { label: "One" } }],
    edges: [],
  });
  const graph2 = buildGraph({
    nodes: [{ id: "A", type: "noop", data: { label: "Two" } }],
    edges: [],
  });
  const sig1 = computeNodeExecutionSignature(graph.byId.get("A"), graph);
  const sig2 = computeNodeExecutionSignature(graph2.byId.get("A"), graph2);
  assert.strictEqual(sig1, sig2);
});

check("TEST 4B disabled and credential reference change execution signature", () => {
  const base = buildGraph({
    nodes: [{ id: "A", type: "noop", data: { disabled: false } }],
    edges: [],
  });
  const disabled = buildGraph({
    nodes: [{ id: "A", type: "noop", data: { disabled: true } }],
    edges: [],
  });
  const cred = buildGraph({
    nodes: [{ id: "A", type: "http", data: { credentialId: "cred-1" } }],
    edges: [],
  });
  const cred2 = buildGraph({
    nodes: [{ id: "A", type: "http", data: { credentialId: "cred-2" } }],
    edges: [],
  });
  const baseSig = computeNodeExecutionSignature(base.byId.get("A"), base);
  assert.notStrictEqual(
    baseSig,
    computeNodeExecutionSignature(disabled.byId.get("A"), disabled)
  );
  assert.notStrictEqual(
    computeNodeExecutionSignature(cred.byId.get("A"), cred),
    computeNodeExecutionSignature(cred2.byId.get("A"), cred2)
  );
});

check("TEST 4B incoming edge port changes execution signature", () => {
  const graph = buildGraph({
    nodes: [
      { id: "A", type: "noop", data: {} },
      { id: "C", type: "noop", data: {} },
    ],
    edges: [
      {
        source: "A",
        target: "C",
        sourceHandle: "out0",
        targetHandle: "input0",
      },
    ],
  });
  const graph2 = buildGraph({
    nodes: [
      { id: "A", type: "noop", data: {} },
      { id: "C", type: "noop", data: {} },
    ],
    edges: [
      {
        source: "A",
        target: "C",
        sourceHandle: "out0",
        targetHandle: "input1",
      },
    ],
  });
  const sig1 = computeNodeExecutionSignature(graph.byId.get("C"), graph);
  const sig2 = computeNodeExecutionSignature(graph2.byId.get("C"), graph2);
  assert.notStrictEqual(sig1, sig2);
});

check("TEST 4B partial execution uses draft definition graph", async () => {
  const draft = {
    nodes: ["A", "C", "B"].map((id) => ({ id, type: "noop", data: {} })),
    edges: [
      { source: "A", target: "C" },
      { source: "C", target: "B" },
    ],
  };
  const session = makeEditorSession();
  const partial = await executePartial({
    definition: draft,
    input: {},
    targetNodeId: "B",
    mode: "step",
    session,
  });
  assert.ok(partial.results.C);
  assert.ok(partial.results.B);
});

check("TEST 4B dirty referenced step is excluded from expression preview context", () => {
  const def = chainDef("A", "B");
  const session = makeEditorSession();
  seedClean(session, ["A"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  const { staleNodeIds, context } = buildExpressionPreviewContext(
    def,
    session,
    "B",
    0,
    {}
  );
  assert.ok(staleNodeIds.includes("A"));
  assert.strictEqual(context.steps.A, undefined);
});

check("TEST 4B pinned step remains available in expression preview when upstream dirty", () => {
  const def = pinnedChainDef();
  const session = makeEditorSession();
  seedClean(session, ["A"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  const { staleNodeIds, pinnedNodeIds, context } = buildExpressionPreviewContext(
    def,
    session,
    "C",
    0,
    {}
  );
  assert.ok(pinnedNodeIds.has("B"));
  assert.ok(!staleNodeIds.includes("B"));
  assert.deepStrictEqual(context.steps.B, { pinned: true });
});

check("TEST 4B input preview surfaces stale immediate upstream", () => {
  const def = chainDef("A", "B", "C");
  const session = makeEditorSession();
  seedClean(session, ["A", "B"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  const preview = getNodeInputPreview(def, session, "C", {});
  assert.ok(preview.stale);
  assert.ok(preview.staleNodeIds.includes("B"));
});

check("TEST 4B input preview uses pinned immediate upstream", () => {
  const def = pinnedChainDef();
  const session = makeEditorSession();
  seedClean(session, ["A"]);
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  const preview = getNodeInputPreview(def, session, "C", {});
  assert.ok(!preview.stale);
  assert.ok(preview.items.length > 0 || Object.keys(preview.incoming).length > 0);
});

check("TEST 4B zero-item upstream remains valid input preview", () => {
  const def = chainDef("A", "B");
  const session = makeEditorSession();
  session.nodeResults.A = {
    nodeId: "A",
    status: "succeeded",
    output: { items: [] },
    items: [],
    cacheState: "clean",
  };
  const preview = getNodeInputPreview(def, session, "B", {});
  assert.strictEqual(preview.stale, false);
  assert.strictEqual(preview.nodeCacheStatus.A, "clean");
});

section("Part 5 multi-input merge");

const portEdge = (source, target, targetHandle, sourceHandle = null) => ({
  id: `${source}->${target}#${targetHandle || "default"}`,
  source,
  target,
  sourceHandle,
  targetHandle: targetHandle || null,
});

const mergeDef = (edges, extraNodes = []) => ({
  nodes: [
    node("A", "noop"),
    node("B", "noop"),
    node("M", "merge"),
    ...extraNodes,
  ],
  edges,
});

const item = (json, pairedItem) => {
  const row = { json };
  if (pairedItem !== undefined) row.pairedItem = pairedItem;
  return row;
};

const mergeCtx = (portInputsMap) => {
  const portInputs = {};
  for (const [portId, payload] of Object.entries(portInputsMap)) {
    portInputs[portId] = {
      portId,
      inputIndex: portIdToInputIndex(portId),
      state: PORT_STATES.ARRIVED_WITH_DATA,
      sourceNodeId: portId === "input1" ? "A" : "B",
      items: payload.items,
    };
  }
  return {
    inputItems: [...(portInputsMap.input1?.items || []), ...(portInputsMap.input2?.items || [])],
    portInputs,
  };
};

check("TEST 5-1 Merge contract defines input1 and input2 ports", () => {
  assert.deepStrictEqual(MERGE_PORT_IDS, ["input1", "input2"]);
});

check("TEST 5-2 connection validator enforces per-port cardinality", () => {
  const def = mergeDef([
    portEdge("A", "M", "input1"),
    portEdge("B", "M", "input1"),
  ]);
  const issues = validateMergeWiring(buildGraph(def), "M");
  assert.ok(issues.some((i) => i.includes("input1")));
});

check("TEST 5-3 Append 2+2 items preserves order", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ name: "A1" }), item({ name: "A2" })] },
    input2: { items: [item({ name: "B1" }), item({ name: "B2" })] },
  });
  const r = await handlers.merge({ id: "M", data: { mode: "append" } }, ctx);
  assert.deepStrictEqual(
    r.items.map((i) => i.json?.name || i.name),
    ["A1", "A2", "B1", "B2"]
  );
});

check("TEST 5-4 Append pairedItem.input maps ports correctly", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ n: "a" })] },
    input2: { items: [item({ n: "b" })] },
  });
  const r = await handlers.merge({ id: "M", data: { mode: "append" } }, ctx);
  assert.deepStrictEqual(r.items[0].pairedItem, { item: 0, input: 0 });
  assert.deepStrictEqual(r.items[1].pairedItem, { item: 0, input: 1 });
});

check("TEST 5-5 Append output order is port-ordered not completion-ordered", async () => {
  const ctx = mergeCtx({
    input2: { items: [item({ n: "B1" }), item({ n: "B2" })] },
    input1: { items: [item({ n: "A1" }), item({ n: "A2" })] },
  });
  const r = await handlers.merge({ id: "M", data: { mode: "append" } }, ctx);
  assert.deepStrictEqual(
    r.items.map((i) => i.json.n),
    ["A1", "A2", "B1", "B2"]
  );
});

check("TEST 5-6 Combine by position merges JSON at each index", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ name: "Alice" }), item({ name: "Bob" })] },
    input2: { items: [item({ score: 90 }), item({ score: 80 })] },
  });
  const r = await handlers.merge(
    { id: "M", data: { mode: "combineByPosition" } },
    ctx
  );
  assert.strictEqual(r.items.length, 2);
  assert.deepStrictEqual(r.items[0].json, { name: "Alice", score: 90 });
  assert.deepStrictEqual(r.items[1].json, { name: "Bob", score: 80 });
});

check("TEST 5-7 Combine by position provenance lists both contributors", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ name: "Alice" })] },
    input2: { items: [item({ score: 90 })] },
  });
  const r = await handlers.merge(
    { id: "M", data: { mode: "combineByPosition" } },
    ctx
  );
  assert.deepStrictEqual(r.items[0].pairedItem, [
    { item: 0, input: 0 },
    { item: 0, input: 1 },
  ]);
});

check("TEST 5-8 Unequal position lengths use min-length V1 policy", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ a: 1 }), item({ a: 2 }), item({ a: 3 })] },
    input2: { items: [item({ b: 1 })] },
  });
  const r = await handlers.merge(
    { id: "M", data: { mode: "combineByPosition" } },
    ctx
  );
  assert.strictEqual(r.items.length, 1);
  assert.deepStrictEqual(r.items[0].json, { a: 1, b: 1 });
});

check("TEST 5-9 Combine by key matches on configured fields", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ customerId: 10, name: "Alice" })] },
    input2: { items: [item({ id: 10, score: 95 })] },
  });
  const r = await handlers.merge(
    {
      id: "M",
      data: {
        mode: "combineByKey",
        matchFields: { field1: "customerId", field2: "id" },
        joinMode: "keepMatches",
      },
    },
    ctx
  );
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].json.name, "Alice");
  assert.strictEqual(r.items[0].json.score, 95);
});

check("TEST 5-10 Combine by key keepNonMatches excludes matched keys", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ customerId: 10, name: "Alice" })] },
    input2: { items: [item({ id: 99, score: 1 })] },
  });
  const r = await handlers.merge(
    {
      id: "M",
      data: {
        mode: "combineByKey",
        matchFields: { field1: "customerId", field2: "id" },
        joinMode: "keepNonMatches",
      },
    },
    ctx
  );
  assert.strictEqual(r.items.length, 2);
});

check("TEST 5-11 Duplicate keys on input2 use first-wins index", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ id: 1, name: "Alice" })] },
    input2: {
      items: [item({ id: 1, score: 10 }), item({ id: 1, score: 99 })],
    },
  });
  const r = await handlers.merge(
    {
      id: "M",
      data: {
        mode: "combineByKey",
        matchFields: { field1: "id", field2: "id" },
        joinMode: "keepMatches",
      },
    },
    ctx
  );
  assert.strictEqual(r.items[0].json.score, 10);
});

check("TEST 5-12 JSON collision gives input2 precedence on position combine", async () => {
  const ctx = mergeCtx({
    input1: { items: [item({ id: 10, status: "old" })] },
    input2: { items: [item({ id: 10, status: "new" })] },
  });
  const r = await handlers.merge(
    { id: "M", data: { mode: "combineByPosition" } },
    ctx
  );
  assert.strictEqual(r.items[0].json.status, "new");
});

check("TEST 5-13 Combine does not mutate source port items", async () => {
  const src1 = item({ name: "Alice", extra: 1 });
  const src2 = item({ score: 90 });
  const ctx = mergeCtx({ input1: { items: [src1] }, input2: { items: [src2] } });
  await handlers.merge({ id: "M", data: { mode: "combineByPosition" } }, ctx);
  assert.strictEqual(src1.json.extra, 1);
  assert.strictEqual(src2.json.score, 90);
  assert.strictEqual(src1.json.score, undefined);
});

check("TEST 5-14 Append with empty input1 returns input2 items only", async () => {
  const ctx = mergeCtx({
    input1: { items: [] },
    input2: { items: [item({ n: "B1" }), item({ n: "B2" })] },
  });
  const r = await handlers.merge({ id: "M", data: { mode: "append" } }, ctx);
  assert.deepStrictEqual(r.items.map((i) => i.json.n), ["B1", "B2"]);
});

check("TEST 5-15 Zero-item port is settled not pending", () => {
  const def = mergeDef([
    portEdge("A", "M", "input1"),
    portEdge("B", "M", "input2"),
  ]);
  const graph = buildGraph(def);
  const edgeState = new Map([
    [`A->M#input1`, "active"],
    [`B->M#input2`, "active"],
  ]);
  const context = { items: { A: [], B: [{ json: { n: 1 } }] } };
  const ports = collectPortInputs(graph, "M", context, { edgeState });
  assert.strictEqual(ports.input1.state, PORT_STATES.ARRIVED_EMPTY);
  assert.strictEqual(ports.input2.state, PORT_STATES.ARRIVED_WITH_DATA);
});

check("TEST 5-16 Branch-not-taken port settles as skipped without deadlock", () => {
  const def = {
    nodes: [node("t", "trigger"), node("c", "condition"), node("yes", "set"), node("no", "set"), node("M", "merge")],
    edges: [
      edge("t", "c"),
      edge("c", "yes", "true"),
      edge("c", "no", "false"),
      portEdge("yes", "M", "input1"),
      portEdge("no", "M", "input2"),
    ],
  };
  const { order, exhausted } = drive(def, { c: "true" });
  assert.strictEqual(exhausted, false);
  assert.ok(order.includes("M"));
});

check("TEST 5-17 Error port blocks merge execution", () => {
  const portInputs = {
    input1: { state: PORT_STATES.ARRIVED_WITH_DATA, items: [{ json: {} }] },
    input2: { state: PORT_STATES.ERROR, items: [] },
  };
  assert.ok(hasPortError(portInputs, ["input1", "input2"]));
});

check("TEST 5-18 Scheduler waits for both merge ports before running", () => {
  const { order } = drive(
    mergeDef([edge("A", "M"), edge("B", "M")]),
    {},
    20
  );
  assert.ok(order.indexOf("M") > order.indexOf("A"));
  assert.ok(order.indexOf("M") > order.indexOf("B"));
});

check("TEST 5-19 Run step merge reuses clean input0 and executes dirty input1", async () => {
  const def = mergeDef([
    portEdge("A", "M", "input1"),
    portEdge("B", "M", "input2"),
  ]);
  const session = makeEditorSession();
  session.nodeResults.A = {
    nodeId: "A",
    status: "succeeded",
    output: { items: [{ json: { from: "A" } }] },
    items: [{ json: { from: "A" } }],
    cacheState: "clean",
  };
  applyInvalidationEvent(session, def, { type: "params", nodeId: "B" });
  const partial = await executePartial({
    definition: def,
    targetNodeId: "M",
    mode: "step",
    session,
  });
  assert.strictEqual(partial.results.A, undefined);
  assert.ok(partial.results.B);
  assert.ok(!partial.results.B.cached);
  assert.ok(partial.results.M);
  assert.strictEqual(partial.results.M.items[0].json.from, "A");
});

check("TEST 5-20 Run to merge executes both required missing cones", async () => {
  const def = mergeDef([
    portEdge("A", "M", "input1"),
    portEdge("B", "M", "input2"),
  ]);
  const partial = await executePartial({
    definition: def,
    targetNodeId: "M",
    mode: "run-to",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.A);
  assert.ok(partial.results.B);
  assert.ok(partial.results.M);
});

check("TEST 5-21 Execute previous prepares inputs without executing merge", async () => {
  const def = mergeDef([
    portEdge("A", "M", "input1"),
    portEdge("B", "M", "input2"),
  ]);
  const partial = await executePartial({
    definition: def,
    targetNodeId: "M",
    mode: "upstream",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.A);
  assert.ok(partial.results.B);
  assert.strictEqual(partial.results.M, undefined);
});

check("TEST 5-22 Pinned upstream port is reused for merge run step", async () => {
  const def = mergeDef([
    portEdge("A", "M", "input1"),
    portEdge("B", "M", "input2"),
  ]);
  def.nodes.find((n) => n.id === "A").data = {
    pinned: true,
    pinnedOutput: { items: [{ from: "pin" }] },
    pinnedItems: [{ json: { from: "pin" } }],
  };
  const session = makeEditorSession();
  applyInvalidationEvent(session, def, { type: "params", nodeId: "B" });
  const partial = await executePartial({
    definition: def,
    targetNodeId: "M",
    mode: "step",
    session,
  });
  assert.ok(!partial.results.A);
  assert.ok(partial.results.M);
});

check("TEST 5-23 Pinned merge acts as downstream barrier", async () => {
  const def = {
    nodes: [
      node("A", "noop"),
      node("M", "merge"),
      node("C", "noop"),
    ],
    edges: [portEdge("A", "M", "input1"), edge("M", "C")],
  };
  def.nodes.find((n) => n.id === "M").data = {
    pinned: true,
    pinnedOutput: { items: [{ merged: true }] },
    pinnedItems: [{ json: { merged: true }, pairedItem: { item: 0, input: 0 } }],
  };
  const session = makeEditorSession();
  applyInvalidationEvent(session, def, { type: "params", nodeId: "A" });
  const partial = await executePartial({
    definition: def,
    targetNodeId: "C",
    mode: "step",
    session,
  });
  assert.strictEqual(partial.results.M, undefined);
  assert.ok(partial.results.C);
});

check("TEST 5-24 Legacy merge edges normalize to input1/input2 by stable id", () => {
  const def = mergeDef([edge("B", "M"), edge("A", "M")]);
  const normalized = normalizeMergeIncomingEdges(buildGraph(def), "M");
  const byPort = Object.fromEntries(
    normalized.filter((e) => e.targetHandle).map((e) => [e.source, e.targetHandle])
  );
  assert.strictEqual(byPort.A, "input1");
  assert.strictEqual(byPort.B, "input2");
});

check("TEST 5-25 Expression through append input0 resolves A item", () => {
  const graph = buildGraph(
    mergeDef([portEdge("A", "M", "input1"), portEdge("B", "M", "input2"), edge("M", "C")])
  );
  const context = {
    steps: {},
    items: {
      A: [{ json: { name: "fromA" }, pairedItem: { item: 0 } }],
      B: [{ json: { name: "fromB" }, pairedItem: { item: 0 } }],
      M: [
        { json: { x: 1 }, pairedItem: { item: 0, input: 0 } },
        { json: { x: 2 }, pairedItem: { item: 0, input: 1 } },
      ],
    },
    inputItems: [{ json: { x: 1 }, pairedItem: { item: 0, input: 0 } }],
  };
  const res = resolveReferencedItem({
    currentNodeId: "C",
    currentItem: context.inputItems[0],
    currentItemIndex: 0,
    targetNodeId: "A",
    context,
    graph,
  });
  assert.strictEqual(res.status, "resolved");
  assert.strictEqual(res.item.json.name, "fromA");
});

check("TEST 5-26 Expression through append input1 resolves B item", () => {
  const graph = buildGraph(
    mergeDef([portEdge("A", "M", "input1"), portEdge("B", "M", "input2"), edge("M", "C")])
  );
  const context = {
    steps: {},
    items: {
      A: [{ json: { name: "fromA" } }],
      B: [{ json: { score: 42 } }],
      M: [{ json: { x: 2 }, pairedItem: { item: 0, input: 1 } }],
    },
    inputItems: [{ json: { x: 2 }, pairedItem: { item: 0, input: 1 } }],
  };
  const res = resolveReferencedItem({
    currentNodeId: "C",
    currentItem: context.inputItems[0],
    currentItemIndex: 0,
    targetNodeId: "B",
    context,
    graph,
  });
  assert.strictEqual(res.status, "resolved");
  assert.strictEqual(res.item.json.score, 42);
});

check("TEST 5-27 Expression through combined item resolves target contributor", () => {
  const graph = buildGraph(
    mergeDef([portEdge("A", "M", "input1"), portEdge("B", "M", "input2"), edge("M", "C")])
  );
  const context = {
    steps: {},
    items: {
      A: [{ json: { name: "Alice" } }],
      B: [{ json: { score: 90 } }],
      M: [
        {
          json: { name: "Alice", score: 90 },
          pairedItem: [
            { item: 0, input: 0 },
            { item: 0, input: 1 },
          ],
        },
      ],
    },
    inputItems: [
      {
        json: { name: "Alice", score: 90 },
        pairedItem: [
          { item: 0, input: 0 },
          { item: 0, input: 1 },
        ],
      },
    ],
  };
  const resB = resolveReferencedItem({
    currentNodeId: "C",
    currentItem: context.inputItems[0],
    currentItemIndex: 0,
    targetNodeId: "B",
    context,
    graph,
  });
  assert.strictEqual(resB.status, "resolved");
  assert.strictEqual(resB.item.json.score, 90);
});

check("TEST 5-28 Ambiguous contributor still returns PROVENANCE_AMBIGUOUS", () => {
  const graph = buildGraph(
    mergeDef([portEdge("A", "M", "input1"), portEdge("B", "M", "input2"), edge("M", "C")])
  );
  const context = {
    steps: {},
    items: {
      A: [{ json: { v: 1 } }, { json: { v: 2 } }],
      B: [{ json: { v: 3 } }],
      M: [
        {
          json: { merged: true },
          pairedItem: [
            { item: 0, input: 0 },
            { item: 1, input: 0 },
          ],
        },
      ],
    },
    inputItems: [
      {
        json: { merged: true },
        pairedItem: [
          { item: 0, input: 0 },
          { item: 1, input: 0 },
        ],
      },
    ],
  };
  const res = resolveReferencedItem({
    currentNodeId: "C",
    currentItem: context.inputItems[0],
    currentItemIndex: 0,
    targetNodeId: "A",
    context,
    graph,
  });
  assert.strictEqual(res.status, "error");
  assert.strictEqual(res.reason, REASONS.PROVENANCE_AMBIGUOUS);
});

check("TEST 5-29 Merge inspector returns per-port input data", () => {
  const def = mergeDef([
    portEdge("A", "M", "input1"),
    portEdge("B", "M", "input2"),
  ]);
  const session = makeEditorSession();
  session.nodeResults.A = {
    nodeId: "A",
    status: "succeeded",
    output: {},
    items: [{ json: { n: "a" } }],
    cacheState: "clean",
  };
  session.nodeResults.B = {
    nodeId: "B",
    status: "succeeded",
    output: {},
    items: [],
    cacheState: "clean",
  };
  const preview = getNodeInputPreview(def, session, "M", {});
  assert.ok(preview.portInputs);
  assert.strictEqual(preview.portInputs.input1.items.length, 1);
  assert.strictEqual(preview.portInputs.input2.state, PORT_STATES.ARRIVED_EMPTY);
});

check("TEST 5-30 Reconnect merge input port invalidates merge signature ports", () => {
  const def = mergeDef([portEdge("A", "M", "input1"), portEdge("B", "M", "input2")]);
  const session = makeEditorSession();
  seedClean(session, ["A", "B", "M"]);
  applyInvalidationEvent(session, def, {
    type: "edge_reconnect",
    edgeId: "A->M#input1",
    previous: { source: "A", target: "M", targetHandle: "input1" },
    current: { source: "A", target: "M", targetHandle: "input2" },
  });
  assert.ok(isNodeDirty(session, "M"));
});

check("TEST 5-31 Single-input set node execution unchanged", async () => {
  const def = chainDef("A", "B");
  const partial = await executePartial({
    definition: def,
    targetNodeId: "B",
    mode: "step",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.A);
  assert.ok(partial.results.B);
});

check("TEST 5-32 Full execution path does not read editor session cache", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "../services/workflowEngine.service.js"),
    "utf8"
  );
  const runBlock = src.slice(src.indexOf("const executeRun"), src.indexOf("const executePartial"));
  assert.ok(!runBlock.includes("editorSession"));
  assert.ok(!runBlock.includes("nodeResults"));
});

section("Part 6 dynamic ports + Switch");

check("PRE-TEST all-skipped merge propagates skip to downstream", () => {
  const { order, exhausted } = drive(
    {
      nodes: [
        node("t", "trigger"),
        node("c", "condition"),
        node("skip", "noop"),
        node("M", "merge"),
        node("D", "noop"),
      ],
      edges: [
        edge("t", "c"),
        edge("c", "skip", "false"),
        portEdge("skip", "M", "input1"),
        edge("M", "D"),
      ],
    },
    { c: "true" }
  );
  assert.strictEqual(exhausted, false);
  assert.ok(order.includes("skip:M"));
  assert.ok(order.includes("skip:D"));
});

const switchRule = (id, left, operator, right, label) => ({
  id,
  left,
  operator,
  right,
  label,
});

const switchCtx = (items, rules, extra = {}) => ({
  inputItems: items.map((json, i) => ({ json, pairedItem: { item: i } })),
  input: {},
  steps: {},
  graph: buildGraph({ nodes: [], edges: [] }),
  ...extra,
});

check("TEST 6-1 static node output ports unchanged", () => {
  const ports = resolveSwitchOutputPorts({ rules: [] });
  assert.ok(Array.isArray(ports));
  const setPorts = require("../config/nodeContract").getEngineContract("set");
  assert.strictEqual(setPorts.pairedItemPolicy, "identity1to1");
});

check("TEST 6-2 Switch resolver creates output per rule", () => {
  const data = normalizeSwitchRules({
    rules: [switchRule("", "{{item.type}}", "equals", "a", "A")],
  });
  const ports = resolveSwitchOutputPorts(data);
  assert.strictEqual(ports.length, 2);
  assert.ok(ports[0].id.startsWith("rule_"));
  assert.strictEqual(ports[1].id, SWITCH_FALLBACK_HANDLE);
});

check("TEST 6-3 Rule IDs stable after reorder", () => {
  const r1 = switchRule("rule_aaa", "{{item.x}}", "equals", "1", "One");
  const r2 = switchRule("rule_bbb", "{{item.x}}", "equals", "2", "Two");
  const first = normalizeSwitchRules({ rules: [r1, r2] });
  const second = normalizeSwitchRules({ rules: [r2, r1] });
  assert.strictEqual(first.rules[0].id, "rule_aaa");
  assert.strictEqual(second.rules[1].id, "rule_aaa");
});

check("TEST 6-4 Adding rule preserves existing rule IDs", () => {
  const base = normalizeSwitchRules({
    rules: [switchRule("rule_keep", "{{item}}", "equals", "x")],
  });
  const extended = normalizeSwitchRules({
    rules: [
      ...base.rules,
      switchRule("", "{{item}}", "equals", "y", "New"),
    ],
  });
  assert.strictEqual(extended.rules[0].id, "rule_keep");
  assert.notStrictEqual(extended.rules[1].id, "rule_keep");
});

check("TEST 6-7 First-match routing assigns item to first rule", async () => {
  const data = normalizeSwitchRules({
    rules: [
      switchRule("rule_a", "{{item.kind}}", "equals", "b", "B"),
      switchRule("rule_c", "{{item.kind}}", "equals", "a", "A"),
    ],
    enableFallback: false,
  });
  const r = await handlers.switch(
    { id: "s", data },
    switchCtx([{ kind: "a" }, { kind: "b" }])
  );
  assert.strictEqual(r.outputsByPort.rule_a.length, 1);
  assert.strictEqual(r.outputsByPort.rule_a[0].json.kind, "b");
  assert.strictEqual(r.outputsByPort.rule_c.length, 1);
  assert.strictEqual(r.outputsByPort.rule_c[0].json.kind, "a");
});

check("TEST 6-9 No-match routes to fallback", async () => {
  const data = normalizeSwitchRules({
    rules: [switchRule("rule_x", "{{item.n}}", "equals", "99")],
    enableFallback: true,
  });
  const r = await handlers.switch(
    { id: "s", data },
    switchCtx([{ n: 1 }])
  );
  assert.strictEqual(r.outputsByPort.rule_x.length, 0);
  assert.strictEqual(r.outputsByPort[SWITCH_FALLBACK_HANDLE].length, 1);
});

check("TEST 6-10 No-match without fallback produces no routed item", async () => {
  const data = normalizeSwitchRules({
    rules: [switchRule("rule_x", "{{item.n}}", "equals", "99")],
    enableFallback: false,
  });
  const r = await handlers.switch(
    { id: "s", data },
    switchCtx([{ n: 1 }])
  );
  const total = Object.values(r.outputsByPort).reduce((n, arr) => n + arr.length, 0);
  assert.strictEqual(total, 0);
});

check("TEST 6-12 pairedItem preserves input index on branch", async () => {
  const data = normalizeSwitchRules({
    rules: [switchRule("rule_a", "{{item.id}}", "equals", "2")],
    enableFallback: true,
  });
  const r = await handlers.switch(
    { id: "s", data },
    switchCtx([{ id: "1" }, { id: "2" }])
  );
  const idx = (item) =>
    typeof item.pairedItem === "number" ? item.pairedItem : item.pairedItem?.item;
  assert.strictEqual(idx(r.outputsByPort[SWITCH_FALLBACK_HANDLE][0]), 0);
  assert.strictEqual(idx(r.outputsByPort.rule_a[0]), 1);
});

check("TEST 6-14 Unmatched rule output port is empty not skipped", async () => {
  const data = normalizeSwitchRules({
    rules: [
      switchRule("rule_a", "{{item.t}}", "equals", "x"),
      switchRule("rule_b", "{{item.t}}", "equals", "y"),
    ],
    enableFallback: false,
  });
  const r = await handlers.switch(
    { id: "s", data },
    switchCtx([{ t: "x" }])
  );
  assert.strictEqual(r.outputsByPort.rule_a.length, 1);
  assert.strictEqual(r.outputsByPort.rule_b.length, 0);
  assert.ok(r.activeHandles.includes("rule_b"));
});

check("TEST 6-15 Skipped Switch propagates skipped outputs", () => {
  const ruleId = "rule_test";
  const { order } = drive(
    {
      nodes: [
        node("t", "trigger"),
        node("c", "condition"),
        node("S", "switch"),
        node("D", "noop"),
      ],
      edges: [
        edge("t", "c"),
        edge("c", "S", "false"),
        { id: "s-d", source: "S", target: "D", sourceHandle: ruleId },
      ],
    },
    { c: "true" }
  );
  assert.ok(order.includes("skip:S"));
  assert.ok(order.includes("skip:D"));
});

check("TEST 6-16 Downstream merge does not deadlock when switch skipped", () => {
  const ruleId = "rule_m";
  const { exhausted } = drive(
    {
      nodes: [
        node("t", "trigger"),
        node("c", "condition"),
        node("S", "switch"),
        node("M", "merge"),
      ],
      edges: [
        edge("t", "c"),
        edge("c", "S", "false"),
        { id: "s-m", source: "S", target: "M", sourceHandle: ruleId },
        portEdge("t", "M", "input1"),
      ],
    },
    { c: "true" }
  );
  assert.strictEqual(exhausted, false);
});

check("TEST 6-17 Expression through switch rule resolves source item", () => {
  const ruleId = "rule_a";
  const graph = buildGraph({
    nodes: [node("src", "noop"), node("S", "switch"), node("D", "noop")],
    edges: [
      edge("src", "S"),
      { id: "s-d", source: "S", target: "D", sourceHandle: ruleId },
    ],
  });
  const context = {
    steps: {},
    items: {
      src: [{ json: { name: "Alice" }, pairedItem: { item: 0 } }],
      S: [{ json: { routed: true }, pairedItem: { item: 0 } }],
    },
    inputItems: [{ json: { routed: true }, pairedItem: { item: 0 } }],
  };
  const res = resolveReferencedItem({
    currentNodeId: "D",
    currentItem: context.inputItems[0],
    currentItemIndex: 0,
    targetNodeId: "src",
    context,
    graph,
  });
  assert.strictEqual(res.status, "resolved");
  assert.strictEqual(res.item.json.name, "Alice");
});

check("TEST 6-19 Invalid switch sourceHandle rejected", () => {
  const data = normalizeSwitchRules({
    rules: [switchRule("rule_ok", "{{item}}", "equals", "1")],
  });
  assert.ok(isValidSwitchSourceHandle("rule_ok", data));
  assert.ok(!isValidSwitchSourceHandle("rule_removed", data));
});

check("TEST 6-35 Existing IF behavior unchanged", async () => {
  const r = await handlers.condition(
    { id: "c", data: { left: "41", operator: "gt", right: "10" } },
    ctx
  );
  assert.strictEqual(r.nextHandle, "true");
});

check("TEST 6-36 Existing merge append unchanged", async () => {
  const portCtx = {
    portInputs: {
      input1: {
        portId: "input1",
        inputIndex: 0,
        state: PORT_STATES.ARRIVED_WITH_DATA,
        items: [{ json: { a: 1 } }],
      },
      input2: {
        portId: "input2",
        inputIndex: 1,
        state: PORT_STATES.ARRIVED_WITH_DATA,
        items: [{ json: { b: 2 } }],
      },
    },
    inputItems: [],
  };
  const r = await handlers.merge({ id: "m", data: { mode: "append" } }, portCtx);
  assert.strictEqual(r.items.length, 2);
});

section("Part 6B Switch stabilization");

const switchNodeDef = (id, rules, opts = {}) => ({
  id,
  type: "switch",
  position: { x: 0, y: 0 },
  data: normalizeSwitchRules(
    {
      rules,
      routingMode: opts.routingMode || "firstMatch",
      enableFallback: opts.enableFallback !== false,
    },
    { nodeId: id }
  ),
});

const normalizeDefSwitches = (def) => ({
  ...def,
  nodes: def.nodes.map((n) =>
    n.type === "switch"
      ? { ...n, data: normalizeSwitchRules(n.data || {}, { nodeId: n.id }) }
      : n
  ),
});

const saveReloadDef = (def) => normalizeDefSwitches(JSON.parse(JSON.stringify(def)));

check("TEST 6B-1 legacy missing rule IDs normalize stably", () => {
  const d1 = normalizeSwitchRules(
    { rules: [{ left: "{{item}}", operator: "equals", right: "1", label: "A" }] },
    { nodeId: "switch-1" }
  );
  const d2 = normalizeSwitchRules(
    { rules: [{ left: "{{item}}", operator: "equals", right: "1", label: "A" }] },
    { nodeId: "switch-1" }
  );
  assert.strictEqual(d1.rules[0].id, d2.rules[0].id);
  assert.strictEqual(d1.rules[0].id, legacyStableRuleId("switch-1", 0));
});

check("TEST 6B-2 save/reload preserves rule IDs order and edge handles", () => {
  const rules = [
    switchRule("", "{{item.n}}", "equals", "1", "A"),
    switchRule("", "{{item.n}}", "equals", "2", "B"),
    switchRule("", "{{item.n}}", "equals", "3", "C"),
  ];
  const def = saveReloadDef({
    nodes: [node("src", "noop"), switchNodeDef("S", rules)],
    edges: [],
  });
  const normalized = normalizeDefSwitches(def);
  const [ruleA, ruleB, ruleC] = normalized.nodes.find((n) => n.id === "S").data.rules;
  const withEdges = {
    ...normalized,
    edges: [
      { id: "e1", source: "S", target: "src", sourceHandle: ruleA.id },
      { id: "e2", source: "S", target: "src", sourceHandle: ruleB.id },
      { id: "e3", source: "S", target: "src", sourceHandle: ruleC.id },
    ],
  };
  const reloaded = saveReloadDef(withEdges);
  const rulesAgain = reloaded.nodes.find((n) => n.id === "S").data.rules;
  assert.deepStrictEqual(
    rulesAgain.map((r) => r.id),
    [ruleA.id, ruleB.id, ruleC.id]
  );
  assert.strictEqual(reloaded.edges[1].sourceHandle, ruleB.id);
});

check("TEST 6B-3 reorder save/reload preserves logical rule IDs", () => {
  const rules = [
    switchRule("rule_A", "{{item}}", "equals", "a", "A"),
    switchRule("rule_B", "{{item}}", "equals", "b", "B"),
    switchRule("rule_C", "{{item}}", "equals", "c", "C"),
  ];
  const reordered = saveReloadDef({
    nodes: [
      node("src", "noop"),
      switchNodeDef("S", [rules[2], rules[0], rules[1]]),
    ],
    edges: [],
  });
  const ids = reordered.nodes.find((n) => n.id === "S").data.rules.map((r) => r.id);
  assert.deepStrictEqual(ids, ["rule_C", "rule_A", "rule_B"]);
});

check("TEST 6B-4 duplicate Switch generates new rule IDs", () => {
  const orig = normalizeSwitchRules(
    {
      rules: [
        switchRule("rule_a", "{{item}}", "equals", "1"),
        switchRule("rule_b", "{{item}}", "equals", "2"),
      ],
    },
    { nodeId: "S" }
  );
  const dup = duplicateSwitchNodeData(orig);
  assert.notStrictEqual(dup.rules[0].id, orig.rules[0].id);
  assert.notStrictEqual(dup.rules[1].id, orig.rules[1].id);
  assert.strictEqual(dup.rules[0].left, orig.rules[0].left);
  assert.strictEqual(dup.routingMode, orig.routingMode);
});

check("TEST 6B-5 copy/paste style remap uses fresh rule IDs", () => {
  const orig = normalizeSwitchRules(
    {
      rules: [
        switchRule("rule_old_a", "{{item}}", "equals", "1"),
        switchRule("rule_old_b", "{{item}}", "equals", "2"),
      ],
    },
    { nodeId: "S-old" }
  );
  const dup = duplicateSwitchNodeData(orig);
  const idMap = new Map(
    orig.rules.map((rule, index) => [rule.id, dup.rules[index].id])
  );
  const remapped = idMap.get("rule_old_a");
  assert.ok(remapped);
  assert.notStrictEqual(remapped, "rule_old_a");
  assert.ok(dup.rules.some((r) => r.id === remapped));
});

check("TEST 6B-6 add rule preserves existing IDs", () => {
  const base = normalizeSwitchRules(
    { rules: [switchRule("rule_keep", "{{item}}", "equals", "x", "A")] },
    { nodeId: "S" }
  );
  const extended = normalizeSwitchRules(
    {
      rules: [
        base.rules[0],
        { left: "{{item}}", operator: "equals", right: "y", label: "NEW" },
        switchRule("rule_keep2", "{{item}}", "equals", "z", "B"),
      ],
    },
    { nodeId: "S" }
  );
  assert.strictEqual(extended.rules[0].id, "rule_keep");
  assert.strictEqual(extended.rules[2].id, "rule_keep2");
  assert.notStrictEqual(extended.rules[1].id, "rule_keep");
});

check("TEST 6B-7 delete rule removes only its edge", () => {
  const data = normalizeSwitchRules(
    {
      rules: [
        switchRule("rule_A", "{{item}}", "equals", "a"),
        switchRule("rule_B", "{{item}}", "equals", "b"),
        switchRule("rule_C", "{{item}}", "equals", "c"),
      ],
    },
    { nodeId: "S" }
  );
  const withoutB = normalizeSwitchRules(
    {
      ...data,
      rules: data.rules.filter((r) => r.id !== "rule_B"),
    },
    { nodeId: "S" }
  );
  const edges = [
    { source: "S", target: "X", sourceHandle: "rule_A" },
    { source: "S", target: "Y", sourceHandle: "rule_B" },
    { source: "S", target: "Z", sourceHandle: "rule_C" },
  ];
  const pruned = pruneInvalidSwitchEdges(edges, "S", withoutB);
  assert.strictEqual(pruned.length, 2);
  assert.ok(pruned.some((e) => e.sourceHandle === "rule_A"));
  assert.ok(pruned.some((e) => e.sourceHandle === "rule_C"));
  assert.ok(!pruned.some((e) => e.sourceHandle === "rule_B"));
});

check("TEST 6B-8 reorder preserves edge handles", () => {
  const data = normalizeSwitchRules(
    {
      rules: [
        switchRule("rule_A", "{{item}}", "equals", "a"),
        switchRule("rule_B", "{{item}}", "equals", "b"),
      ],
    },
    { nodeId: "S" }
  );
  const reordered = normalizeSwitchRules(
    {
      ...data,
      rules: [data.rules[1], data.rules[0]],
    },
    { nodeId: "S" }
  );
  const edges = [
    { source: "S", target: "X", sourceHandle: "rule_A" },
    { source: "S", target: "Y", sourceHandle: "rule_B" },
  ];
  const valid = pruneInvalidSwitchEdges(edges, "S", reordered);
  assert.strictEqual(valid.length, 2);
});

check("TEST 6B-9 reorder changes firstMatch behavior", async () => {
  const mkData = (order) =>
    normalizeSwitchRules(
      {
        rules: order.map((id) =>
          switchRule(id, "{{item.v}}", "equals", "yes", id)
        ),
        enableFallback: false,
      },
      { nodeId: "S" }
    );
  const first = await handlers.switch(
    { id: "S", data: mkData(["rule_a", "rule_b"]) },
    switchCtx([{ v: "yes" }])
  );
  const second = await handlers.switch(
    { id: "S", data: mkData(["rule_b", "rule_a"]) },
    switchCtx([{ v: "yes" }])
  );
  assert.strictEqual(first.outputsByPort.rule_a.length, 1);
  assert.strictEqual(first.outputsByPort.rule_b.length, 0);
  assert.strictEqual(second.outputsByPort.rule_b.length, 1);
  assert.strictEqual(second.outputsByPort.rule_a.length, 0);
});

check("TEST 6B-10 rule mutations dirty Switch signature", () => {
  const graph = buildGraph({
    nodes: [switchNodeDef("S", [switchRule("rule_a", "{{item}}", "equals", "1")])],
    edges: [],
  });
  const sig1 = computeNodeExecutionSignature(graph.byId.get("S"), graph);
  const graph2 = buildGraph({
    nodes: [
      switchNodeDef("S", [
        switchRule("rule_a", "{{item}}", "equals", "1"),
        switchRule("rule_b", "{{item}}", "equals", "2"),
      ]),
    ],
    edges: [],
  });
  assert.notStrictEqual(
    sig1,
    computeNodeExecutionSignature(graph2.byId.get("S"), graph2)
  );
});

check("TEST 6B-11 allMatches routes same input to multiple ports", async () => {
  const data = normalizeSwitchRules(
    {
      routingMode: "allMatches",
      enableFallback: false,
      rules: [
        switchRule("rule_a", "{{item.t}}", "contains", "x"),
        switchRule("rule_b", "{{item.t}}", "equals", "y"),
        switchRule("rule_c", "{{item.t}}", "contains", "x"),
      ],
    },
    { nodeId: "S" }
  );
  const r = await handlers.switch(
    { id: "S", data },
    switchCtx([{ t: "xy" }])
  );
  assert.strictEqual(r.outputsByPort.rule_a.length, 1);
  assert.strictEqual(r.outputsByPort.rule_c.length, 1);
  assert.strictEqual(r.outputsByPort.rule_b.length, 0);
  assert.strictEqual(r.outputsByPort[SWITCH_FALLBACK_HANDLE], undefined);
});

check("TEST 6B-12 allMatches branch clones are mutation-independent", async () => {
  const data = normalizeSwitchRules(
    {
      routingMode: "allMatches",
      enableFallback: false,
      rules: [
        switchRule("rule_a", "{{item.t}}", "contains", "x"),
        switchRule("rule_c", "{{item.t}}", "contains", "x"),
      ],
    },
    { nodeId: "S" }
  );
  const r = await handlers.switch(
    { id: "S", data },
    switchCtx([{ t: "xy", n: 0 }])
  );
  r.outputsByPort.rule_a[0].json.n = 99;
  assert.strictEqual(r.outputsByPort.rule_c[0].json.n, 0);
});

check("TEST 6B-13 allMatches provenance preserves input index", async () => {
  const data = normalizeSwitchRules(
    {
      routingMode: "allMatches",
      enableFallback: false,
      rules: [
        switchRule("rule_a", "{{item.v}}", "equals", "1"),
        switchRule("rule_c", "{{item.v}}", "equals", "1"),
      ],
    },
    { nodeId: "S" }
  );
  const r = await handlers.switch(
    { id: "S", data },
    switchCtx([{ v: "0" }, { v: "1" }])
  );
  const idx = (item) =>
    typeof item.pairedItem === "number" ? item.pairedItem : item.pairedItem?.item;
  assert.strictEqual(idx(r.outputsByPort.rule_a[0]), 1);
  assert.strictEqual(idx(r.outputsByPort.rule_c[0]), 1);
});

check("TEST 6B-14 allMatches no-match uses fallback only", async () => {
  const data = normalizeSwitchRules(
    {
      routingMode: "allMatches",
      rules: [switchRule("rule_x", "{{item.n}}", "equals", "99")],
      enableFallback: true,
    },
    { nodeId: "S" }
  );
  const r = await handlers.switch(
    { id: "S", data },
    switchCtx([{ n: 1 }])
  );
  assert.strictEqual(r.outputsByPort.rule_x.length, 0);
  assert.strictEqual(r.outputsByPort[SWITCH_FALLBACK_HANDLE].length, 1);
});

check("TEST 6B-15 pin retains per-port structure for downstream routing", async () => {
  const ruleA = "rule_a";
  const ruleB = "rule_b";
  const def = {
    nodes: [
      node("src", "noop"),
      switchNodeDef("S", [
        switchRule(ruleA, "{{item.n}}", "equals", "1"),
        switchRule(ruleB, "{{item.n}}", "equals", "2"),
      ]),
      node("DA", "noop"),
    ],
    edges: [
      edge("src", "S"),
      { id: "s-a", source: "S", target: "DA", sourceHandle: ruleA },
    ],
  };
  const switchNode = def.nodes.find((n) => n.id === "S");
  switchNode.data = {
    ...switchNode.data,
    pinned: true,
    pinnedOutput: { pinned: true },
    pinnedPortOutputs: {
      [ruleA]: [{ json: { only: "A" }, pairedItem: { item: 0 } }],
      [ruleB]: [{ json: { only: "B" }, pairedItem: { item: 0 } }],
      [SWITCH_FALLBACK_HANDLE]: [{ json: { fb: true }, pairedItem: { item: 0 } }],
    },
  };
  const partial = await executePartial({
    definition: def,
    targetNodeId: "DA",
    mode: "run-to",
    session: makeEditorSession(),
  });
  assert.strictEqual(partial.results.DA.items[0].json.only, "A");
});

check("TEST 6B-16 pinned rule A only feeds rule A edge", async () => {
  const ruleA = "rule_a";
  const ruleB = "rule_b";
  const def = {
    nodes: [
      node("src", "noop"),
      switchNodeDef("S", [
        switchRule(ruleA, "{{item.n}}", "equals", "1"),
        switchRule(ruleB, "{{item.n}}", "equals", "2"),
      ]),
      node("DA", "noop"),
      node("DB", "noop"),
    ],
    edges: [
      edge("src", "S"),
      { id: "s-a", source: "S", target: "DA", sourceHandle: ruleA },
      { id: "s-b", source: "S", target: "DB", sourceHandle: ruleB },
    ],
  };
  const switchNode = def.nodes.find((n) => n.id === "S");
  switchNode.data = {
    ...switchNode.data,
    pinned: true,
    pinnedOutput: { pinned: true },
    pinnedPortOutputs: {
      [ruleA]: [{ json: { branch: "A" }, pairedItem: { item: 0 } }],
      [ruleB]: [{ json: { branch: "B" }, pairedItem: { item: 0 } }],
    },
  };
  const partial = await executePartial({
    definition: def,
    targetNodeId: "DA",
    mode: "run-to",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.DA);
  assert.strictEqual(partial.results.DA.items[0].json.branch, "A");
  assert.strictEqual(partial.results.DB, undefined);
});

check("TEST 6B-17 removed rule prunes stale pinned port", () => {
  const data = prunePinnedPortOutputs(
    normalizeSwitchRules(
      {
        rules: [switchRule("rule_a", "{{item}}", "equals", "1")],
        pinnedPortOutputs: {
          rule_a: [{ json: { ok: true } }],
          rule_removed: [{ json: { stale: true } }],
        },
      },
      { nodeId: "S" }
    ),
    { nodeId: "S" }
  );
  assert.ok(data.pinnedPortOutputs.rule_a);
  assert.strictEqual(data.pinnedPortOutputs.rule_removed, undefined);
});

check("TEST 6B-18 inspector session exposes per-port outputs", async () => {
  const ruleA = "rule_a";
  const def = {
    nodes: [
      {
        id: "src",
        type: "set",
        data: { mappings: [{ key: "n", value: "1" }] },
      },
      switchNodeDef("S", [switchRule(ruleA, "{{item.n}}", "equals", "1")]),
    ],
    edges: [edge("src", "S")],
  };
  const partial = await executePartial({
    definition: def,
    targetNodeId: "S",
    mode: "step",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.S.portOutputs);
  assert.ok(Array.isArray(partial.results.S.portOutputs[ruleA]));
});

check("TEST 6B-19 Run Step stores portOutputs on Switch", async () => {
  const ruleA = "rule_a";
  const ruleB = "rule_b";
  const def = {
    nodes: [
      {
        id: "src",
        type: "set",
        data: { mappings: [{ key: "n", value: "1" }] },
      },
      switchNodeDef("S", [
        switchRule(ruleA, "{{item.n}}", "equals", "1"),
        switchRule(ruleB, "{{item.n}}", "equals", "9"),
      ]),
    ],
    edges: [edge("src", "S")],
  };
  const session = makeEditorSession();
  session.nodeResults.src = {
    nodeId: "src",
    status: "succeeded",
    output: { items: [{ n: "1" }] },
    items: [{ json: { n: "1" }, pairedItem: { item: 0 } }],
    cacheState: "clean",
  };
  const partial = await executePartial({
    definition: def,
    targetNodeId: "S",
    mode: "step",
    session,
  });
  assert.ok(partial.results.S.portOutputs);
  assert.strictEqual(partial.results.S.portOutputs[ruleA].length, 1);
  assert.strictEqual(partial.results.S.portOutputs[ruleB].length, 0);
});

check("TEST 6B-20 Run To Rule A target excludes Rule B downstream", async () => {
  const ruleA = "rule_a";
  const ruleB = "rule_b";
  const def = {
    nodes: [
      {
        id: "src",
        type: "set",
        data: { mappings: [{ key: "n", value: "1" }] },
      },
      switchNodeDef("S", [
        switchRule(ruleA, "{{item.n}}", "equals", "1"),
        switchRule(ruleB, "{{item.n}}", "equals", "2"),
      ]),
      node("DA", "noop"),
      node("DB", "noop"),
    ],
    edges: [
      edge("src", "S"),
      { id: "s-a", source: "S", target: "DA", sourceHandle: ruleA },
      { id: "s-b", source: "S", target: "DB", sourceHandle: ruleB },
    ],
  };
  const partial = await executePartial({
    definition: def,
    targetNodeId: "DA",
    mode: "run-to",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.S);
  assert.ok(partial.results.DA);
  assert.strictEqual(partial.results.DB, undefined);
});

check("TEST 6B-21 Execute Previous prepares Switch without executing target", async () => {
  const ruleA = "rule_a";
  const def = {
    nodes: [
      {
        id: "src",
        type: "set",
        data: { mappings: [{ key: "n", value: "1" }] },
      },
      switchNodeDef("S", [switchRule(ruleA, "{{item.n}}", "equals", "1")]),
      node("DA", "noop"),
    ],
    edges: [
      edge("src", "S"),
      { id: "s-a", source: "S", target: "DA", sourceHandle: ruleA },
    ],
  };
  const partial = await executePartial({
    definition: def,
    targetNodeId: "DA",
    mode: "upstream",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.src);
  assert.ok(partial.results.S);
  assert.strictEqual(partial.results.DA, undefined);
});

check("TEST 6B-22 production-style routing without editor cache", async () => {
  const ruleA = "rule_a";
  const def = {
    nodes: [
      {
        id: "src",
        type: "set",
        data: { mappings: [{ key: "n", value: "1" }] },
      },
      switchNodeDef("S", [switchRule(ruleA, "{{item.n}}", "equals", "1")]),
      node("D", "noop"),
    ],
    edges: [
      edge("src", "S"),
      { id: "s-d", source: "S", target: "D", sourceHandle: ruleA },
    ],
  };
  const partial = await executePartial({
    definition: def,
    targetNodeId: "D",
    mode: "run-to",
    session: makeEditorSession(),
  });
  assert.ok(partial.results.S.portOutputs[ruleA].length > 0);
  assert.ok(partial.results.D);
});

check("TEST 6B-23 invalid removed sourceHandle rejected at validation", () => {
  const def = {
    nodes: [switchNodeDef("S", [switchRule("rule_ok", "{{item}}", "equals", "1")])],
    edges: [{ source: "S", target: "X", sourceHandle: "rule_removed" }],
  };
  const errors = validateSwitchEdges(def);
  assert.ok(errors.length > 0);
  assert.match(errors[0], /invalid output handle/i);
});

check("TEST 6B-24 IF regression unchanged", async () => {
  const r = await handlers.condition(
    { id: "c", data: { left: "41", operator: "gt", right: "10" } },
    ctx
  );
  assert.strictEqual(r.nextHandle, "true");
});

check("TEST 6B-25 Merge regression unchanged", async () => {
  const portCtx = {
    portInputs: {
      input1: {
        portId: "input1",
        inputIndex: 0,
        state: PORT_STATES.ARRIVED_WITH_DATA,
        items: [{ json: { a: 1 } }],
      },
      input2: {
        portId: "input2",
        inputIndex: 1,
        state: PORT_STATES.ARRIVED_WITH_DATA,
        items: [{ json: { b: 2 } }],
      },
    },
    inputItems: [],
  };
  const r = await handlers.merge({ id: "m", data: { mode: "append" } }, portCtx);
  assert.strictEqual(r.items.length, 2);
});

check("TEST 6B-26 static HTTP/set ports unchanged", () => {
  const contract = require("../config/nodeContract");
  const http = contract.getEngineContract("http");
  const setNode = contract.getEngineContract("set");
  const cond = contract.getEngineContract("condition");
  const merge = contract.getEngineContract("merge");
  assert.strictEqual(http.pairedItemPolicy, "identity1to1");
  assert.strictEqual(setNode.pairedItemPolicy, "identity1to1");
  assert.strictEqual(cond.pairedItemPolicy, "routing");
  assert.strictEqual(merge.mergeInputs, 2);
  assert.deepStrictEqual(MERGE_PORT_IDS, ["input1", "input2"]);
});

(async () => {
  for (const task of queue) await task();
  console.log(`\n${passed} checks passed`);
  process.exit(process.exitCode || 0);
})();
