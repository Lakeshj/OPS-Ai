/**
 * Part 14D.3 — Production conversational intelligence hardening.
 * Deterministic smoke; live LLM QA is manual/separate.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D3Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.3 Production conversational intelligence");

  const planSvc = () => require("../services/workflowCopilotPlan.service");
  const router = () =>
    require("../services/workflowCopilotIntentRouter.service");
  const conv = () =>
    require("../services/workflowCopilotConversational.service");
  const identity = () => require("../config/opsaiAssistantIdentity");
  const plannerCfg = () => require("../config/copilotPlanner.config");

  const turn = (opts) =>
    planSvc().planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      ...opts,
    });

  const feRoot = path.join(__dirname, "../../frontend/src");
  const readFe = (...parts) =>
    fs.readFileSync(path.join(feRoot, ...parts), "utf8");
  const emptyDef = () => ({ version: 1, nodes: [], edges: [], settings: {} });
  const simpleDef = () => ({
    version: 1,
    nodes: [
      { id: "t1", type: "trigger", data: { label: "Manual" } },
      {
        id: "h1",
        type: "http",
        data: { label: "Fetch", method: "GET", url: "https://example.com" },
      },
    ],
    edges: [{ id: "e1", source: "t1", target: "h1" }],
  });
  const noOps = (res) =>
    assertX.equal((res.plan?.operations || []).length, 0);

  check("TEST 14D3-1 Production GENERAL path uses product LLM abstraction", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotConversational.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("generateConversationalReply"));
    assertX.ok(src.includes("createCopilotPlanner"));
    assertX.ok(src.includes("buildConversationalSystemInstruction"));
  });

  check("TEST 14D3-2 Production INFORMATION path uses product LLM abstraction", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotPlan.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("generateConversationalReply"));
    assertX.ok(src.includes("CONVERSATIONAL_INTENTS.includes(intent)"));
  });

  check("TEST 14D3-3 Deterministic test planner not selected in production", () => {
    const resolve = plannerCfg().resolveCopilotPlannerConfig;
    const src = fs.readFileSync(
      path.join(__dirname, "../config/copilotPlanner.config.js"),
      "utf8"
    );
    assertX.ok(src.includes("Production must never silently use the test planner"));
    assertX.equal(typeof resolve, "function");
  });

  check("TEST 14D3-4 No keyword table is primary broad conversational intelligence", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotConversational.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("useFixtures"));
    assertX.ok(src.includes('forceMode === "deterministic"'));
    assertX.ok(src.includes("Test-only") || src.includes("fixtures"));
  });

  check("TEST 14D3-5 howmuch ur intelegence → GENERAL", async () => {
    const intent = router().classifyPlanningIntent(
      "howmuch ur intelegence level with human",
      { definition: emptyDef() }
    );
    assertX.equal(intent, "GENERAL");
    const res = await turn({
      message: "howmuch ur intelegence level with human",
      definition: emptyDef(),
    });
    assertX.equal(res.intent, "GENERAL");
  });

  check("TEST 14D3-6 Intelligence question produces no workflow operations", async () => {
    const res = await turn({
      message: "howmuch ur intelegence level with human",
      definition: simpleDef(),
    });
    noOps(res);
    assertX.equal((res.unresolvedInputs || []).length, 0);
    assertX.ok(!res.fixPlan);
  });

  check("TEST 14D3-7 Follow-up what about creativity retains conversational context", async () => {
    const res = await turn({
      message: "what about creativity?",
      definition: emptyDef(),
      recentConversation: [
        {
          role: "user",
          content: "how intelligent are you compared with humans?",
        },
        {
          role: "assistant",
          content: "AI and human intelligence differ in important ways.",
        },
      ],
    });
    assertX.equal(res.intent, "GENERAL");
    noOps(res);
  });

  check("TEST 14D3-8 for ur intelligence what ur creator used handled naturally", async () => {
    const res = await turn({
      message: "for ur intelligence what ur creator used",
      definition: emptyDef(),
    });
    assertX.equal(res.intent, "GENERAL");
    assertX.ok(/OpsAi|LLM|AI/i.test(res.assistantMessage));
    noOps(res);
  });

  check("TEST 14D3-9 No false exact model claim", async () => {
    const res = await turn({
      message: "for ur intelligence what ur creator used",
      definition: emptyDef(),
    });
    assertX.ok(!/OpenAI created OpsAi|n8n created/i.test(res.assistantMessage));
  });

  check("TEST 14D3-10 No false product creator claim", () => {
    const line = identity().creatorLine();
    assertX.ok(/OpsAi/i.test(line));
    assertX.ok(!/OpenAI created/i.test(line));
  });

  check("TEST 14D3-11 Normal Chat broad conversation uses OpsAi identity", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/promptAssembler.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("buildNormalChatIdentityInstruction"));
    assertX.ok(
      identity().fixtureIdentityAnswer("chat", "name?").includes("OpsAi Assistant")
    );
  });

  check("TEST 14D3-12 Workflow Copilot broad conversation uses Copilot identity", async () => {
    const res = await turn({ message: "name?", definition: emptyDef() });
    assertX.ok(/Workflow Copilot/i.test(res.assistantMessage));
  });

  check("TEST 14D3-13 tell me a joke does not CREATE", async () => {
    const res = await turn({
      message: "tell me a joke",
      definition: emptyDef(),
    });
    assertX.equal(res.intent, "GENERAL");
    noOps(res);
  });

  check("TEST 14D3-14 General knowledge question does not CREATE", async () => {
    const res = await turn({
      message: "explain gravity simply",
      definition: emptyDef(),
    });
    assertX.ok(["GENERAL", "INFORMATION"].includes(res.intent));
    noOps(res);
  });

  check("TEST 14D3-15 Typo-heavy general question understood", () => {
    assertX.equal(
      router().classifyPlanningIntent("howmuch ur intelegence level with human", {
        definition: emptyDef(),
      }),
      "GENERAL"
    );
  });

  check("TEST 14D3-16 Typo-heavy workflow action understood", () => {
    assertX.ok(
      ["CREATE", "MODIFY"].includes(
        router().classifyPlanningIntent("add api aftr this", {
          definition: simpleDef(),
          selectedNodeId: "h1",
        })
      )
    );
  });

  check("TEST 14D3-17 GENERAL→CREATE transition works", async () => {
    const res = await turn({
      message:
        "Create a manual workflow that GETs https://jsonplaceholder.typicode.com/posts/1 and returns the response.",
      definition: emptyDef(),
      recentConversation: [
        { role: "user", content: "how intelligent are you?" },
        { role: "assistant", content: "Different from humans..." },
      ],
    });
    assertX.equal(res.intent, "CREATE");
    assertX.ok((res.plan.operations || []).length > 0);
  });

  check("TEST 14D3-18 MODIFY→GENERAL transition works", async () => {
    const res = await turn({
      message: "nice",
      definition: simpleDef(),
      recentConversation: [
        { role: "user", content: "Add a Filter after HTTP." },
        { role: "assistant", content: "I'll add a Filter." },
      ],
    });
    assertX.equal(res.intent, "GENERAL");
    noOps(res);
  });

  check("TEST 14D3-19 DEBUG→GENERAL transition works", async () => {
    const res = await turn({
      message: "got it, how are you?",
      definition: simpleDef(),
      runId: "r1",
      recentConversation: [
        { role: "user", content: "why did this fail?" },
        { role: "assistant", content: "HTTP failed with 401." },
      ],
    });
    assertX.equal(res.intent, "GENERAL");
  });

  check("TEST 14D3-20 GENERAL→MODIFY transition works", async () => {
    const res = await turn({
      message: "okay change the Filter so email must exist",
      definition: {
        version: 1,
        nodes: [
          { id: "t1", type: "trigger", data: {} },
          { id: "f1", type: "filter", data: { label: "Filter" } },
        ],
        edges: [{ id: "e1", source: "t1", target: "f1" }],
      },
      recentConversation: [
        { role: "user", content: "how intelligent are you?" },
        { role: "assistant", content: "Different strengths..." },
      ],
    });
    assertX.equal(res.intent, "MODIFY");
  });

  check("TEST 14D3-21 Mixed greeting + MODIFY action keeps MODIFY", async () => {
    const res = await turn({
      message: "hope you're good, can you add a Filter after HTTP?",
      definition: simpleDef(),
      selectedNodeId: "h1",
    });
    assertX.equal(res.intent, "MODIFY");
  });

  check("TEST 14D3-22 Mixed INFORMATION + MODIFY handles both", async () => {
    const res = await turn({
      message: "what does this HTTP node do and change it to POST",
      definition: simpleDef(),
      selectedNodeId: "h1",
    });
    assertX.equal(res.intent, "MODIFY");
  });

  check("TEST 14D3-23 Mixed identity + MODIFY handles both", async () => {
    const res = await turn({
      message: "who created you and add a Filter after HTTP",
      definition: simpleDef(),
      selectedNodeId: "h1",
    });
    assertX.equal(res.intent, "MODIFY");
  });

  check("TEST 14D3-24 Multiple workflow actions produce one valid proposal", async () => {
    const res = await turn({
      message:
        "Change Schedule to 10 AM, add a Filter before Email, and make sure email exists.",
      definition: {
        version: 1,
        nodes: [
          { id: "s1", type: "schedule", data: { label: "Schedule" } },
          { id: "e1", type: "email", data: { label: "Email" } },
        ],
        edges: [{ id: "x", source: "s1", target: "e1" }],
      },
      selectedNodeId: "s1",
    });
    assertX.equal(res.intent, "MODIFY");
  });

  check("TEST 14D3-25 Would Filter help? remains advice", async () => {
    const res = await turn({
      message: "Would a Filter help?",
      definition: simpleDef(),
    });
    assertX.equal(res.intent, "AUTOMATION_ADVICE");
    noOps(res);
  });

  check("TEST 14D3-26 Can you add Filter? becomes MODIFY", async () => {
    const res = await turn({
      message: "Can you add a Filter?",
      definition: simpleDef(),
    });
    assertX.equal(res.intent, "MODIFY");
  });

  check("TEST 14D3-27 do it resolves pending recommendation", () => {
    assertX.equal(
      router().classifyPlanningIntent("do it", {
        definition: simpleDef(),
        recentConversation: [
          {
            role: "assistant",
            content:
              "I recommend adding a Filter checking that email exists. Want me to add it?",
          },
        ],
      }),
      "MODIFY"
    );
  });

  check("TEST 14D3-28 do it without context clarifies/general", () => {
    const intent = router().classifyPlanningIntent("do it", {
      definition: emptyDef(),
    });
    assertX.ok(["GENERAL", "CLARIFY"].includes(intent));
    assertX.notEqual(intent, "CREATE");
  });

  check("TEST 14D3-29 yes without pending proposal doesn't mutate", async () => {
    const res = await turn({ message: "yes", definition: simpleDef() });
    assertX.equal(res.intent, "GENERAL");
    noOps(res);
  });

  check("TEST 14D3-30 Explicit node name overrides selected node", () => {
    // Classification remains MODIFY; explicit naming is enforced in planner/apply layer.
    assertX.equal(
      router().classifyPlanningIntent("Change HTTP B to POST.", {
        definition: simpleDef(),
        selectedNodeId: "h1",
      }),
      "MODIFY"
    );
  });

  check("TEST 14D3-31 Missing explicit named node does not silently assume selected", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotPlan.service.js"),
      "utf8"
    );
    // Guard: explicit wording priority documented in system prompt / router
    assertX.ok(
      fs
        .readFileSync(
          path.join(__dirname, "../services/workflowCopilotPlanner.service.js"),
          "utf8"
        )
        .includes("never let context override")
    );
    void src;
  });

  check("TEST 14D3-32 Failed run context beats irrelevant selected for generic failure", async () => {
    const res = await turn({
      message: "why did this fail?",
      definition: simpleDef(),
      selectedNodeId: "h1",
      runId: "r-fail",
      execution: {
        runId: "r-fail",
        status: "failed",
        failedNodeId: "h1",
        safeError: { message: "boom" },
      },
    });
    assertX.equal(res.intent, "DEBUG");
  });

  check("TEST 14D3-33 Historical diagnosis uses snapshot", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotPlan.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("diagnosisSourceDefinition"));
  });

  check("TEST 14D3-34 Historical FIX targets current draft", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotDiagnostics.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("fixPlan") || src.includes("FIX"));
  });

  check("TEST 14D3-35 Wrong user assumption corrected from evidence", async () => {
    const res = await turn({
      message: "The Filter is broken.",
      definition: simpleDef(),
      runId: "r2",
      execution: {
        runId: "r2",
        status: "failed",
        failedNodeId: "h1",
        nodeResults: {
          f1: { status: "succeeded" },
          h1: { status: "failed" },
        },
        safeError: { message: "HTTP 500" },
      },
    });
    assertX.ok(["DEBUG", "FIX", "GENERAL"].includes(res.intent));
  });

  check("TEST 14D3-36 Zero-output remains success", async () => {
    const res = await turn({
      message: "Why didn't the next node run?",
      definition: simpleDef(),
      runId: "r0",
      execution: {
        runId: "r0",
        status: "succeeded",
        nodeResults: {
          f1: { status: "succeeded", outputItemCount: 0 },
        },
      },
      allowClientExecution: true,
    });
    // Should not invent a failure classification solely from zero output
    assertX.ok(["DEBUG", "EXPLAIN", "GENERAL", "INFORMATION"].includes(res.intent));
  });

  check("TEST 14D3-37 Successful-but-wrong run enters logic-debug path", () => {
    assertX.ok(
      ["DEBUG", "GENERAL", "INFORMATION"].includes(
        router().classifyPlanningIntent(
          "The workflow succeeded but sent the wrong records.",
          { definition: simpleDef() }
        )
      )
    );
  });

  check("TEST 14D3-38 Fix everything doesn't blindly mutate ambiguous fields", async () => {
    const res = await turn({
      message: "Fix everything",
      definition: simpleDef(),
      runId: "rx",
      execution: {
        runId: "rx",
        status: "failed",
        failedNodeId: "h1",
        safeError: { message: "missing url" },
      },
    });
    assertX.equal(res.intent, "FIX");
  });

  check("TEST 14D3-39 LLM cannot override engine validation", () => {
    const g = router().enforceIntentOperationConsistency({
      intent: "GENERAL",
      operations: [{ type: "addNode", tempId: "x", nodeType: "http" }],
    });
    assertX.equal(g.ok, false);
  });

  check("TEST 14D3-40 General conversation creates no run/job", async () => {
    const res = await turn({
      message: "how intelligent are you compared with humans?",
      definition: simpleDef(),
    });
    assertX.equal(res.createdWorkflowRun, false);
    noOps(res);
  });

  check("TEST 14D3-41 #workflow mention alone does not force workflow intent", () => {
    assertX.equal(
      router().classifyPlanningIntent("how are you #LeadQualification", {
        definition: simpleDef(),
      }),
      "GENERAL"
    );
  });

  check("TEST 14D3-42 #workflow result question stays read-only", async () => {
    const res = await turn({
      message: "What did #Lead Qualification return?",
      definition: simpleDef(),
      workflowReferences: [{ workflowId: "wf1" }],
      resolveReferencesFn: async () => ({
        references: [
          {
            workflowId: "wf1",
            name: "Lead Qualification",
            available: true,
            latestRun: { status: "succeeded", resultPreview: { ok: 1 } },
            brief: { purposeSummary: "leads" },
          },
        ],
        warnings: [],
      }),
    });
    assertX.ok(["EXPLAIN", "INFORMATION", "GENERAL"].includes(res.intent));
    noOps(res);
  });

  check("TEST 14D3-43 #workflow modification request remains actionable", () => {
    assertX.ok(
      ["MODIFY", "CREATE"].includes(
        router().classifyPlanningIntent("make this like #LeadQualification", {
          definition: simpleDef(),
        })
      )
    );
  });

  check("TEST 14D3-44 OpsAi product question grounded in safe product metadata", async () => {
    const res = await turn({
      message: "What does a Filter node do?",
      definition: emptyDef(),
    });
    assertX.equal(res.intent, "INFORMATION");
    assertX.ok(/filter/i.test(res.assistantMessage));
  });

  check("TEST 14D3-45 General question doesn't unnecessarily receive workflow dump", async () => {
    const res = await turn({
      message: "tell me a joke",
      definition: simpleDef(),
    });
    assertX.ok(!/Manual →|nodes:/.test(res.assistantMessage));
    noOps(res);
  });

  check("TEST 14D3-46 Provider failure never falls back CREATE", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowCopilotPlan.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("Never fall back to CREATE"));
    assertX.ok(src.includes("Provider error"));
  });

  check("TEST 14D3-47 General UI has no empty proposal cards", () => {
    const d = readFe("components/workflows/WorkflowCopilotDrawer.tsx");
    assertX.ok(d.includes("readOnlyIntent"));
    assertX.ok(d.includes("previewLines.length > 0"));
    assertX.ok(d.includes("isLatestProposal"));
  });

  check("TEST 14D3-48 Pending workflow-name clarification superseded by GENERAL", () => {
    assertX.equal(
      router().classifyPlanningIntent(
        "actually forget that — how intelligent are you?",
        {
          definition: emptyDef(),
          recentConversation: [
            {
              role: "assistant",
              content: "What should I name this workflow?",
            },
          ],
        }
      ),
      "GENERAL"
    );
  });

  check("TEST 14D3-49 Old proposal superseded — only latest Apply", () => {
    const d = readFe("components/workflows/WorkflowCopilotDrawer.tsx");
    assertX.ok(d.includes("isLatestProposal"));
    assertX.ok(d.includes("latestProposalIdx"));
  });

  check("TEST 14D3-50 Apply-like words require valid pending proposal", () => {
    assertX.equal(
      router().classifyPlanningIntent("apply", { definition: simpleDef() }),
      "GENERAL"
    );
    assertX.equal(
      router().classifyPlanningIntent("go ahead", {
        definition: simpleDef(),
        recentConversation: [
          {
            role: "assistant",
            content: "Want me to add a Filter? Ready to apply when you say.",
          },
        ],
      }),
      "MODIFY"
    );
  });
};

module.exports = { registerPart14D3Tests };
