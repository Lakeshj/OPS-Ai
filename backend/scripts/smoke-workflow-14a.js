/**
 * Part 14A — Workflow Copilot foundation (deterministic, no LLM calls).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14ATests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14A Workflow Copilot foundation");

  const copilot = () => require("../services/workflowCopilot.service");
  const {
    buildGraph,
  } = require("../services/workflowEngine.service");
  const {
    validateControlledCycles,
  } = require("../services/workflowLoopGraph.service");
  const {
    invalidateEdgeTarget,
  } = require("../services/workflowGraphInvalidation.service");
  const { AI_ERROR } = require("../services/workflowAiResources.service");
  const {
    validateCallableWorkflow,
    MAX_SUBWORKFLOW_DEPTH,
  } = require("../services/workflowSubworkflow.service");
  const {
    validateErrorWorkflow,
  } = require("../services/workflowErrorRouting.service");
  const {
    validateWebhookRespondDefinition,
  } = require("../services/workflowWebhookRespond.service");

  const libraryPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeLibrary.json"
  );
  const catalog = JSON.parse(fs.readFileSync(libraryPath, "utf8"));

  const manualBase = () => ({
    version: 1,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { label: "Manual Trigger", nodeType: "trigger" },
      },
    ],
    edges: [],
    settings: {},
  });

  const buildPlanOps = () => [
    { type: "addNode", tempId: "n1", nodeType: "set", parameters: { label: "Set" } },
    {
      type: "addNode",
      tempId: "n2",
      nodeType: "http",
      parameters: { label: "HTTP", method: "GET", url: "https://example.com" },
    },
    { type: "addNode", tempId: "n3", nodeType: "result", parameters: { label: "Result" } },
    {
      type: "connectNodes",
      sourceNodeId: "trigger-1",
      targetNodeId: "n1",
    },
    { type: "connectNodes", sourceNodeId: "n1", targetNodeId: "n2" },
    { type: "connectNodes", sourceNodeId: "n2", targetNodeId: "n3" },
  ];

  const loopFixture = () => ({
    version: 1,
    nodes: [
      { id: "t", type: "trigger", data: { label: "T" } },
      { id: "L", type: "loop", data: { label: "Loop" } },
      { id: "body", type: "set", data: { label: "Body" } },
      { id: "after", type: "result", data: { label: "After" } },
    ],
    edges: [
      { id: "e0", source: "t", target: "L", targetHandle: "items" },
      { id: "e1", source: "L", target: "body", sourceHandle: "batch" },
      { id: "e2", source: "body", target: "L", targetHandle: "continue" },
      { id: "e3", source: "L", target: "after", sourceHandle: "done" },
    ],
  });

  check("TEST 14A-1 Copilot context excludes decrypted credentials", () => {
    const ctx = copilot().buildCopilotContext({
      workflow: { id: "w1", name: "W", definition: null },
      definition: {
        nodes: [
          {
            id: "h1",
            type: "http",
            data: {
              url: "https://x.test",
              apiKey: "sk-secret-value",
              authorization: "Bearer SECRET",
              credentialId: "cred-123",
            },
          },
        ],
        edges: [],
      },
    });
    const raw = JSON.stringify(ctx);
    assertX.ok(!raw.includes("sk-secret-value"));
    assertX.ok(!raw.includes("Bearer SECRET"));
    const n = ctx.workflow.nodes[0];
    assertX.equal(n.parameters.apiKey, "[REDACTED]");
    assertX.equal(n.parameters.credentialConfigured, true);
  });

  check("TEST 14A-2 Copilot context excludes Wait resume token", () => {
    const ctx = copilot().buildCopilotContext({
      definition: {
        nodes: [
          {
            id: "w",
            type: "wait",
            data: { resumeToken: "tok-abc", waitToken: "w-1" },
          },
        ],
        edges: [],
      },
      execution: {
        runId: "r1",
        status: "waiting",
        resumeToken: "tok-abc",
        waitToken: "w-1",
        externalToken: "ext-9",
      },
    });
    const raw = JSON.stringify(ctx);
    assertX.ok(!raw.includes("tok-abc"));
    assertX.ok(!raw.includes("ext-9"));
    assertX.equal(ctx.execution.resumeToken, undefined);
  });

  check("TEST 14A-3 Copilot context includes workflow skeleton", () => {
    const def = manualBase();
    def.nodes.push({ id: "http-1", type: "http", data: { label: "HTTP" } });
    const ctx = copilot().buildCopilotContext({ definition: def });
    assertX.ok(Array.isArray(ctx.workflow.skeleton));
    assertX.equal(ctx.workflow.skeleton.length, 2);
    assertX.ok(ctx.workflow.skeleton.some((n) => n.type === "trigger"));
  });

  check("TEST 14A-4 Selected node is prioritized", () => {
    const nodes = [];
    for (let i = 0; i < 100; i += 1) {
      nodes.push({ id: `n${i}`, type: "set", data: { label: `N${i}` } });
    }
    const ctx = copilot().buildCopilotContext({
      definition: { nodes, edges: [] },
      selectedNodeId: "n99",
    });
    assertX.equal(ctx.selectedNode.nodeId, "n99");
    assertX.equal(ctx.selectedNode.prioritized, true);
    assertX.ok(ctx.workflow.nodes.some((n) => n.id === "n99"));
  });

  check("TEST 14A-5 Failed node exact executionIndex preserved", () => {
    const ctx = copilot().buildCopilotContext({
      definition: {
        nodes: [{ id: "L", type: "loop", data: {} }],
        edges: [],
      },
      execution: {
        runId: "r1",
        status: "failed",
        failedNodeId: "L",
        failedExecutionIndex: 3,
        safeError: { code: "X", message: "boom" },
      },
    });
    assertX.equal(ctx.execution.failedNodeId, "L");
    assertX.equal(ctx.execution.failedExecutionIndex, 3);
  });

  check("TEST 14A-6 Safe run error included", () => {
    const ctx = copilot().buildCopilotContext({
      definition: { nodes: [{ id: "h", type: "http", data: {} }], edges: [] },
      execution: {
        runId: "r1",
        status: "failed",
        failedNodeId: "h",
        failedExecutionIndex: 0,
        safeError: {
          code: "HTTP_DESTINATION_BLOCKED",
          message: "Destination blocked",
        },
      },
    });
    assertX.equal(ctx.execution.safeError.code, "HTTP_DESTINATION_BLOCKED");
  });

  check("TEST 14A-7 Available node contracts exposed safely", () => {
    const contracts = copilot().listSafeNodeContracts();
    const http = contracts.find((c) => c.nodeType === "http");
    assertX.ok(http);
    assertX.equal(http.available, true);
    assertX.ok(Array.isArray(http.ports.inputs));
    assertX.ok(!JSON.stringify(http).includes("require("));
  });

  check("TEST 14A-8 Soon node marked unavailable", () => {
    const gmail = catalog.nodes.find((n) => n.id === "gmail");
    assertX.ok(gmail);
    assertX.equal(gmail.available, false);
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [
        { type: "addNode", tempId: "g1", nodeType: "gmailSend", parameters: {} },
      ],
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, copilot().COPILOT_ERROR.NODE_UNAVAILABLE);
  });

  check("TEST 14A-9 addNode valid node accepted", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [
        { type: "addNode", tempId: "n1", nodeType: "set", parameters: {} },
      ],
    });
    assertX.equal(v.valid, true);
    assertX.equal(v.preview.nodesAdded.length, 1);
  });

  check("TEST 14A-10 Unavailable node rejected", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [
        { type: "addNode", tempId: "n1", nodeType: "slackPost", parameters: {} },
      ],
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, copilot().COPILOT_ERROR.NODE_UNAVAILABLE);
  });

  check("TEST 14A-11 Model cannot supply persistent node ID", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [
        {
          type: "addNode",
          tempId: "n1",
          nodeType: "set",
          id: "evil-id",
          parameters: {},
        },
      ],
    });
    assertX.equal(v.valid, false);
    assertX.equal(
      v.issues[0].code,
      copilot().COPILOT_ERROR.PERSISTENT_ID_FORBIDDEN
    );
  });

  check("TEST 14A-12 updateNodeParameters validates schema", () => {
    const def = manualBase();
    def.nodes.push({
      id: "http-1",
      type: "http",
      data: { url: "https://a.test", method: "GET" },
    });
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "updateNodeParameters",
          nodeId: "http-1",
          changes: { method: "POST", url: "https://b.test" },
        },
      ],
    });
    assertX.equal(v.valid, true);
    const node = v.resultingDefinition.nodes.find((n) => n.id === "http-1");
    assertX.equal(node.data.method, "POST");
  });

  check("TEST 14A-13 Unknown parameter rejected", () => {
    const def = manualBase();
    def.nodes.push({ id: "http-1", type: "http", data: { url: "https://a.test" } });
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "updateNodeParameters",
          nodeId: "http-1",
          changes: { _internalSecret: "x", rawHandler: "y" },
        },
      ],
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, copilot().COPILOT_ERROR.UNKNOWN_PARAMETER);
  });

  check("TEST 14A-14 connectNodes valid execution ports accepted", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "a", type: "trigger", data: {} },
        { id: "b", type: "set", data: {} },
      ],
      edges: [],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        { type: "connectNodes", sourceNodeId: "a", targetNodeId: "b" },
      ],
    });
    assertX.equal(v.valid, true);
  });

  check("TEST 14A-15 Invalid port rejected", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "a", type: "set", data: {} },
        { id: "b", type: "set", data: {} },
      ],
      edges: [],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "connectNodes",
          sourceNodeId: "a",
          sourceHandle: "not-a-real-port",
          targetNodeId: "b",
        },
      ],
    });
    assertX.equal(v.valid, false);
  });

  check("TEST 14A-16 Execution→auxiliary mismatch rejected", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "set1", type: "set", data: {} },
        { id: "agent", type: "aiAgent", data: {} },
      ],
      edges: [],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "connectNodes",
          sourceNodeId: "set1",
          targetNodeId: "agent",
          targetHandle: "model",
        },
      ],
    });
    assertX.equal(v.valid, false);
  });

  check("TEST 14A-17 ai-model→Agent.model accepted", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "m", type: "aiChatModel", data: { provider: "openai", model: "gpt-4o-mini" } },
        { id: "agent", type: "aiAgent", data: {} },
      ],
      edges: [],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "connectNodes",
          sourceNodeId: "m",
          sourceHandle: "model",
          targetNodeId: "agent",
          targetHandle: "model",
        },
      ],
    });
    assertX.equal(v.valid, true, JSON.stringify(v.issues));
  });

  check("TEST 14A-18 Second model→Agent rejected", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "m1", type: "aiChatModel", data: {} },
        { id: "m2", type: "aiChatModel", data: {} },
        { id: "agent", type: "aiAgent", data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "m1",
          sourceHandle: "model",
          target: "agent",
          targetHandle: "model",
        },
      ],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "connectNodes",
          sourceNodeId: "m2",
          sourceHandle: "model",
          targetNodeId: "agent",
          targetHandle: "model",
        },
      ],
    });
    assertX.equal(v.valid, false);
  });

  check("TEST 14A-19 Normal cycle rejected", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "A", type: "set", data: {} },
        { id: "B", type: "set", data: {} },
      ],
      edges: [{ id: "e1", source: "A", target: "B" }],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        { type: "connectNodes", sourceNodeId: "B", targetNodeId: "A" },
      ],
    });
    assertX.equal(v.valid, false);
  });

  check("TEST 14A-20 Valid Loop controlled cycle accepted", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "L", type: "loop", data: {} },
        { id: "body", type: "set", data: {} },
        { id: "after", type: "result", data: {} },
      ],
      edges: [
        { id: "e0", source: "t", target: "L", targetHandle: "items" },
        { id: "e1", source: "L", target: "body", sourceHandle: "batch" },
        { id: "e3", source: "L", target: "after", sourceHandle: "done" },
      ],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "connectNodes",
          sourceNodeId: "body",
          targetNodeId: "L",
          targetHandle: "continue",
        },
      ],
    });
    assertX.equal(v.valid, true, JSON.stringify(v.issues));
    const cycle = validateControlledCycles(buildGraph(v.resultingDefinition));
    assertX.equal(cycle.ok, true);
  });

  check("TEST 14A-21 Invalid Loop continue edge rejected", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "L", type: "loop", data: {} },
        { id: "body", type: "set", data: {} },
        { id: "outsider", type: "set", data: {} },
      ],
      edges: [
        { id: "e0", source: "t", target: "L", targetHandle: "items" },
        { id: "e1", source: "L", target: "body", sourceHandle: "batch" },
        { id: "e3", source: "t", target: "outsider" },
      ],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "connectNodes",
          sourceNodeId: "outsider",
          targetNodeId: "L",
          targetHandle: "continue",
        },
      ],
    });
    assertX.equal(v.valid, false);
  });

  check("TEST 14A-22 removeNode preview includes removed edges", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "a", type: "trigger", data: {} },
        { id: "b", type: "set", data: {} },
        { id: "c", type: "result", data: {} },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [{ type: "removeNode", nodeId: "b" }],
    });
    assertX.equal(v.valid, true);
    assertX.ok(v.preview.connectionsRemoved.length >= 2);
    assertX.ok(
      v.appliedOperations[0]._removedEdges.includes("e1") &&
        v.appliedOperations[0]._removedEdges.includes("e2")
    );
  });

  check("TEST 14A-23 disconnectEdge preview correct", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "a", type: "trigger", data: {} },
        { id: "b", type: "set", data: {} },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [{ type: "disconnectEdge", edgeId: "e1" }],
    });
    assertX.equal(v.valid, true);
    assertX.equal(v.preview.connectionsRemoved.length, 1);
    assertX.equal(v.preview.connectionsRemoved[0].id, "e1");
  });

  check("TEST 14A-24 reconnect validates new handles", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "m", type: "aiChatModel", data: {} },
        { id: "agent", type: "aiAgent", data: {} },
        { id: "filter", type: "filter", data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "m",
          sourceHandle: "model",
          target: "agent",
          targetHandle: "model",
        },
      ],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [
        {
          type: "reconnectEdge",
          edgeId: "e1",
          targetNodeId: "filter",
          targetHandle: "main",
        },
      ],
    });
    assertX.equal(v.valid, false);
  });

  check("TEST 14A-25 Workflow Error setting same-workspace validated", () => {
    const def = manualBase();
    const v = copilot().validateCopilotOperations({
      definition: def,
      workflowId: "wf-a",
      workspace: {
        errorTargetDefinitions: {
          "wf-b": {
            nodes: [{ id: "et", type: "errorTrigger", data: {} }],
            edges: [],
          },
        },
      },
      operations: [
        {
          type: "setWorkflowSetting",
          key: "errorWorkflowId",
          value: "wf-b",
        },
      ],
    });
    assertX.equal(v.valid, true, JSON.stringify(v.issues));
    assertX.equal(v.resultingDefinition.settings.errorWorkflowId, "wf-b");
  });

  check("TEST 14A-26 Error Workflow self-reference rejected", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      workflowId: "wf-a",
      operations: [
        {
          type: "setWorkflowSetting",
          key: "errorWorkflowId",
          value: "wf-a",
        },
      ],
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, "ERROR_WORKFLOW_SELF");
  });

  check("TEST 14A-27 Subworkflow callable rules preserved", () => {
    const badChild = {
      nodes: [{ id: "t", type: "trigger", data: {} }],
      edges: [],
    };
    const checkCallable = validateCallableWorkflow(badChild);
    assertX.equal(checkCallable.valid, false);
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        {
          id: "ex",
          type: "executeWorkflow",
          data: { workflowId: "child-1" },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "ex" }],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      workspace: { childDefinitions: { "child-1": badChild } },
      operations: [],
    });
    // empty ops still runs auth validation on resulting def
    assertX.equal(v.valid, false);
    assertX.ok(
      v.issues.some((i) => String(i.code).includes("SUBWORKFLOW"))
    );
  });

  check("TEST 14A-28 Subworkflow recursion rules preserved", () => {
    assertX.equal(MAX_SUBWORKFLOW_DEPTH, 10);
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", data: {} },
        {
          id: "ex",
          type: "executeWorkflow",
          data: { workflowId: "wf-self" },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "ex" }],
    };
    const v = copilot().validateCopilotOperations({
      definition: def,
      workspace: {
        recursionCheck: { workflowId: "wf-self", chain: [] },
        childDefinitions: {
          "wf-self": {
            nodes: [
              { id: "wt", type: "workflowTrigger", data: {} },
              { id: "r", type: "result", data: {} },
            ],
            edges: [{ id: "e", source: "wt", target: "r" }],
          },
        },
      },
      operations: [],
    });
    assertX.equal(v.valid, false);
    assertX.ok(v.issues.some((i) => i.code === "SUBWORKFLOW_RECURSION"));
  });

  check("TEST 14A-29 Respond-to-Webhook validation preserved", () => {
    const def = {
      version: 1,
      nodes: [
        {
          id: "wh",
          type: "webhook",
          data: { responseMode: "respondNode" },
        },
      ],
      edges: [],
    };
    const direct = validateWebhookRespondDefinition(def);
    assertX.equal(direct.ok, false);
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [],
    });
    assertX.equal(v.valid, false);
  });

  check("TEST 14A-30 Copilot validation does not mutate live definition", () => {
    const def = manualBase();
    const snapshot = JSON.stringify(def);
    copilot().validateCopilotOperations({
      definition: def,
      operations: buildPlanOps(),
    });
    assertX.equal(JSON.stringify(def), snapshot);
  });

  check("TEST 14A-31 Preview returns resulting change summary", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: buildPlanOps(),
    });
    assertX.ok(v.preview.summary.includes("+ node"));
    assertX.ok(v.preview.nodesAdded.length >= 3);
    assertX.ok(v.preview.connectionsAdded.length >= 3);
  });

  check("TEST 14A-32 Missing API URL appears as unresolved input", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [
        {
          type: "addNode",
          tempId: "n1",
          nodeType: "http",
          parameters: { method: "GET", label: "CRM" },
        },
      ],
      intentHints: { crm: true },
    });
    assertX.ok(v.unresolvedInputs.some((u) => u.field === "url"));
    assertX.ok(
      v.unresolvedInputs.some((u) => /CRM API URL|API URL/.test(u.message))
    );
  });

  check("TEST 14A-33 No fake URL invented by fixture plan", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [
        {
          type: "addNode",
          tempId: "n1",
          nodeType: "http",
          parameters: { method: "GET" },
        },
      ],
    });
    const http = v.resultingDefinition.nodes.find((n) => n.type === "http");
    assertX.ok(!http.data.url);
    assertX.ok(!JSON.stringify(v).includes("fakecrm"));
  });

  check("TEST 14A-34 Apply creates expected definition", () => {
    const base = manualBase();
    const applied = copilot().applyCopilotOperations({
      definition: base,
      operations: buildPlanOps(),
      baseRevisionHash: copilot().hashDefinition(base),
    });
    assertX.equal(applied.persisted, false);
    assertX.ok(applied.definition.nodes.length === 4);
    assertX.ok(applied.definition.edges.length === 3);
  });

  check("TEST 14A-35 Apply is one history transaction where editor supports it", () => {
    const applied = copilot().applyCopilotOperations({
      definition: manualBase(),
      operations: buildPlanOps(),
    });
    assertX.equal(applied.historyTransaction, true);
    assertX.equal(applied.source, "copilot");
    const fe = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/workflowCopilot.ts"
      ),
      "utf8"
    );
    assertX.ok(fe.includes("prepareCopilotHistoryApply"));
    assertX.ok(fe.includes("pushHistory"));
  });

  check("TEST 14A-36 Apply revalidates before mutation", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilot.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("Second revalidation") || src.includes("recheck"));
    assertX.ok(src.includes("validateCopilotOperations"));
  });

  check("TEST 14A-37 Invalid apply is atomic/no partial change", () => {
    const base = manualBase();
    const before = JSON.stringify(base);
    assertX.throws(() =>
      copilot().applyCopilotOperations({
        definition: base,
        operations: [
          { type: "addNode", tempId: "n1", nodeType: "set", parameters: {} },
          {
            type: "connectNodes",
            sourceNodeId: "n1",
            sourceHandle: "bogus",
            targetNodeId: "trigger-1",
          },
        ],
      })
    );
    assertX.equal(JSON.stringify(base), before);
  });

  check("TEST 14A-38 Stale plan rejected", () => {
    const def = manualBase();
    const hash = copilot().hashDefinition(def);
    def.nodes.push({ id: "extra", type: "set", data: {} });
    const v = copilot().validateCopilotOperations({
      definition: def,
      operations: [],
      baseRevisionHash: hash,
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, copilot().COPILOT_ERROR.PLAN_STALE);
    assertX.throws(() =>
      copilot().applyCopilotOperations({
        definition: def,
        operations: [
          { type: "addNode", tempId: "n1", nodeType: "set", parameters: {} },
        ],
        baseRevisionHash: hash,
      })
    );
  });

  check("TEST 14A-39 Apply does not execute workflow", () => {
    const applied = copilot().applyCopilotOperations({
      definition: manualBase(),
      operations: [
        { type: "addNode", tempId: "n1", nodeType: "set", parameters: {} },
      ],
    });
    assertX.equal(applied.executed, false);
  });

  check("TEST 14A-40 Apply does not activate workflow", () => {
    const applied = copilot().applyCopilotOperations({
      definition: manualBase(),
      operations: [
        {
          type: "addNode",
          tempId: "n1",
          nodeType: "webhook",
          parameters: { responseMode: "immediate" },
        },
      ],
    });
    assertX.equal(applied.activated, false);
    assertX.equal(applied.persisted, false);
  });

  check("TEST 14A-41 Dirty invalidation uses normal editor semantics", () => {
    const applied = copilot().applyCopilotOperations({
      definition: {
        version: 1,
        nodes: [
          { id: "a", type: "trigger", data: {} },
          { id: "b", type: "set", data: {} },
        ],
        edges: [],
      },
      operations: [
        { type: "connectNodes", sourceNodeId: "a", targetNodeId: "b" },
      ],
    });
    assertX.ok(Array.isArray(applied.invalidationHints));
    assertX.ok(
      applied.invalidationHints.some((h) => h.type === "edge_add")
    );
    const session = { dirtyNodes: {} };
    const g = buildGraph(applied.definition);
    invalidateEdgeTarget(session, g, "b");
    assertX.ok(session.dirtyNodes.b);
  });

  check("TEST 14A-42 Model-resource change dirties Agent normally", () => {
    const before = {
      version: 1,
      nodes: [
        { id: "m", type: "aiChatModel", data: { provider: "openai" } },
        { id: "agent", type: "aiAgent", data: {} },
      ],
      edges: [],
    };
    const applied = copilot().applyCopilotOperations({
      definition: before,
      operations: [
        {
          type: "connectNodes",
          sourceNodeId: "m",
          sourceHandle: "model",
          targetNodeId: "agent",
          targetHandle: "model",
        },
      ],
    });
    assertX.ok(
      applied.invalidationHints.some(
        (h) => h.type === "edge_add" && h.targetNodeId === "agent"
      )
    );
  });

  check("TEST 14A-43 Large context bounded", () => {
    const nodes = [];
    for (let i = 0; i < 300; i += 1) {
      nodes.push({
        id: `n${i}`,
        type: "set",
        data: { label: `N${i}`, blob: "x".repeat(2000) },
      });
    }
    const ctx = copilot().buildCopilotContext({
      definition: { nodes, edges: [] },
      selectedNodeId: "n0",
    });
    assertX.ok(ctx.workflow.nodes.length <= copilot().CONTEXT_LIMITS.MAX_NODES_DETAILED);
    assertX.equal(ctx.workflow.truncated, true);
    assertX.equal(ctx.limits.MAX_NODES_DETAILED, 80);
  });

  check("TEST 14A-44 Selected/failed node retained under truncation", () => {
    const nodes = [];
    for (let i = 0; i < 200; i += 1) {
      nodes.push({ id: `n${i}`, type: "set", data: {} });
    }
    const ctx = copilot().buildCopilotContext({
      definition: { nodes, edges: [] },
      selectedNodeId: "n150",
      execution: {
        failedNodeId: "n199",
        failedExecutionIndex: 2,
        status: "failed",
        safeError: { code: "X", message: "y" },
      },
    });
    assertX.ok(ctx.workflow.nodes.some((n) => n.id === "n150"));
    assertX.ok(ctx.workflow.nodes.some((n) => n.id === "n199"));
  });

  check("TEST 14A-45 Safe HTTP params shown, Authorization redacted", () => {
    const ctx = copilot().buildCopilotContext({
      definition: {
        nodes: [
          {
            id: "h",
            type: "http",
            data: {
              method: "POST",
              url: "https://api.example/{{id}}",
              timeoutMs: 5000,
              Authorization: "Bearer xyz",
              headers: { Authorization: "Bearer xyz" },
            },
          },
        ],
        edges: [],
      },
    });
    const p = ctx.workflow.nodes[0].parameters;
    assertX.equal(p.method, "POST");
    assertX.ok(String(p.url).includes("api.example"));
    assertX.equal(p.Authorization, "[REDACTED]");
  });

  check("TEST 14A-46 Chat Model provider/model shown, API key redacted", () => {
    const ctx = copilot().buildCopilotContext({
      definition: {
        nodes: [
          {
            id: "m",
            type: "aiChatModel",
            data: {
              provider: "openai",
              model: "gpt-4o-mini",
              apiKey: "sk-live-secret",
            },
          },
        ],
        edges: [],
      },
    });
    const p = ctx.workflow.nodes[0].parameters;
    assertX.equal(p.provider, "openai");
    assertX.equal(p.model, "gpt-4o-mini");
    assertX.equal(p.apiKey, "[REDACTED]");
  });

  check("TEST 14A-47 Tool trace safe metadata may be included for failed Agent", () => {
    const ctx = copilot().buildCopilotContext({
      definition: {
        nodes: [{ id: "agent", type: "aiAgent", data: {} }],
        edges: [],
      },
      execution: {
        failedNodeId: "agent",
        failedExecutionIndex: 0,
        status: "failed",
        safeError: { code: AI_ERROR.TOOL_FAILED, message: "tool failed" },
        toolTrace: [
          {
            name: "calc",
            status: "failed",
            errorCode: "X",
            rawRequest: { secret: "nope" },
          },
        ],
      },
    });
    assertX.equal(ctx.execution.toolTrace[0].name, "calc");
    assertX.ok(!JSON.stringify(ctx).includes("nope"));
  });

  check("TEST 14A-48 Subworkflow lineage is bounded", () => {
    const kids = [];
    for (let i = 0; i < 10; i += 1) {
      kids.push({
        childRunId: `c${i}`,
        childWorkflowName: `Child ${i}`,
        status: "failed",
      });
    }
    const ctx = copilot().buildCopilotContext({
      definition: { nodes: [], edges: [] },
      execution: { childLineage: kids, status: "failed" },
    });
    assertX.ok(
      ctx.execution.childLineage.length <=
        copilot().CONTEXT_LIMITS.MAX_LINEAGE_CHILDREN
    );
  });

  check("TEST 14A-49 Error routing status doesn't rewrite source failure", () => {
    const ctx = copilot().buildCopilotContext({
      definition: { nodes: [], edges: [] },
      execution: {
        status: "failed",
        failedNodeId: "h",
        failedExecutionIndex: 0,
        safeError: { code: "X", message: "fail" },
        errorRouting: {
          handlerExists: true,
          handlerRunStatus: "succeeded",
        },
      },
    });
    assertX.equal(ctx.execution.status, "failed");
    assertX.equal(ctx.execution.errorRouting.sourceStatus, "failed");
    assertX.equal(ctx.execution.errorRouting.handlerRunStatus, "succeeded");
  });

  check("TEST 14A-50 diagnoseWorkflow reports missing Agent model", () => {
    const d = copilot().diagnoseWorkflow({
      nodes: [{ id: "agent", type: "aiAgent", data: {} }],
      edges: [],
    });
    assertX.ok(
      d.issues.some(
        (i) => i.code === AI_ERROR.MODEL_REQUIRED || i.code === "AI_MODEL_REQUIRED"
      )
    );
    assertX.equal(d.runtimeSuccessGuaranteed, false);
  });

  check("TEST 14A-51 diagnoseWorkflow reports invalid graph edge", () => {
    const d = copilot().diagnoseWorkflow({
      nodes: [
        { id: "a", type: "set", data: {} },
        { id: "b", type: "set", data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          sourceHandle: "not-real",
          target: "b",
        },
      ],
    });
    assertX.ok(d.issues.some((i) => i.code === "INVALID_GRAPH_EDGE"));
  });

  check("TEST 14A-52 diagnoseWorkflow reports Respond webhook issue", () => {
    const d = copilot().diagnoseWorkflow({
      nodes: [
        {
          id: "wh",
          type: "webhook",
          data: { responseMode: "respondNode" },
        },
      ],
      edges: [],
    });
    assertX.ok(d.issues.length > 0);
    assertX.ok(d.issues.some((i) => /RESPOND|respond/i.test(i.code + i.message)));
  });

  check("TEST 14A-53 Fixable flag true only for deterministic issue", () => {
    const d = copilot().diagnoseWorkflow({
      nodes: [
        { id: "m", type: "aiChatModel", data: {} },
        { id: "agent", type: "aiAgent", data: {} },
      ],
      edges: [],
    });
    const issue = d.issues.find((i) => i.code === AI_ERROR.MODEL_REQUIRED);
    assertX.ok(issue);
    assertX.equal(issue.fixable, true);
    assertX.equal(issue.fixHint.type, "connectNodes");

    const d2 = copilot().diagnoseWorkflow({
      nodes: [{ id: "h", type: "http", data: {} }],
      edges: [],
    });
    // missing URL is not auto-fixable via diagnose
    assertX.ok(!d2.issues.some((i) => i.fixable && i.field === "url"));
  });

  check("TEST 14A-54 Credential creation is not a supported operation", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [{ type: "createCredential", name: "x", secret: "y" }],
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, copilot().COPILOT_ERROR.UNKNOWN_OPERATION);
  });

  check("TEST 14A-55 Arbitrary SQL/eval operation rejected", () => {
    for (const type of ["sql", "eval", "executeCode", "patchJson"]) {
      const v = copilot().validateCopilotOperations({
        definition: manualBase(),
        operations: [{ type, query: "SELECT 1" }],
      });
      assertX.equal(v.valid, false);
    }
  });

  check("TEST 14A-56 Unknown operation rejected", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [{ type: "mutateEverything", payload: {} }],
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, copilot().COPILOT_ERROR.UNKNOWN_OPERATION);
  });

  check("TEST 14A-57 Model output malformed plan rejected", () => {
    const v = copilot().validateCopilotOperations({
      definition: manualBase(),
      operations: [null, "not-an-op", { foo: 1 }],
    });
    assertX.equal(v.valid, false);
    assertX.equal(v.issues[0].code, copilot().COPILOT_ERROR.MALFORMED_PLAN);
  });

  check("TEST 14A-58 Copilot operation layer creates no workflow_run", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilot.service.js"),
      "utf8"
    );
    assertX.ok(!src.includes("workflow_runs"));
    assertX.ok(!src.includes("startRun"));
    const applied = copilot().applyCopilotOperations({
      definition: manualBase(),
      operations: [
        { type: "addNode", tempId: "n1", nodeType: "set", parameters: {} },
      ],
    });
    assertX.equal(applied.executed, false);
  });

  check("TEST 14A-59 Legacy workflow behavior unchanged", () => {
    const { handlers } = require("../services/workflowNodes.service");
    assertX.ok(typeof handlers.set === "function");
    assertX.ok(typeof handlers.http === "function");
  });

  check("TEST 14A-60 Wait unchanged", () => {
    const wait = require("../services/workflowWait.service");
    assertX.ok(typeof wait.normalizeWaitSnapshot === "function" || typeof wait === "object");
    assertX.ok(
      fs
        .readFileSync(
          path.join(__dirname, "../services/workflowWait.service.js"),
          "utf8"
        )
        .includes("resume")
    );
  });

  check("TEST 14A-61 Loop unchanged", () => {
    const cycle = validateControlledCycles(buildGraph(loopFixture()));
    assertX.equal(cycle.ok, true);
  });

  check("TEST 14A-62 Subworkflow unchanged", () => {
    const ok = validateCallableWorkflow({
      nodes: [
        { id: "wt", type: "workflowTrigger", data: {} },
        { id: "r", type: "result", data: {} },
      ],
      edges: [{ id: "e", source: "wt", target: "r" }],
    });
    assertX.equal(ok.valid, true);
  });

  check("TEST 14A-63 Error Workflow unchanged", () => {
    const ok = validateErrorWorkflow({
      nodes: [{ id: "et", type: "errorTrigger", data: {} }],
      edges: [],
    });
    assertX.equal(ok.valid, true);
  });

  check("TEST 14A-64 AI Agent unchanged", () => {
    assertX.equal(AI_ERROR.MODEL_REQUIRED, "AI_MODEL_REQUIRED");
    const { resolveAgentResources } = require("../services/workflowAiResources.service");
    assertX.ok(typeof resolveAgentResources === "function");
  });

  check("TEST 14A-65 HTTP security unchanged", () => {
    const httpSec = require("../services/workflowHttpSecurity.service");
    assertX.ok(httpSec.ERROR.DESTINATION_BLOCKED || httpSec.ERROR);
    assertX.ok(typeof httpSec.assertSafeHttpUrl === "function");
  });
};

module.exports = { registerPart14ATests };
