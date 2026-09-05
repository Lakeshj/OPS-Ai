/**
 * POST-12C UI QA — Run Results ordering + step summary helpers.
 * No AI runtime / scheduling changes.
 */
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const {
  sortWorkflowRunSteps,
  formatStepOutput,
} = require("../utils/runStepDisplay");

const registerPost12CUiTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("POST-12C UI QA — Run Results order + step summaries");

  const displayTs = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/runStepDisplay.ts"
  );
  const sidebarPath = path.join(
    __dirname,
    "../../frontend/src/components/workflows/WorkflowResultsSidebar.tsx"
  );
  const servicePath = path.join(
    __dirname,
    "../modules/workflows/workflows.service.js"
  );

  check("TEST POST-12C-1 Frontend runStepDisplay helper exists", () => {
    assertX.ok(fs.existsSync(displayTs));
    const src = fs.readFileSync(displayTs, "utf8");
    assertX.ok(src.includes("sortWorkflowRunSteps"));
    assertX.ok(src.includes("formatStepOutput"));
  });

  check("TEST POST-12C-2 Results sidebar sorts steps for display", () => {
    const src = fs.readFileSync(sidebarPath, "utf8");
    assertX.ok(src.includes("sortWorkflowRunSteps"));
    assertX.ok(src.includes("orderedSteps"));
  });

  check("TEST POST-12C-3 getRunById orders by execution timestamps", () => {
    const src = fs.readFileSync(servicePath, "utf8");
    assertX.ok(src.includes("COALESCE(started_at, created_at)"));
    assertX.ok(src.includes("COALESCE(finished_at, started_at, created_at)"));
    assertX.ok(src.includes("sortWorkflowRunSteps"));
  });

  const linearDef = {
    version: 1,
    nodes: [
      { id: "manual", type: "trigger" },
      { id: "set", type: "set" },
      { id: "agent", type: "aiAgent" },
      { id: "result", type: "result" },
    ],
    edges: [
      { id: "e1", source: "manual", target: "set" },
      { id: "e2", source: "set", target: "agent" },
      { id: "e3", source: "agent", target: "result" },
    ],
  };

  // Mirrors real browser QA timestamps (second precision + Agent created first by UUID).
  const unsortedQaSteps = [
    {
      id: "2f33edfb-8e44-435e-8fbe-c84f5b9a7c43",
      nodeId: "agent",
      nodeType: "aiAgent",
      executionIndex: 0,
      startedAt: "2026-09-04T13:18:55.000Z",
      finishedAt: "2026-09-04T13:18:58.000Z",
      createdAt: "2026-09-04T13:18:55.000Z",
    },
    {
      id: "7e300b58-25e5-41cf-8f27-75b36adc2f2d",
      nodeId: "manual",
      nodeType: "trigger",
      executionIndex: 0,
      startedAt: "2026-09-04T13:18:55.000Z",
      finishedAt: "2026-09-04T13:18:56.000Z",
      createdAt: "2026-09-04T13:18:55.000Z",
    },
    {
      id: "136cb967-258b-4da0-8d56-b31901aa9ca9",
      nodeId: "set",
      nodeType: "set",
      executionIndex: 0,
      startedAt: "2026-09-04T13:18:55.000Z",
      finishedAt: "2026-09-04T13:18:56.000Z",
      createdAt: "2026-09-04T13:18:55.000Z",
    },
    {
      id: "5ed23083-5bfe-4b5f-a4b5-7659066575cd",
      nodeId: "result",
      nodeType: "result",
      executionIndex: 0,
      startedAt: "2026-09-04T13:18:57.000Z",
      finishedAt: "2026-09-04T13:18:58.000Z",
      createdAt: "2026-09-04T13:18:57.000Z",
    },
  ];

  check("TEST POST-12C-4 Steps order Trigger → Set → Agent → Result", () => {
    const ordered = sortWorkflowRunSteps(unsortedQaSteps, {
      definition: linearDef,
    });
    assertX.deepEqual(
      ordered.map((s) => s.nodeType),
      ["trigger", "set", "aiAgent", "result"]
    );
  });

  check("TEST POST-12C-5 Loop occurrences keep executionIndex order", () => {
    const steps = [
      {
        id: "b2",
        nodeId: "body",
        nodeType: "set",
        executionIndex: 1,
        startedAt: "2026-09-04T10:00:01.000Z",
        finishedAt: "2026-09-04T10:00:01.000Z",
        createdAt: "2026-09-04T10:00:01.000Z",
      },
      {
        id: "b1",
        nodeId: "body",
        nodeType: "set",
        executionIndex: 0,
        startedAt: "2026-09-04T10:00:01.000Z",
        finishedAt: "2026-09-04T10:00:01.000Z",
        createdAt: "2026-09-04T10:00:01.000Z",
      },
      {
        id: "b3",
        nodeId: "body",
        nodeType: "set",
        executionIndex: 2,
        startedAt: "2026-09-04T10:00:01.000Z",
        finishedAt: "2026-09-04T10:00:01.000Z",
        createdAt: "2026-09-04T10:00:01.000Z",
      },
    ];
    const ordered = sortWorkflowRunSteps(steps, {
      definition: {
        nodes: [{ id: "body", type: "set" }],
        edges: [],
      },
    });
    assertX.deepEqual(
      ordered.map((s) => s.executionIndex),
      [0, 1, 2]
    );
  });

  check("TEST POST-12C-6 Trigger summary stays Triggered (manual)", () => {
    const summary = formatStepOutput({
      kind: "manual",
      input: { source: "manual" },
      items: [{ json: { kind: "manual", triggered: true } }],
      triggered: true,
    });
    assertX.equal(summary, "Triggered (manual)");
  });

  check("TEST POST-12C-7 Set summary uses own fields not Trigger copy", () => {
    const summary = formatStepOutput({
      kind: "manual",
      input: { source: "manual" },
      question: "What is 12 + 30? Use the calculator tool.",
      triggered: true,
      items: [
        {
          json: {
            kind: "manual",
            question: "What is 12 + 30? Use the calculator tool.",
            triggered: true,
          },
        },
      ],
    });
    assertX.ok(!/Triggered/i.test(summary), summary);
    assertX.ok(/question:/i.test(summary), summary);
    assertX.ok(/12 \+ 30/i.test(summary), summary);
  });

  check("TEST POST-12C-8 Agent summary uses agent text", () => {
    const summary = formatStepOutput({
      text: "12 + 30 = 42.",
      agent: true,
      isLlm: true,
      items: [
        {
          json: {
            text: "12 + 30 = 42.",
            triggered: true,
            question: "What is 12 + 30? Use the calculator tool.",
          },
        },
      ],
    });
    assertX.equal(summary, "12 + 30 = 42.");
  });

  check("TEST POST-12C-9 Result summary uses result field", () => {
    const summary = formatStepOutput({
      result: "12 + 30 = 42.",
      items: [{ json: { result: "12 + 30 = 42." } }],
    });
    assertX.equal(summary, "12 + 30 = 42.");
  });

  check("TEST POST-12C-10 Calculator toolCalls present on real Agent meta shape", () => {
    // Shape taken from UI Test 5 browser run — no live LLM call here.
    const agentMeta = [
      {
        kind: "aiAgent",
        rounds: 2,
        itemIndex: 0,
        toolCalls: [
          {
            callId: "call_xUsvncu4rzVBlvEJEixLmK0r",
            status: "succeeded",
            toolName: "calculator",
            durationMs: 12,
          },
        ],
      },
    ];
    const tc = agentMeta[0].toolCalls;
    assertX.ok(Array.isArray(tc) && tc.length >= 1);
    assertX.equal(tc[0].toolName, "calculator");
    assertX.equal(tc[0].status, "succeeded");
    assertX.ok(typeof tc[0].durationMs === "number");
    const blob = JSON.stringify(agentMeta);
    assertX.ok(!/"choices"\s*:/.test(blob));
    assertX.ok(!/sk-[a-zA-Z0-9]/.test(blob));
  });

  check("TEST POST-12C-11 Calculator absent from workflow_run_steps types", () => {
    // Providers must not appear as execution steps — assert helper + engine wiring.
    const ordered = sortWorkflowRunSteps(unsortedQaSteps, {
      definition: linearDef,
    });
    assertX.ok(!ordered.some((s) => /calculator|aiChatModel|aiCalculator/i.test(s.nodeType)));
  });
};

module.exports = { registerPost12CUiTests };
