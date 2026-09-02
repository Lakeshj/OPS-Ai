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

(async () => {
  for (const task of queue) await task();
  console.log(`\n${passed} checks passed`);
  process.exit(process.exitCode || 0);
})();
