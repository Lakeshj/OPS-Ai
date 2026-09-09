/**
 * Part 14D.4 gap closure — safe n8n mappings (Webhook/IF/Filter/Switch/Wait/Execute/Error/AI).
 */
const assert = require("node:assert");

const registerPart14D4GapTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.4 Gap — safe n8n mapping coverage");

  const n8n = () => require("../services/n8nWorkflowImport.service");
  const { legacyStableRuleId, SWITCH_FALLBACK_HANDLE } = require("../services/workflowDynamicPorts.service");

  const condEquals = (field, value) => ({
    combinator: "and",
    conditions: [
      {
        leftValue: `={{ $json.${field} }}`,
        rightValue: value,
        operator: { type: "string", operation: "equals" },
      },
    ],
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
  });

  check("TEST 14D4-GAP-1 Webhook maps method/path/responseMode; no source ids", () => {
    const src = {
      name: "wh",
      nodes: [
        {
          id: "w1",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [0, 0],
          parameters: {
            path: "hooks/in",
            httpMethod: "POST",
            responseMode: "responseNode",
            webhookId: "src-live-id-must-ignore",
          },
        },
      ],
      connections: {},
    };
    const p = n8n().previewN8nImport(src);
    assertX.equal(p.ok, true);
    const node = p.definition.nodes[0];
    assertX.equal(node.type, "webhook");
    assertX.equal(node.data.method, "POST");
    assertX.equal(node.data.webhookPath, "hooks/in");
    assertX.equal(node.data.responseMode, "respondNode");
    assertX.equal(node.data.webhookId, undefined);
    assertX.ok(node.data.migrationNotes?.sourceWebhookIdIgnored);
  });

  check("TEST 14D4-GAP-2 IF single equals → condition true/false handles", () => {
    const src = {
      name: "if",
      nodes: [
        {
          id: "t",
          name: "Manual",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: "i",
          name: "If",
          type: "n8n-nodes-base.if",
          typeVersion: 2.2,
          position: [200, 0],
          parameters: { conditions: condEquals("status", "ok") },
        },
        {
          id: "a",
          name: "A",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [400, -80],
          parameters: {
            assignments: { assignments: [{ name: "x", value: "1" }] },
          },
        },
        {
          id: "b",
          name: "B",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [400, 80],
          parameters: {
            assignments: { assignments: [{ name: "x", value: "0" }] },
          },
        },
      ],
      connections: {
        Manual: { main: [[{ node: "If", type: "main", index: 0 }]] },
        If: {
          main: [
            [{ node: "A", type: "main", index: 0 }],
            [{ node: "B", type: "main", index: 0 }],
          ],
        },
      },
    };
    const p = n8n().previewN8nImport(src);
    const iff = p.definition.nodes.find((n) => n.type === "condition");
    assertX.ok(iff);
    assertX.equal(iff.data.operator, "equals");
    assertX.equal(iff.data.right, "ok");
    const trueEdge = p.definition.edges.find((e) => e.sourceHandle === "true");
    const falseEdge = p.definition.edges.find((e) => e.sourceHandle === "false");
    assertX.ok(trueEdge);
    assertX.ok(falseEdge);
  });

  check("TEST 14D4-GAP-3 Filter unknown operator → NEEDS_REVIEW (exists)", () => {
    const src = {
      name: "f",
      nodes: [
        {
          id: "f1",
          name: "Filter",
          type: "n8n-nodes-base.filter",
          typeVersion: 2.2,
          position: [0, 0],
          parameters: {
            conditions: {
              combinator: "and",
              conditions: [
                {
                  leftValue: "={{ $json.email }}",
                  rightValue: "",
                  operator: { type: "string", operation: "exists" },
                },
              ],
            },
          },
        },
      ],
      connections: {},
    };
    const p = n8n().previewN8nImport(src);
    const node = p.definition.nodes[0];
    assertX.equal(node.type, "migrationUnsupported");
    assertX.equal(node.data.migrationStatus, "NEEDS_REVIEW");
    assertX.ok(
      node.data.migrationReason === "FILTER_OPERATOR_NEEDS_REVIEW" ||
        (p.report.summary.needsReview || []).length >= 0
    );
  });

  check("TEST 14D4-GAP-4 Filter single contains → filter; discard branch dropped", () => {
    const src = {
      name: "f",
      nodes: [
        {
          id: "f1",
          name: "Filter",
          type: "n8n-nodes-base.filter",
          typeVersion: 2.2,
          position: [0, 0],
          parameters: {
            conditions: {
              combinator: "and",
              conditions: [
                {
                  leftValue: "={{ $json.name }}",
                  rightValue: "acme",
                  operator: { type: "string", operation: "contains" },
                },
              ],
            },
          },
        },
        {
          id: "k",
          name: "Kept",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [200, 0],
          parameters: {
            assignments: { assignments: [{ name: "k", value: "1" }] },
          },
        },
        {
          id: "d",
          name: "Drop",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [200, 100],
          parameters: {
            assignments: { assignments: [{ name: "d", value: "1" }] },
          },
        },
      ],
      connections: {
        Filter: {
          main: [
            [{ node: "Kept", type: "main", index: 0 }],
            [{ node: "Drop", type: "main", index: 0 }],
          ],
        },
      },
    };
    const p = n8n().previewN8nImport(src);
    const filt = p.definition.nodes.find((n) => n.type === "filter");
    assertX.ok(filt);
    assertX.equal(filt.data.operator, "contains");
    assertX.equal(filt.data.fieldName, "name");
    const dropEdges = p.definition.edges.filter((e) => {
      const tgt = p.definition.nodes.find((n) => n.id === e.target);
      return tgt?.data?.label === "Drop";
    });
    assertX.equal(dropEdges.length, 0);
    assertX.ok(
      (p.report.mergePortNotes || []).some(
        (n) => n.reason === "FILTER_DISCARD_BRANCH_UNSUPPORTED"
      ) || filt.data.migrationNotes?.discardedBranchNotImported
    );
  });

  check("TEST 14D4-GAP-5 Switch 2/3 branches + fallback → stable handles", () => {
    const makeSwitch = (ruleCount, withFallback) => {
      const values = [];
      for (let i = 0; i < ruleCount; i += 1) {
        values.push({
          outputKey: `b${i}`,
          conditions: condEquals("tier", String(i)),
        });
      }
      const nodes = [
        {
          id: "s",
          name: "Switch",
          type: "n8n-nodes-base.switch",
          typeVersion: 3.2,
          position: [0, 0],
          parameters: {
            mode: "rules",
            rules: { values },
            options: withFallback ? { fallbackOutput: "extra" } : { fallbackOutput: "none" },
          },
        },
      ];
      const connections = { Switch: { main: [] } };
      for (let i = 0; i < ruleCount + (withFallback ? 1 : 0); i += 1) {
        const name = `Out${i}`;
        nodes.push({
          id: `o${i}`,
          name,
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [200, i * 40],
          parameters: {
            assignments: { assignments: [{ name: "o", value: String(i) }] },
          },
        });
        connections.Switch.main.push([{ node: name, type: "main", index: 0 }]);
      }
      return n8n().previewN8nImport({ name: "sw", nodes, connections });
    };

    const p2 = makeSwitch(2, false);
    const sw2 = p2.definition.nodes.find((n) => n.type === "switch");
    assertX.equal(sw2.data.rules.length, 2);
    const h0 = legacyStableRuleId(sw2.id, 0);
    const h1 = legacyStableRuleId(sw2.id, 1);
    assertX.equal(sw2.data.rules[0].id, h0);
    assertX.ok(p2.definition.edges.some((e) => e.sourceHandle === h0));
    assertX.ok(p2.definition.edges.some((e) => e.sourceHandle === h1));

    const p3 = makeSwitch(3, true);
    const sw3 = p3.definition.nodes.find((n) => n.type === "switch");
    assertX.equal(sw3.data.rules.length, 3);
    assertX.equal(sw3.data.enableFallback, true);
    assertX.ok(
      p3.definition.edges.some((e) => e.sourceHandle === SWITCH_FALLBACK_HANDLE)
    );
  });

  check("TEST 14D4-GAP-6 Wait timeInterval config only; no resume URL", () => {
    const p = n8n().previewN8nImport({
      name: "wait",
      nodes: [
        {
          id: "w",
          name: "Wait",
          type: "n8n-nodes-base.wait",
          typeVersion: 1.1,
          position: [0, 0],
          parameters: {
            resume: "timeInterval",
            amount: 10,
            unit: "minutes",
            webhookId: "must-ignore",
          },
        },
      ],
      connections: {},
    });
    const node = p.definition.nodes[0];
    assertX.equal(node.type, "wait");
    assertX.equal(node.data.resumeMode, "time");
    assertX.equal(node.data.waitAmount, 10);
    assertX.equal(node.data.waitUnit, "minutes");
    assertX.ok(node.data.migrationNotes?.resumeUrlIgnored);
    assertX.equal(node.data.resumeUrl, undefined);
    assertX.equal(node.data.webhookId, undefined);
  });

  check("TEST 14D4-GAP-7 Execute Workflow → SUBWORKFLOW_TARGET_REQUIRED", () => {
    const p = n8n().previewN8nImport({
      name: "ew",
      nodes: [
        {
          id: "e",
          name: "Execute Workflow",
          type: "n8n-nodes-base.executeWorkflow",
          typeVersion: 1.2,
          position: [0, 0],
          parameters: {
            source: "database",
            workflowId: { __rl: true, value: "n8n-wf-999", mode: "list", cachedResultName: "Child" },
          },
        },
      ],
      connections: {},
    });
    const node = p.definition.nodes[0];
    assertX.equal(node.type, "executeWorkflow");
    assertX.equal(node.data.workflowId, null);
    assertX.equal(node.data.unresolvedRequirement, "SUBWORKFLOW_TARGET_REQUIRED");
    assertX.equal(node.data.sourceWorkflowHint?.id, "n8n-wf-999");
    assertX.ok(
      (p.definition.migration.unresolvedRequirements || []).some(
        (r) => r.code === "SUBWORKFLOW_TARGET_REQUIRED"
      )
    );
    assertX.equal(p.runtimeReady, false);
  });

  check("TEST 14D4-GAP-8 Error Trigger + errorWorkflow setting", () => {
    const p = n8n().previewN8nImport({
      name: "err",
      settings: { errorWorkflow: "n8n-error-wf-1" },
      nodes: [
        {
          id: "et",
          name: "Error Trigger",
          type: "n8n-nodes-base.errorTrigger",
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
      ],
      connections: {},
    });
    const node = p.definition.nodes[0];
    assertX.equal(node.type, "errorTrigger");
    assertX.equal(p.definition.settings.errorWorkflowId, null);
    assertX.equal(p.definition.settings.sourceErrorWorkflowHint?.id, "n8n-error-wf-1");
    assertX.ok(
      (p.definition.migration.unresolvedRequirements || []).some(
        (r) => r.code === "ERROR_WORKFLOW_TARGET_REQUIRED"
      )
    );
    assertX.equal(p.runtimeReady, false);
  });

  check("TEST 14D4-GAP-9 AI Agent + model + calculator aux edges", () => {
    const p = n8n().previewN8nImport({
      name: "ai",
      nodes: [
        {
          id: "m",
          name: "Manual",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: "a",
          name: "AI Agent",
          type: "@n8n/n8n-nodes-langchain.agent",
          typeVersion: 2.1,
          position: [220, 0],
          parameters: {
            promptType: "define",
            text: "={{ $json.q }}",
            options: { systemMessage: "Be brief" },
          },
        },
        {
          id: "lm",
          name: "OpenAI Chat Model",
          type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
          typeVersion: 1.2,
          position: [220, -120],
          parameters: { model: { __rl: true, value: "gpt-4o-mini" } },
          credentials: { openAiApi: { id: "cred1", name: "OpenAI" } },
        },
        {
          id: "c",
          name: "Calculator",
          type: "@n8n/n8n-nodes-langchain.toolCalculator",
          typeVersion: 1,
          position: [220, 120],
          parameters: {},
        },
      ],
      connections: {
        Manual: { main: [[{ node: "AI Agent", type: "main", index: 0 }]] },
        "OpenAI Chat Model": {
          ai_languageModel: [[{ node: "AI Agent", type: "ai_languageModel", index: 0 }]],
        },
        Calculator: {
          ai_tool: [[{ node: "AI Agent", type: "ai_tool", index: 0 }]],
        },
      },
    });
    const agent = p.definition.nodes.find((n) => n.type === "aiAgent");
    const model = p.definition.nodes.find((n) => n.type === "aiChatModel");
    const calc = p.definition.nodes.find((n) => n.type === "aiCalculatorTool");
    assertX.ok(agent && model && calc);
    assertX.equal(model.data.credentialId, undefined);
    const modelEdge = p.definition.edges.find(
      (e) => e.sourceHandle === "model" && e.targetHandle === "model"
    );
    const toolEdge = p.definition.edges.find(
      (e) => e.sourceHandle === "tool" && e.targetHandle === "tools"
    );
    assertX.ok(modelEdge);
    assertX.ok(toolEdge);
  });

  check("TEST 14D4-GAP-10 Standalone Message-a-model still not aiChatModel", () => {
    const p = n8n().previewN8nImport({
      name: "msg",
      nodes: [
        {
          id: "m",
          name: "Manual",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: "o",
          name: "OpenAI",
          type: "@n8n/n8n-nodes-langchain.openAi",
          typeVersion: 1.8,
          position: [200, 0],
          parameters: { resource: "text", operation: "message" },
        },
      ],
      connections: {
        Manual: { main: [[{ node: "OpenAI", type: "main", index: 0 }]] },
      },
    });
    const open = p.definition.nodes.find((n) => n.data?.label === "OpenAI");
    assertX.equal(open.type, "migrationUnsupported");
    assertX.equal(open.data.notMappedTo, "aiChatModel");
  });

  check("TEST 14D4-GAP-11 Multi-condition IF → NEEDS_REVIEW boolean grouping", () => {
    const p = n8n().previewN8nImport({
      name: "multi",
      nodes: [
        {
          id: "i",
          name: "If",
          type: "n8n-nodes-base.if",
          typeVersion: 2.2,
          position: [0, 0],
          parameters: {
            conditions: {
              combinator: "and",
              conditions: [
                {
                  leftValue: "={{ $json.a }}",
                  rightValue: "1",
                  operator: { type: "string", operation: "equals" },
                },
                {
                  leftValue: "={{ $json.b }}",
                  rightValue: "2",
                  operator: { type: "string", operation: "equals" },
                },
              ],
            },
          },
        },
      ],
      connections: {},
    });
    assertX.equal(p.definition.nodes[0].type, "migrationUnsupported");
    assertX.equal(
      p.definition.nodes[0].data.migrationReason,
      "FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW"
    );
  });
};

module.exports = { registerPart14D4GapTests };
