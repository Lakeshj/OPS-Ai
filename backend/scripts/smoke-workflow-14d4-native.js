/**
 * Part 14D.4 completion — native OpsAi portability + unified import.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D4NativeTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.4 Native OpsAi portability + unified import");

  const port = () => require("../services/opsaiWorkflowPortability.service");
  const n8n = () => require("../services/n8nWorkflowImport.service");
  const wfSvc = () => require("../modules/workflows/workflows.service");

  const simpleNative = () => ({
    id: "wf-1",
    name: "Manual HTTP Result",
    description: "qa",
    definition: {
      version: 1,
      nodes: [
        {
          id: "t1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { label: "Manual" },
        },
        {
          id: "h1",
          type: "http",
          position: { x: 240, y: 0 },
          data: {
            label: "Fetch",
            method: "GET",
            url: "https://jsonplaceholder.typicode.com/posts/1",
            credentialId: "cred-should-strip",
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 480, y: 0 },
          data: { label: "Result", mapFrom: "{{steps.h1}}" },
        },
      ],
      edges: [
        { id: "e1", source: "t1", target: "h1" },
        { id: "e2", source: "h1", target: "r1" },
      ],
      settings: {},
    },
  });

  const agentNative = () => ({
    id: "wf-agent",
    name: "Agent resources",
    definition: {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: { label: "Manual" } },
        { id: "agent", type: "aiAgent", data: { label: "Agent" } },
        { id: "model", type: "aiChatModel", data: { label: "Chat Model" } },
        {
          id: "calc",
          type: "aiCalculatorTool",
          data: { label: "Calculator" },
        },
      ],
      edges: [
        { id: "e0", source: "t", target: "agent" },
        {
          id: "e1",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
        {
          id: "e2",
          source: "calc",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
      ],
      settings: {},
    },
  });

  check("TEST 14D4-NAT-1 native export has format + version", () => {
    const pkg = port().buildNativeExport(simpleNative());
    assertX.equal(pkg.format, "opsai-workflow");
    assertX.equal(pkg.formatVersion, 1);
    assertX.ok(pkg.workflow?.definition?.nodes?.length === 3);
  });

  check("TEST 14D4-NAT-2 native export excludes credential secrets/ids", () => {
    const pkg = port().buildNativeExport(simpleNative());
    const http = pkg.workflow.definition.nodes.find((n) => n.id === "h1");
    assertX.equal(http.data.credentialId, undefined);
    assertX.ok(http.data.credentialRequirement?.configuredAtSource);
    const json = JSON.stringify(pkg);
    assertX.ok(!json.includes("password"));
    assertX.ok(!json.includes("cred-should-strip"));
  });

  check("TEST 14D4-NAT-3 detect OPSAI_NATIVE", () => {
    const pkg = port().buildNativeExport(simpleNative());
    const d = port().detectWorkflowImportFormat(pkg);
    assertX.equal(d.format, "OPSAI_NATIVE");
  });

  check("TEST 14D4-NAT-4 detect N8N from typed nodes only", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../fixtures/n8n/simple-http-get.json"),
        "utf8"
      )
    );
    assertX.equal(port().detectWorkflowImportFormat(fixture).format, "N8N");
    assertX.equal(
      port().detectWorkflowImportFormat({
        nodes: [{ type: "http", parameters: {} }],
        connections: {},
      }).format,
      "UNKNOWN"
    );
  });

  check("TEST 14D4-NAT-5 unknown format rejected", () => {
    const r = port().previewUnifiedImport({ foo: 1 });
    assertX.equal(r.ok, false);
    assertX.equal(r.format, "UNKNOWN");
  });

  check("TEST 14D4-NAT-6 future format version rejected", () => {
    const pkg = port().buildNativeExport(simpleNative());
    pkg.formatVersion = 99;
    const r = port().previewNativeImport(pkg);
    assertX.equal(r.ok, false);
    assertX.equal(r.code, "UNSUPPORTED_FORMAT_VERSION");
  });

  check("TEST 14D4-NAT-7 native round-trip Manual→HTTP→Result", () => {
    const pkg = port().buildNativeExport(simpleNative());
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.ok, true);
    wfSvc().validateDefinition(preview.definition);
    assertX.equal(preview.definition.nodes.length, 3);
    assertX.equal(preview.definition.edges.length, 2);
    assertX.equal(
      preview.definition.nodes.find((n) => n.id === "h1").data.url,
      "https://jsonplaceholder.typicode.com/posts/1"
    );
    assertX.deepEqual(
      preview.definition.nodes.map((n) => n.position),
      simpleNative().definition.nodes.map((n) => n.position)
    );
  });

  check("TEST 14D4-NAT-8 Agent + auxiliary edges round-trip", () => {
    const pkg = port().buildNativeExport(agentNative());
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.ok, true);
    const edges = preview.definition.edges;
    assertX.ok(
      edges.some(
        (e) => e.sourceHandle === "model" && e.targetHandle === "model"
      )
    );
    assertX.ok(
      edges.some(
        (e) => e.sourceHandle === "tool" && e.targetHandle === "tools"
      )
    );
  });

  check("TEST 14D4-NAT-9 Switch/Merge handles preserved on native export", () => {
    const wf = {
      name: "complex",
      definition: {
        version: 1,
        nodes: [
          { id: "t", type: "trigger", data: {} },
          { id: "sw", type: "switch", data: { rules: [{ id: "r1" }] } },
          { id: "m", type: "merge", data: { mode: "append" } },
          { id: "a", type: "set", data: { mappings: [] } },
          { id: "b", type: "set", data: { mappings: [] } },
        ],
        edges: [
          { id: "e1", source: "t", target: "sw" },
          {
            id: "e2",
            source: "sw",
            target: "a",
            sourceHandle: "rule_r1",
          },
          { id: "e3", source: "a", target: "m", targetHandle: "input1" },
          { id: "e4", source: "b", target: "m", targetHandle: "input2" },
        ],
        settings: {},
      },
    };
    const preview = port().previewNativeImport(port().buildNativeExport(wf));
    assertX.ok(
      preview.definition.edges.some((e) => e.targetHandle === "input1")
    );
    assertX.ok(
      preview.definition.edges.some((e) => e.targetHandle === "input2")
    );
    assertX.ok(
      preview.definition.edges.some((e) => e.sourceHandle === "rule_r1")
    );
  });

  check("TEST 14D4-NAT-10 preview commit token binds fingerprint", () => {
    const pkg = port().buildNativeExport(simpleNative());
    const preview = port().previewNativeImport(pkg);
    const token = port().createPreviewCommitToken({
      fingerprint: preview.fingerprint,
      workspaceId: "ws1",
      userId: "u1",
      format: "OPSAI_NATIVE",
    });
    assertX.equal(
      port().verifyPreviewCommitToken({
        token,
        fingerprint: preview.fingerprint,
        workspaceId: "ws1",
        userId: "u1",
        format: "OPSAI_NATIVE",
      }).ok,
      true
    );
    // Tamper: different fingerprint
    assertX.equal(
      port().verifyPreviewCommitToken({
        token,
        fingerprint: "deadbeef",
        workspaceId: "ws1",
        userId: "u1",
        format: "OPSAI_NATIVE",
      }).ok,
      false
    );
  });

  check("TEST 14D4-NAT-11 prototype pollution keys stripped", () => {
    const dirty = {
      format: "opsai-workflow",
      formatVersion: 1,
      workflow: {
        name: "x",
        definition: {
          version: 1,
          nodes: [
            {
              id: "t",
              type: "trigger",
              data: { label: "T", __proto__: { polluted: true } },
            },
          ],
          edges: [],
          settings: {},
        },
      },
      __proto__: { admin: true },
    };
    const cleaned = port().stripForbiddenKeys(dirty);
    assertX.equal(Object.prototype.polluted, undefined);
    assertX.ok(!("__proto__" in cleaned));
  });

  check("TEST 14D4-NAT-12 import size/node bounds", () => {
    assertX.throws(
      () => port().assertImportBounds({}, port().IMPORT_BOUNDS.maxBytes + 1),
      (err) => err.code === "IMPORT_SIZE_BOUND"
    );
    assertX.throws(
      () =>
        port().assertImportBounds({
          format: "opsai-workflow",
          workflow: {
            definition: {
              nodes: Array.from(
                { length: port().IMPORT_BOUNDS.maxNodes + 1 },
                (_, i) => ({
                  id: `n${i}`,
                  type: "noop",
                  data: {},
                })
              ),
              edges: [],
            },
          },
        }),
      (err) => err.code === "IMPORT_NODE_BOUND"
    );
  });

  check("TEST 14D4-NAT-13 simple n8n Manual→HTTP maps", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../fixtures/n8n/simple-http-get.json"),
        "utf8"
      )
    );
    const p = n8n().previewN8nImport(fixture);
    assertX.equal(p.ok, true);
    assertX.equal(p.format, "n8n");
    const types = p.definition.nodes.map((n) => n.type).sort();
    assertX.deepEqual(types, ["http", "trigger"]);
    assertX.equal(p.report.summary.unsupported.length, 0);
    wfSvc().validateDefinition(p.definition);
  });

  check("TEST 14D4-NAT-14 unified preview routes n8n + native", () => {
    const native = port().previewUnifiedImport(
      port().buildNativeExport(simpleNative())
    );
    assertX.equal(native.ok, true);
    assertX.equal(native.detection.format, "OPSAI_NATIVE");
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../fixtures/n8n/seo-report-real-world.json"),
        "utf8"
      )
    );
    const n8nPrev = port().previewUnifiedImport(fixture);
    assertX.equal(n8nPrev.ok, true);
    assertX.equal(n8nPrev.detection.format, "N8N");
    assertX.equal(n8nPrev.runtimeReady, false);
  });

  check("TEST 14D4-NAT-15 no eval in portability service", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/opsaiWorkflowPortability.service.js"),
      "utf8"
    );
    assertX.ok(!/\beval\s*\(/.test(src));
    assertX.ok(!/new\s+Function/.test(src));
    assertX.ok(!/runInNewContext/.test(src));
  });

  check("TEST 14D4-NAT-16 export/import routes registered", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.routes.js"),
      "utf8"
    );
    assertX.ok(routes.includes('"/import/preview"'));
    assertX.ok(routes.includes('"/import"'));
    assertX.ok(routes.includes('"/:id/export"'));
  });

  check("TEST 14D4-NAT-17 Import/Export UI present", () => {
    const canvas = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowCanvas.tsx"
      ),
      "utf8"
    );
    assertX.ok(/Import Workflow|Import workflow/i.test(canvas));
    assertX.ok(/Export Workflow|Export workflow/i.test(canvas));
    const dialog = path.join(
      __dirname,
      "../../frontend/src/components/workflows/WorkflowImportDialog.tsx"
    );
    assertX.ok(fs.existsSync(dialog));
  });

  const roundTripNative = (definition, label) => {
    const pkg = port().buildNativeExport({
      id: `wf-${label}`,
      name: label,
      definition,
    });
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.ok, true, `${label} preview ok`);
    const out = preview.definition;
    assertX.equal(out.nodes.length, definition.nodes.length, `${label} node count`);
    assertX.equal(out.edges.length, definition.edges.length, `${label} edge count`);
    for (const n of definition.nodes) {
      const m = out.nodes.find((x) => x.id === n.id);
      assertX.ok(m, `${label} node ${n.id}`);
      assertX.equal(m.type, n.type);
    }
    for (const e of definition.edges) {
      const m = out.edges.find(
        (x) =>
          x.source === e.source &&
          x.target === e.target &&
          String(x.sourceHandle || "") === String(e.sourceHandle || "") &&
          String(x.targetHandle || "") === String(e.targetHandle || "")
      );
      assertX.ok(m, `${label} edge ${e.source}->${e.target}`);
    }
    return out;
  };

  check("TEST 14D4-NAT-18 Wait structural round-trip", () => {
    roundTripNative(
      {
        version: 1,
        nodes: [
          { id: "t", type: "trigger", data: { label: "Manual" } },
          {
            id: "w",
            type: "wait",
            data: {
              label: "Wait",
              resumeMode: "time",
              waitAmount: 5,
              waitUnit: "seconds",
            },
          },
          { id: "r", type: "result", data: { label: "Result" } },
        ],
        edges: [
          { id: "e1", source: "t", target: "w" },
          { id: "e2", source: "w", target: "r" },
        ],
        settings: {},
      },
      "wait"
    );
  });

  check("TEST 14D4-NAT-19 Schedule structural round-trip", () => {
    const out = roundTripNative(
      {
        version: 1,
        nodes: [
          {
            id: "s",
            type: "schedule",
            data: {
              label: "Schedule",
              scheduleRules: [
                {
                  id: "rule_a",
                  triggerInterval: "hours",
                  triggerAtHour: 9,
                  triggerAtMinute: 0,
                },
              ],
              timezone: "UTC",
            },
          },
          { id: "r", type: "result", data: { label: "Result" } },
        ],
        edges: [{ id: "e1", source: "s", target: "r" }],
        settings: {},
      },
      "schedule"
    );
    const s = out.nodes.find((n) => n.id === "s");
    assertX.equal(s.data.timezone, "UTC");
    assertX.equal(s.data.scheduleRules[0].id, "rule_a");
  });

  check("TEST 14D4-NAT-20 Webhook structural round-trip", () => {
    const out = roundTripNative(
      {
        version: 1,
        nodes: [
          {
            id: "wh",
            type: "webhook",
            data: {
              label: "Webhook",
              webhookPath: "qa/in",
              method: "POST",
              responseMode: "immediate",
            },
          },
          { id: "r", type: "result", data: { label: "Result" } },
        ],
        edges: [{ id: "e1", source: "wh", target: "r" }],
        settings: {},
      },
      "webhook"
    );
    assertX.equal(out.nodes[0].data.webhookPath, "qa/in");
    assertX.equal(out.nodes[0].data.method, "POST");
  });

  check("TEST 14D4-NAT-21 Respond to Webhook structural round-trip", () => {
    roundTripNative(
      {
        version: 1,
        nodes: [
          {
            id: "wh",
            type: "webhook",
            data: {
              label: "Webhook",
              webhookPath: "qa/respond",
              method: "POST",
              responseMode: "respondNode",
            },
          },
          {
            id: "rw",
            type: "respondToWebhook",
            data: { label: "Respond", responseCode: 200 },
          },
        ],
        edges: [{ id: "e1", source: "wh", target: "rw" }],
        settings: {},
      },
      "respond"
    );
  });

  check("TEST 14D4-NAT-22 Execute Workflow structural round-trip", () => {
    const out = roundTripNative(
      {
        version: 1,
        nodes: [
          { id: "t", type: "trigger", data: { label: "Manual" } },
          {
            id: "ew",
            type: "executeWorkflow",
            data: { label: "Run child", workflowId: "child-wf-id" },
          },
          { id: "r", type: "result", data: { label: "Result" } },
        ],
        edges: [
          { id: "e1", source: "t", target: "ew" },
          { id: "e2", source: "ew", target: "r" },
        ],
        settings: {},
      },
      "executeWorkflow"
    );
    assertX.equal(out.nodes.find((n) => n.id === "ew").data.workflowId, "child-wf-id");
  });

  check("TEST 14D4-NAT-23 Error Workflow settings + Error Trigger round-trip", () => {
    const out = roundTripNative(
      {
        version: 1,
        nodes: [
          { id: "et", type: "errorTrigger", data: { label: "Error Trigger" } },
          { id: "r", type: "result", data: { label: "Result" } },
        ],
        edges: [{ id: "e1", source: "et", target: "r" }],
        settings: { errorWorkflowId: null },
      },
      "errorWorkflow"
    );
    assertX.equal(out.nodes[0].type, "errorTrigger");
    assertX.equal(out.settings?.errorWorkflowId ?? null, null);
  });

  check("TEST 14D4-NAT-24 Loop structural round-trip", () => {
    roundTripNative(
      {
        version: 1,
        nodes: [
          { id: "t", type: "trigger", data: { label: "Manual" } },
          { id: "l", type: "loop", data: { label: "Loop", batchSize: 1 } },
          { id: "s", type: "set", data: { label: "Body", mappings: [] } },
          { id: "r", type: "result", data: { label: "Result" } },
        ],
        edges: [
          { id: "e1", source: "t", target: "l", targetHandle: "items" },
          { id: "e2", source: "l", target: "s", sourceHandle: "batch" },
          { id: "e3", source: "s", target: "l", targetHandle: "continue" },
          { id: "e4", source: "l", target: "r", sourceHandle: "done" },
        ],
        settings: {},
      },
      "loop"
    );
  });

  check("TEST 14D4-NAT-25 Result structural round-trip", () => {
    const out = roundTripNative(
      {
        version: 1,
        nodes: [
          { id: "t", type: "trigger", data: { label: "Manual" } },
          {
            id: "r",
            type: "result",
            data: { label: "Result", mapFrom: "{{steps.t}}" },
          },
        ],
        edges: [{ id: "e1", source: "t", target: "r" }],
        settings: {},
      },
      "result"
    );
    assertX.equal(out.nodes.find((n) => n.id === "r").data.mapFrom, "{{steps.t}}");
  });
};

module.exports = { registerPart14D4NativeTests };
