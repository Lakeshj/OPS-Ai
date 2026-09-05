/**
 * Part 14B — Copilot planning turn contract (deterministic planner, no UI).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14BTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14B Copilot planning turn contract");

  const planSvc = () => require("../services/workflowCopilotPlan.service");
  const copilot = () => require("../services/workflowCopilot.service");

  const emptyDef = () => ({ version: 1, nodes: [], edges: [], settings: {} });

  const turn = (opts) =>
    planSvc().planCopilotTurn({ forceMode: "deterministic", ...opts });

  check("TEST 14B-1 Plan request requires message", () => {
    assertX.throws(
      () => planSvc().normalizePlanRequest({ revisionHash: "x" }),
      (err) => err.code === planSvc().PLAN_ERROR.MESSAGE_REQUIRED
    );
  });

  check("TEST 14B-2 Plan response shape for vague create asks clarification", async () => {
    const res = await turn({
      message: "Create a workflow for me.",
      workflowId: "wf-1",
      revisionHash: copilot().hashDefinition(emptyDef()),
      definition: emptyDef(),
    });
    assertX.ok(["CREATE", "BUILD"].includes(res.intent));
    assertX.ok(typeof res.assistantMessage === "string");
    assertX.ok(res.plan);
    assertX.ok(Array.isArray(res.clarifyingQuestions));
    assertX.ok(res.clarifyingQuestions.length >= 1);
    assertX.equal(res.needsClarification, true);
    assertX.equal(res.createdWorkflowRun, false);
    assertX.ok(res.revisionHash);
  });

  check("TEST 14B-3 Multi-turn clarification supplies purpose then URL question", async () => {
    const def = emptyDef();
    const hash = copilot().hashDefinition(def);
    const turn1 = await turn({
      message: "Create a workflow for me.",
      workflowId: "wf-1",
      revisionHash: hash,
      definition: def,
    });
    assertX.equal(turn1.clarifyingQuestions[0].id, "purpose");

    const turn2 = await turn({
      message: "Call my CRM API",
      workflowId: "wf-1",
      revisionHash: hash,
      definition: def,
      recentConversation: [
        { role: "user", content: "Create a workflow for me." },
        { role: "assistant", content: turn1.assistantMessage },
      ],
      clarification: { questionId: "purpose", answer: "crm" },
    });
    assertX.ok(["CREATE", "BUILD", "MODIFY"].includes(turn2.intent));
    assertX.ok(
      turn2.clarifyingQuestions.some((q) => q.id === "url") ||
        turn2.unresolvedInputs.some((u) => u.field === "url")
    );
    assertX.equal(turn2.createdWorkflowRun, false);
    assertX.ok(!JSON.stringify(turn2).includes("fakecrm"));
  });

  check("TEST 14B-4 CRM plan with URL produces operations and preview", async () => {
    const def = emptyDef();
    const res = await turn({
      message: "Call https://api.example.com/crm/contacts",
      workflowId: "wf-1",
      revisionHash: copilot().hashDefinition(def),
      definition: def,
      clarification: { answers: { purpose: "crm" } },
    });
    assertX.ok(res.plan.operations.some((op) => op.type === "addNode"));
    assertX.ok(res.plan.operations.some((op) => op.nodeType === "http"));
    assertX.ok(res.preview);
    assertX.equal(res.createdWorkflowRun, false);
  });

  check("TEST 14B-5 MODIFY filter without selection asks clarifying question", async () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "h1", type: "http", data: { url: "https://x.test" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "h1" }],
    };
    const res = await turn({
      message: "Add a filter before this node.",
      workflowId: "wf-1",
      revisionHash: copilot().hashDefinition(def),
      definition: def,
    });
    assertX.equal(res.intent, "MODIFY");
    assertX.ok(res.clarifyingQuestions.some((q) => q.id === "selectedNodeId"));
    assertX.equal(res.createdWorkflowRun, false);
  });

  check("TEST 14B-6 MODIFY filter with selectedNodeId proposes insert ops", async () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "h1", type: "http", data: { url: "https://x.test" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "h1" }],
    };
    const res = await turn({
      message: "Add a filter before this node.",
      workflowId: "wf-1",
      revisionHash: copilot().hashDefinition(def),
      definition: def,
      selectedNodeId: "h1",
    });
    assertX.equal(res.intent, "MODIFY");
    assertX.ok(res.plan.operations.some((op) => op.nodeType === "filter"));
    assertX.ok(res.plan.operations.some((op) => op.type === "disconnectEdge"));
    assertX.equal(res.needsClarification, false);
  });

  check("TEST 14B-7 DEBUG intent deferred without workflow_run", async () => {
    const def = emptyDef();
    const res = await turn({
      message: "Why did this fail?",
      workflowId: "wf-1",
      revisionHash: copilot().hashDefinition(def),
      definition: def,
      runId: "run-1",
    });
    assertX.equal(res.intent, "DEBUG");
    assertX.equal(res.plan.operations.length, 0);
    assertX.equal(res.createdWorkflowRun, false);
    assertX.ok(
      res.warnings.some(
        (w) =>
          (w.code || w) === planSvc().PLAN_ERROR.INTENT_UNSUPPORTED ||
          String(w.message || w).includes("14C")
      )
    );
  });

  check("TEST 14B-8 FIX intent deferred without workflow_run", async () => {
    const def = emptyDef();
    const res = await turn({
      message: "Help me fix this.",
      workflowId: "wf-1",
      revisionHash: copilot().hashDefinition(def),
      definition: def,
    });
    assertX.equal(res.intent, "FIX");
    assertX.equal(res.createdWorkflowRun, false);
  });

  check("TEST 14B-9 EXPLAIN returns read-only message and no ops", async () => {
    const def = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", data: { label: "Manual" } },
        { id: "h1", type: "http", data: { label: "HTTP" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "h1" }],
    };
    const res = await turn({
      message: "Explain this workflow.",
      workflowId: "wf-1",
      revisionHash: copilot().hashDefinition(def),
      definition: def,
    });
    assertX.equal(res.intent, "EXPLAIN");
    assertX.ok(
      res.assistantMessage.includes("Manual") ||
        res.assistantMessage.includes("nodes")
    );
    assertX.equal(res.plan.operations.length, 0);
    assertX.equal(res.createdWorkflowRun, false);
  });

  check("TEST 14B-10 Stale revisionHash rejected in plan turn", async () => {
    const def = emptyDef();
    const res = await turn({
      message: "Add HTTP",
      workflowId: "wf-1",
      revisionHash: "stale-hash",
      definition: def,
    });
    assertX.ok(
      res.warnings.some(
        (w) =>
          w.code === planSvc().PLAN_ERROR.PLAN_STALE ||
          w.code === "COPILOT_PLAN_STALE"
      )
    );
    assertX.equal(res.createdWorkflowRun, false);
  });

  check("TEST 14B-11 Planning service has no workflow run side effects", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotPlan.service.js"),
      "utf8"
    );
    assertX.ok(!/\bstartRun\b/.test(src));
    assertX.ok(!/pool\.execute/.test(src));
    assertX.ok(src.includes("createdWorkflowRun"));
  });

  check("TEST 14B-12 Route registers copilot/plan", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.routes.js"),
      "utf8"
    );
    assertX.ok(routes.includes('"/:id/copilot/plan"'));
    assertX.ok(routes.includes("copilotPlan"));
  });

  check("TEST 14B-13 Frontend drawer contract types exist", () => {
    const fe = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/workflowCopilot.ts"
      ),
      "utf8"
    );
    assertX.ok(fe.includes("CopilotPlanRequest"));
    assertX.ok(fe.includes("CopilotPlanResponse"));
    assertX.ok(fe.includes("clarifyingQuestions"));
    assertX.ok(fe.includes("recentConversation"));
    const api = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/api.ts"),
      "utf8"
    );
    assertX.ok(api.includes("copilotPlan"));
  });

  check("TEST 14B-14 No floating drawer/button in 14B frontend", () => {
    const canvas = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowCanvas.tsx"
      ),
      "utf8"
    );
    assertX.ok(
      !/CopilotDrawer|floating.*[Cc]opilot|OpsAi Copilot button/.test(canvas)
    );
  });
};

module.exports = { registerPart14BTests };
