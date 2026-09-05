/**
 * Part 14C — Workflow Copilot diagnosis + fix proposals.
 *
 * Engine facts first; LLM only explains (or proposes bounded ops).
 * Never fabricates root causes. Never auto-applies / runs / activates.
 */

const {
  diagnoseWorkflow,
  validateCopilotOperations,
  normalizePlan,
  cloneJson,
  sanitizeValue,
  hashDefinition,
} = require("./workflowCopilot.service");
const { mapAiErrorCodeToMessage } = require("../utils/aiAgentUx");
const { AI_ERROR } = require("./workflowAiResources.service");

const DIAG_STATUS = Object.freeze({
  CONFIRMED: "confirmed",
  LIKELY: "likely",
  UNCERTAIN: "uncertain",
});

/** Central error knowledge — plain language + fix eligibility. */
const ERROR_KNOWLEDGE = Object.freeze({
  AI_MODEL_REQUIRED: {
    meaning: "This AI Agent needs one Chat Model connection before it can run.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: true,
    suggestedActions: [
      "Connect a Chat Model to the Agent's model port",
      "Or add a Chat Model resource and connect it",
    ],
  },
  AI_TOOL_NOT_FOUND: {
    meaning:
      "The model requested a tool that is not connected to this Agent.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: true,
    suggestedActions: [
      "Connect the matching tool resource to Agent.tools",
      "Or adjust the Agent prompt so it does not request that tool",
    ],
  },
  AI_TOOL_CALL_INVALID: {
    meaning: "The model returned invalid input for a tool call.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: [
      "Review the tool description and input schema",
      "Retry after clarifying the Agent prompt",
    ],
  },
  AI_AGENT_MAX_TOOL_ROUNDS: {
    meaning:
      "The Agent reached the maximum allowed tool-call rounds before producing a final answer.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: [
      "Review prompt and tool descriptions for repeated loops",
      "Inspect the tool-call trace for cycles",
    ],
  },
  AI_TOOL_TIMEOUT: {
    meaning: "A tool took too long to respond.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Retry later", "Check the external tool/API health"],
  },
  AI_MODEL_TIMEOUT: {
    meaning: "The model request timed out.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: [
      "Retry the run",
      "Optionally increase model timeout if the contract allows",
    ],
  },
  HTTP_DESTINATION_BLOCKED: {
    meaning:
      "The HTTP Request was blocked because the destination is not allowed by OpsAi's server-side network policy.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: [
      "Provide an allowed public HTTPS destination URL",
      "Do not use localhost, private, or metadata IPs",
    ],
  },
  HTTP_REDIRECT_BLOCKED: {
    meaning:
      "An HTTP redirect destination was blocked by OpsAi's network policy.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Use a destination that does not redirect to blocked hosts"],
  },
  RESPOND_WEBHOOK_CONTEXT_REQUIRED: {
    meaning: "Respond to Webhook only works inside a webhook-triggered run.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Trigger this workflow via Webhook with respond mode"],
  },
  RESPOND_WEBHOOK_WAIT_FORBIDDEN: {
    meaning:
      "A Wait node is not allowed on the path before Respond to Webhook in respond mode.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: [
      "Remove Wait from the respond path",
      "Or use immediate webhook response mode",
    ],
  },
  RESPOND_WEBHOOK_SUBWORKFLOW_FORBIDDEN: {
    meaning:
      "A durable Execute Workflow is not allowed before Respond to Webhook in respond mode.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Remove Execute Workflow from the respond path"],
  },
  RESPOND_WEBHOOK_REQUIRED: {
    meaning: "Respond mode requires a reachable Respond to Webhook node.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Add a Respond to Webhook node on the webhook path"],
  },
  RESPOND_WEBHOOK_MULTIPLE: {
    meaning: "Respond mode allows only one reachable Respond to Webhook node.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Keep a single Respond node on the respond path"],
  },
  OCCURRENCE_AMBIGUOUS: {
    meaning:
      "The expression referenced a node that ran multiple times and did not identify a unique occurrence.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: [
      "Use provenance-aware accessors ($item / $first / $last / $all[n])",
      "Or reference a node with a unique occurrence",
    ],
  },
  INVALID_GRAPH_EDGE: {
    meaning: "The workflow graph has an invalid connection.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Fix or remove the invalid edge"],
  },
  INVALID_LOOP_TOPOLOGY: {
    meaning: "The Loop controlled-cycle topology is invalid.",
    confidence: DIAG_STATUS.CONFIRMED,
    autoFixEligible: false,
    suggestedActions: ["Repair Loop continue/done wiring using the Loop contract"],
  },
});

const knowledgeFor = (code) => {
  const c = String(code || "").trim();
  if (ERROR_KNOWLEDGE[c]) return { code: c, ...ERROR_KNOWLEDGE[c] };
  if (c.startsWith("AI_")) {
    return {
      code: c,
      meaning: mapAiErrorCodeToMessage(c),
      confidence: DIAG_STATUS.CONFIRMED,
      autoFixEligible: false,
      suggestedActions: [],
    };
  }
  if (c.startsWith("HTTP_") || c.startsWith("RESPOND_")) {
    return {
      code: c,
      meaning: `Structured engine error: ${c}`,
      confidence: DIAG_STATUS.CONFIRMED,
      autoFixEligible: false,
      suggestedActions: [],
    };
  }
  return null;
};

const nodeTypeOf = (n) => n?.type || n?.data?.nodeType || null;
const nodeLabel = (n) =>
  n?.data?.label || n?.data?.parameters?.label || nodeTypeOf(n) || n?.id;

const sanitizeEvidenceDetail = (detail) => {
  const cleaned = sanitizeValue(detail);
  const text = JSON.stringify(cleaned);
  if (text && text.length > 1200) {
    return { truncated: true, preview: text.slice(0, 1200) };
  }
  return cleaned;
};

const looksLikeSecretLeak = (value) => {
  const s = JSON.stringify(value || "").toLowerCase();
  return /authorization|api[_-]?key|resume.?token|bearer\s+[a-z0-9]|password/.test(
    s
  );
};

/**
 * Build normalized diagnosis from static + runtime evidence.
 */
const buildDiagnosis = ({
  definition,
  selectedNodeId = null,
  execution = null,
  workflow = null,
  diagnosisSourceDefinition = null,
} = {}) => {
  const currentDef = definition || { version: 1, nodes: [], edges: [] };
  const sourceDef =
    diagnosisSourceDefinition ||
    execution?.definitionSnapshot ||
    currentDef;
  const staticDiag = diagnoseWorkflow(currentDef);
  const issues = [...(staticDiag.issues || [])];

  // Prioritize selected-node static issues
  if (selectedNodeId) {
    issues.sort((a, b) => {
      const as = a.nodeId === selectedNodeId ? 0 : 1;
      const bs = b.nodeId === selectedNodeId ? 0 : 1;
      return as - bs;
    });
  }

  const evidence = [];
  const warnings = [];
  let status = DIAG_STATUS.UNCERTAIN;
  let cause = "Insufficient evidence to determine a single root cause.";
  let problem = {
    code: null,
    nodeId: selectedNodeId || null,
    nodeName: null,
    nodeType: null,
    executionIndex: null,
  };
  let impact = null;
  let suggestedActions = [];
  let automaticallyFixable = false;
  const unresolvedInputs = [];

  const nodes = sourceDef?.nodes || currentDef.nodes || [];
  const findNode = (id) => nodes.find((n) => n.id === id);

  // --- Runtime execution path ---
  if (execution) {
    evidence.push({
      type: "run",
      label: "Run",
      detail: sanitizeEvidenceDetail({
        runId: execution.runId || null,
        status: execution.status || null,
      }),
    });

    if (execution.mergePorts && !execution.failedNodeId && execution.status !== "waiting") {
      evidence.push({
        type: "merge",
        label: "Merge port state",
        detail: sanitizeEvidenceDetail(execution.mergePorts),
      });
      if (status === DIAG_STATUS.UNCERTAIN) {
        status = DIAG_STATUS.CONFIRMED;
        cause = formatMergeCause(execution.mergePorts);
        problem = {
          code: "MERGE_PORT_STATE",
          nodeId: execution.mergeNodeId || selectedNodeId,
          nodeName: null,
          nodeType: "merge",
          executionIndex: null,
        };
      }
    }

    if (execution.switchRouting) {
      evidence.push({
        type: "switch",
        label: "Switch routing",
        detail: sanitizeEvidenceDetail(execution.switchRouting),
      });
    }

    if (execution.status === "waiting") {
      status = DIAG_STATUS.CONFIRMED;
      cause =
        execution.waitMode === "external"
          ? "Workflow is waiting for an external resume signal."
          : execution.waitMode === "time" || execution.waitMode === "afterTime"
            ? "Workflow is waiting for a scheduled Wait duration to elapse."
            : "Workflow is waiting for manual resume.";
      problem = {
        code: "WORKFLOW_WAITING",
        nodeId: execution.waitNodeId || execution.failedNodeId || selectedNodeId,
        nodeName: null,
        nodeType: "wait",
        executionIndex:
          execution.failedExecutionIndex != null
            ? Number(execution.failedExecutionIndex)
            : execution.waitExecutionIndex != null
              ? Number(execution.waitExecutionIndex)
              : null,
      };
      impact = "The run is paused, not failed.";
      suggestedActions = [
        "Resume the Wait when ready",
        "Do not treat this as a failed run",
      ];
      // Never expose tokens
      if (execution.resumeToken || execution.waitToken || execution.externalToken) {
        warnings.push({
          code: "TOKEN_REDACTED",
          message: "Wait resume tokens are never exposed to Copilot.",
        });
      }
    } else if (execution.emptyOutput && !execution.failedNodeId) {
      status = DIAG_STATUS.CONFIRMED;
      const n = findNode(execution.emptyOutputNodeId || selectedNodeId);
      problem = {
        code: "EMPTY_OUTPUT",
        nodeId: execution.emptyOutputNodeId || selectedNodeId,
        nodeName: n ? nodeLabel(n) : null,
        nodeType: n ? nodeTypeOf(n) : null,
        executionIndex:
          execution.failedExecutionIndex != null
            ? Number(execution.failedExecutionIndex)
            : null,
      };
      cause = `${problem.nodeName || "A node"} succeeded with zero output items, so downstream nodes received no items.`;
      impact = "Downstream nodes did not run because they had no input items — this is not a node failure.";
      suggestedActions = [
        "Review Filter/Condition rules if items were expected",
        "Inspect upstream data that fed this node",
      ];
      evidence.push({
        type: "empty_output",
        label: "Empty output",
        detail: sanitizeEvidenceDetail({
          nodeId: problem.nodeId,
          itemsOut: 0,
          status: "succeeded",
        }),
      });
    } else if (execution.status === "failed" || execution.failedNodeId || execution.safeError) {
      const failedId = execution.failedNodeId || selectedNodeId;
      const n = findNode(failedId);
      const code = execution.safeError?.code || null;
      const knowledge = knowledgeFor(code);
      const execIndex =
        execution.failedExecutionIndex != null
          ? Number(execution.failedExecutionIndex)
          : null;

      problem = {
        code: code || "RUNTIME_FAILURE",
        nodeId: failedId || null,
        nodeName: n ? nodeLabel(n) : execution.failedNodeName || null,
        nodeType: n ? nodeTypeOf(n) : execution.failedNodeType || null,
        executionIndex: execIndex,
      };

      if (knowledge) {
        status = knowledge.confidence;
        cause = knowledge.meaning;
        suggestedActions = [...(knowledge.suggestedActions || [])];
        automaticallyFixable = Boolean(knowledge.autoFixEligible);
      } else if (execution.httpStatus === 401 || execution.httpStatus === 403) {
        status = DIAG_STATUS.LIKELY;
        cause = `The API returned ${execution.httpStatus}. This often indicates an authentication or permission issue.`;
        suggestedActions = [
          "Check or select the correct credential",
          "Verify external API permissions",
        ];
        automaticallyFixable = false;
      } else if (execution.httpStatus === 404) {
        status = DIAG_STATUS.LIKELY;
        cause =
          "The API returned 404 Not Found — the endpoint or resource may not exist.";
        suggestedActions = ["Check URL, path, and resource IDs"];
      } else if (execution.httpStatus === 429) {
        status = DIAG_STATUS.LIKELY;
        cause = "The API returned 429 Too Many Requests (rate limited).";
        suggestedActions = [
          "Retry later",
          "Review rate-limit / backoff settings if available",
        ];
      } else if (execution.httpStatus >= 500) {
        status = DIAG_STATUS.LIKELY;
        cause = `The upstream API returned ${execution.httpStatus}. This is typically an external server error, not a workflow graph misconfiguration.`;
        suggestedActions = ["Retry later", "Check the upstream service status"];
      } else if (execution.timeout) {
        status = DIAG_STATUS.CONFIRMED;
        cause = `${execution.timeoutComponent || "A component"} timed out.`;
        suggestedActions = ["Retry", "Optionally increase timeout if supported"];
      } else if (execution.expressionError) {
        status = DIAG_STATUS.CONFIRMED;
        const ee = execution.expressionError;
        problem.code = ee.reason || ee.code || "EXPRESSION_ERROR";
        if (ee.reason === "OCCURRENCE_AMBIGUOUS") {
          const k = ERROR_KNOWLEDGE.OCCURRENCE_AMBIGUOUS;
          cause = k.meaning;
          suggestedActions = [...k.suggestedActions];
        } else {
          cause = ee.missingField
            ? `Expression could not resolve field "${ee.missingField}"${ee.expression ? ` in ${ee.expression}` : ""}.`
            : truncate(String(ee.message || "Expression resolution failed."), 400);
          suggestedActions = ["Correct the expression or upstream data shape"];
        }
      } else if (execution.safeError?.message) {
        status = DIAG_STATUS.LIKELY;
        cause = truncate(String(execution.safeError.message), 400);
        suggestedActions = ["Review the failed node configuration and input"];
      } else {
        status = DIAG_STATUS.UNCERTAIN;
        cause =
          "The run failed, but there is not enough structured evidence to name a single root cause.";
      }

      if (execIndex != null && (execution.loopContext || problem.nodeType)) {
        evidence.push({
          type: "occurrence",
          label: "Failed occurrence",
          detail: {
            nodeId: failedId,
            executionIndex: execIndex,
            iteration:
              execution.loopContext?.iteration != null
                ? execution.loopContext.iteration
                : execIndex,
          },
        });
        if (execution.loopContext) {
          impact = `Iteration/occurrence ${execIndex} failed; earlier successful iterations are unaffected.`;
        }
      }

      if (execution.inputPreview != null) {
        const safeIn = sanitizeEvidenceDetail(execution.inputPreview);
        if (!looksLikeSecretLeak(safeIn)) {
          evidence.push({
            type: "input",
            label: "Failed node input (safe)",
            detail: safeIn,
          });
        }
      }
      if (execution.outputPreview != null) {
        evidence.push({
          type: "output",
          label: "Failed node output (safe)",
          detail: sanitizeEvidenceDetail(execution.outputPreview),
        });
      }
      if (code) {
        evidence.push({
          type: "error_code",
          label: "Structured error",
          detail: { code, message: execution.safeError?.message || null },
        });
      }

      // HTTP blocked → unresolved URL for FIX
      if (code === "HTTP_DESTINATION_BLOCKED") {
        unresolvedInputs.push({
          field: "url",
          message: "Allowed API URL",
          nodeId: failedId,
        });
        automaticallyFixable = false;
      }

      // Tool trace under Agent
      if (Array.isArray(execution.toolTrace) && execution.toolTrace.length) {
        evidence.push({
          type: "tool_trace",
          label: "Agent tool calls",
          detail: execution.toolTrace.slice(0, 8).map((t) => ({
            toolName: t.name || t.toolName,
            status: t.status,
            durationMs: t.durationMs ?? null,
            errorCode: t.errorCode || null,
          })),
        });
        const failedTool = execution.toolTrace.find(
          (t) => String(t.status || "").toLowerCase() === "failed"
        );
        if (failedTool && !knowledge) {
          status = DIAG_STATUS.CONFIRMED;
          cause = `AI Agent failed while invoking tool "${failedTool.name || failedTool.toolName}".`;
          impact =
            "Tool providers are not separate workflow steps; the failure belongs to the Agent execution.";
        }
      }

      // Child lineage
      if (Array.isArray(execution.childLineage) && execution.childLineage.length) {
        const child = execution.childLineage.find(
          (c) => c.status === "failed" || c.status === "cancelled"
        );
        if (child) {
          evidence.push({
            type: "subworkflow",
            label: "Child workflow",
            detail: {
              childRunId: child.childRunId || child.runId || null,
              childWorkflowName: child.childWorkflowName || child.name || null,
              status: child.status,
            },
          });
          status = DIAG_STATUS.CONFIRMED;
          cause = `Parent Execute Workflow failed because child "${child.childWorkflowName || child.name || "workflow"}" ${child.status}.`;
          suggestedActions = [
            "Open the child workflow run to inspect the failure",
            "Do not mutate the parent graph to fake a child fix",
          ];
          automaticallyFixable = false;
          impact = "Fix belongs in the child workflow context.";
        }
      }

      // Error routing
      if (execution.errorRouting) {
        evidence.push({
          type: "error_routing",
          label: "Error Workflow",
          detail: {
            sourceStatus: execution.status || "failed",
            handlerRunStatus: execution.errorRouting.handlerRunStatus || null,
          },
        });
        if (execution.errorRouting.handlerRunStatus === "succeeded") {
          warnings.push({
            code: "SOURCE_STILL_FAILED",
            message:
              "Main workflow failed. Error handler completed successfully — source run remains failed.",
          });
        } else if (execution.errorRouting.handlerRunStatus === "failed") {
          warnings.push({
            code: "HANDLER_ALSO_FAILED",
            message:
              "Main workflow failed and the Error Workflow handler also failed.",
          });
        }
      }

      // Switch / Merge hints
      if (execution.switchRouting) {
        evidence.push({
          type: "switch",
          label: "Switch routing",
          detail: sanitizeEvidenceDetail(execution.switchRouting),
        });
      }
      if (execution.mergePorts) {
        evidence.push({
          type: "merge",
          label: "Merge port state",
          detail: sanitizeEvidenceDetail(execution.mergePorts),
        });
        if (!execution.failedNodeId) {
          status = DIAG_STATUS.CONFIRMED;
          cause = formatMergeCause(execution.mergePorts);
        }
      }
    }
  }

  // --- Static issues when no stronger runtime diagnosis ---
  if (
    status === DIAG_STATUS.UNCERTAIN &&
    issues.length > 0
  ) {
    const primary =
      (selectedNodeId && issues.find((i) => i.nodeId === selectedNodeId)) ||
      issues.find((i) => i.severity === "error") ||
      issues[0];
    const knowledge = knowledgeFor(primary.code);
    status = knowledge?.confidence || DIAG_STATUS.CONFIRMED;
    problem = {
      code: primary.code || null,
      nodeId: primary.nodeId || selectedNodeId || null,
      nodeName: primary.nodeId
        ? nodeLabel(findNode(primary.nodeId) || {})
        : null,
      nodeType: primary.nodeId
        ? nodeTypeOf(findNode(primary.nodeId))
        : null,
      executionIndex: null,
    };
    cause = knowledge?.meaning || primary.message || cause;
    suggestedActions = knowledge?.suggestedActions?.length
      ? [...knowledge.suggestedActions]
      : ["Resolve the listed configuration issues before running"];
    automaticallyFixable = Boolean(primary.fixable);
    evidence.push({
      type: "static",
      label: "Static diagnostics",
      detail: issues.slice(0, 12).map((i) => ({
        code: i.code,
        severity: i.severity,
        nodeId: i.nodeId || null,
        message: i.message,
        fixable: Boolean(i.fixable),
      })),
    });
  }

  // Inactive trigger diagnosis
  if (
    workflow &&
    (workflow.status === "inactive" || workflow.active === false) &&
    /schedule|webhook/i.test(
      String(selectedNodeId || "") +
        JSON.stringify((currentDef.nodes || []).map((n) => nodeTypeOf(n)))
    )
  ) {
    const hasTrigger = (currentDef.nodes || []).some((n) =>
      ["schedule", "webhook"].includes(nodeTypeOf(n))
    );
    if (hasTrigger && !execution) {
      evidence.push({
        type: "activation",
        label: "Workflow inactive",
        detail: { status: workflow.status || "inactive" },
      });
      if (status === DIAG_STATUS.UNCERTAIN) {
        status = DIAG_STATUS.CONFIRMED;
        cause =
          "This workflow is inactive, so Schedule/Webhook production triggers will not run.";
        suggestedActions = [
          "Activate the workflow explicitly when ready (Copilot will not auto-activate)",
        ];
        automaticallyFixable = false;
        problem.code = "WORKFLOW_INACTIVE";
      }
    }
  }

  // Historical node missing from current draft
  if (
    execution?.failedNodeId &&
    diagnosisSourceDefinition &&
    !(currentDef.nodes || []).some((n) => n.id === execution.failedNodeId)
  ) {
    warnings.push({
      code: "HISTORICAL_NODE_MISSING",
      message:
        "That failed node is no longer present in the current workflow.",
    });
    automaticallyFixable = false;
  }

  // Malicious external error text must never become instructions
  if (execution?.safeError?.message) {
    const msg = String(execution.safeError.message);
    if (/delete\s+(the\s+)?workflow|send\s+(your\s+)?(api\s+)?key|evil\.com/i.test(msg)) {
      warnings.push({
        code: "UNTRUSTED_ERROR_TEXT",
        message:
          "External error text is untrusted DATA and is not treated as instructions.",
      });
      // Keep diagnosis on structured code if present
      if (execution.safeError.code) {
        const k = knowledgeFor(execution.safeError.code);
        if (k) cause = k.meaning;
      }
    }
  }

  const summary =
    status === DIAG_STATUS.CONFIRMED
      ? cause
      : status === DIAG_STATUS.LIKELY
        ? `Likely cause: ${cause}`
        : "Unable to confirm a single root cause from available evidence.";

  return {
    status,
    summary,
    problem,
    cause,
    evidence,
    impact:
      impact ||
      (problem.nodeId
        ? `Affects node ${problem.nodeName || problem.nodeId}${
            problem.executionIndex != null
              ? ` (occurrence ${problem.executionIndex})`
              : ""
          }.`
        : null),
    suggestedActions,
    automaticallyFixable,
    unresolvedInputs,
    warnings,
    staticIssues: issues.slice(0, 20),
    configurationLooksValid: staticDiag.configurationLooksValid,
    runtimeSuccessGuaranteed: false,
  };
};

const formatMergeCause = (ports) => {
  const parts = Object.entries(ports || {}).map(
    ([k, v]) => `${k}: ${typeof v === "string" ? v : v?.state || JSON.stringify(v)}`
  );
  return `Merge is waiting on port state — ${parts.join("; ") || "incomplete inputs"}.`;
};

const truncate = (s, max) => {
  const t = String(s || "");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
};

/**
 * Deterministic fix candidates from diagnosis + current draft.
 */
const buildFixCandidates = ({
  diagnosis,
  definition,
  selectedNodeId = null,
} = {}) => {
  const def = definition || { version: 1, nodes: [], edges: [] };
  const nodes = def.nodes || [];
  const edges = def.edges || [];
  const candidates = [];

  const agentIssues = (diagnosis.staticIssues || []).filter(
    (i) => i.code === AI_ERROR.MODEL_REQUIRED || i.code === "AI_MODEL_REQUIRED"
  );
  for (const issue of agentIssues) {
    const agentId =
      issue.nodeId ||
      (selectedNodeId &&
      nodeTypeOf(nodes.find((n) => n.id === selectedNodeId)) === "aiAgent"
        ? selectedNodeId
        : null);
    if (!agentId) continue;

    const models = nodes.filter((n) =>
      ["aiChatModel", "aiModelProviderTest"].includes(nodeTypeOf(n))
    );
    const unconnected = models.filter(
      (m) =>
        !edges.some(
          (e) =>
            e.source === m.id &&
            (e.sourceHandle === "model" || e.targetHandle === "model")
        )
    );

    if (unconnected.length === 1) {
      candidates.push({
        issueCode: "AI_MODEL_REQUIRED",
        fixable: true,
        confidence: DIAG_STATUS.CONFIRMED,
        destructive: false,
        explanation: `Connect Chat Model ${unconnected[0].id} → Agent ${agentId}.model`,
        operations: [
          {
            type: "connectNodes",
            sourceNodeId: unconnected[0].id,
            sourceHandle: "model",
            targetNodeId: agentId,
            targetHandle: "model",
          },
        ],
        unresolvedInputs: [],
      });
    } else if (unconnected.length > 1) {
      candidates.push({
        issueCode: "AI_MODEL_REQUIRED",
        fixable: false,
        confidence: DIAG_STATUS.CONFIRMED,
        destructive: false,
        explanation: "Multiple Chat Model candidates — clarification required.",
        operations: [],
        clarifyingQuestions: [
          {
            id: "modelNodeId",
            prompt: "Which Chat Model should I connect to this Agent?",
            field: "modelNodeId",
            required: true,
            options: unconnected.map((m) => ({
              id: m.id,
              label: nodeLabel(m),
            })),
          },
        ],
        unresolvedInputs: [],
      });
    } else if (models.length === 0) {
      candidates.push({
        issueCode: "AI_MODEL_REQUIRED",
        fixable: true,
        confidence: DIAG_STATUS.LIKELY,
        destructive: false,
        explanation:
          "Add a Chat Model resource and connect it. Credential remains unresolved.",
        operations: [
          {
            type: "addNode",
            tempId: "model1",
            nodeType: "aiChatModel",
            parameters: {
              label: "Chat Model",
              provider: "openai",
              model: "gpt-4o-mini",
            },
          },
          {
            type: "connectNodes",
            sourceNodeId: "model1",
            sourceHandle: "model",
            targetNodeId: agentId,
            targetHandle: "model",
          },
        ],
        unresolvedInputs: [
          {
            field: "credentialId",
            message: "Chat Model credential",
            nodeType: "aiChatModel",
          },
        ],
      });
    }
  }

  // Matching unconnected tool for AI_TOOL_NOT_FOUND
  if (
    diagnosis.problem?.code === "AI_TOOL_NOT_FOUND" &&
    diagnosis.problem?.nodeId
  ) {
    const missingName = diagnosis.missingToolName || null;
    if (missingName) {
      const tool = nodes.find((n) => {
        const t = nodeTypeOf(n);
        if (!["aiCalculatorTool", "aiHttpTool", "aiToolProviderTest"].includes(t))
          return false;
        const name = String(n.data?.toolName || n.data?.name || "").trim();
        return name === missingName;
      });
      if (tool) {
        const connected = edges.some(
          (e) =>
            e.source === tool.id &&
            e.target === diagnosis.problem.nodeId &&
            e.targetHandle === "tools"
        );
        if (!connected) {
          candidates.push({
            issueCode: "AI_TOOL_NOT_FOUND",
            fixable: true,
            confidence: DIAG_STATUS.CONFIRMED,
            destructive: false,
            explanation: `Connect tool ${tool.id} → Agent.tools`,
            operations: [
              {
                type: "connectNodes",
                sourceNodeId: tool.id,
                sourceHandle: "tool",
                targetNodeId: diagnosis.problem.nodeId,
                targetHandle: "tools",
              },
            ],
            unresolvedInputs: [],
          });
        }
      }
    }
  }

  // HTTP blocked / missing URL — unresolved only
  if (
    diagnosis.problem?.code === "HTTP_DESTINATION_BLOCKED" ||
    (diagnosis.unresolvedInputs || []).some((u) => u.field === "url")
  ) {
    candidates.push({
      issueCode: diagnosis.problem?.code || "HTTP_URL_REQUIRED",
      fixable: false,
      confidence: DIAG_STATUS.CONFIRMED,
      destructive: false,
      explanation: "URL must be provided by the user — Copilot will not invent one.",
      operations: [],
      unresolvedInputs: [
        {
          field: "url",
          message: "Allowed API URL",
          nodeId: diagnosis.problem?.nodeId || null,
        },
      ],
    });
  }

  return candidates;
};

/**
 * Validate fix operations against current draft; return applicable fixPlan or null.
 */
const validateFixPlan = ({
  definition,
  operations,
  summary,
  unresolvedInputs = [],
  warnings = [],
  destructive = false,
}) => {
  if (!operations || operations.length === 0) {
    return {
      valid: false,
      applicable: false,
      summary: summary || "No operations",
      plan: normalizePlan({
        intent: "FIX",
        summary: summary || "",
        operations: [],
        unresolvedInputs,
        warnings,
      }),
      preview: null,
      unresolvedInputs,
      warnings,
      destructive,
    };
  }

  const validation = validateCopilotOperations({
    definition,
    operations,
    baseRevisionHash: null,
  });

  return {
    valid: validation.valid,
    applicable: Boolean(validation.valid),
    summary: summary || "",
    plan: normalizePlan({
      intent: "FIX",
      summary: summary || "",
      operations: validation.valid ? operations : [],
      unresolvedInputs: [
        ...unresolvedInputs,
        ...(validation.unresolvedInputs || []),
      ],
      warnings: [...warnings, ...(validation.warnings || [])],
    }),
    preview: validation.valid ? validation.preview : null,
    unresolvedInputs: [
      ...unresolvedInputs,
      ...(validation.unresolvedInputs || []),
    ],
    warnings: [...warnings, ...(validation.warnings || [])],
    destructive,
    validation,
  };
};

/**
 * Compose assistant message from diagnosis (+ optional fix).
 */
const formatDiagnosisMessage = (diagnosis, { intent = "DEBUG", fixPlan = null } = {}) => {
  const lines = [];
  lines.push(diagnosis.summary || diagnosis.cause || "Diagnosis complete.");
  if (diagnosis.problem?.code) {
    lines.push(`Code: ${diagnosis.problem.code}`);
  }
  if (
    diagnosis.problem?.executionIndex != null &&
    diagnosis.problem?.nodeId
  ) {
    lines.push(
      `Failed occurrence: ${diagnosis.problem.nodeId}#${diagnosis.problem.executionIndex}`
    );
  }
  if (diagnosis.impact) lines.push(diagnosis.impact);
  for (const w of diagnosis.warnings || []) {
    lines.push(typeof w === "string" ? w : w.message);
  }
  if (intent === "FIX") {
    if (fixPlan?.applicable) {
      lines.push(
        "Proposed fix is validated against the current draft. This change should resolve the configuration issue — it will not automatically re-run the workflow."
      );
    } else if (fixPlan?.clarifyingQuestions?.length) {
      lines.push(fixPlan.clarifyingQuestions[0].prompt);
    } else if ((diagnosis.unresolvedInputs || []).length) {
      lines.push(
        `I need: ${(diagnosis.unresolvedInputs || []).map((u) => u.message || u.field).join(", ")}.`
      );
    } else if (!diagnosis.automaticallyFixable) {
      lines.push(
        "I cannot safely auto-fix this from available evidence. See suggested actions."
      );
    }
  } else if ((diagnosis.suggestedActions || []).length) {
    lines.push(
      "Suggested actions: " + diagnosis.suggestedActions.slice(0, 4).join("; ")
    );
  }
  return lines.filter(Boolean).join("\n");
};

/**
 * Full DEBUG or FIX turn (deterministic core).
 */
const runDiagnosticTurn = ({
  intent,
  definition,
  selectedNodeId,
  execution,
  workflow,
  diagnosisSourceDefinition = null,
  clarification = null,
  forceFixOps = null,
} = {}) => {
  const diagnosis = buildDiagnosis({
    definition,
    selectedNodeId,
    execution,
    workflow,
    diagnosisSourceDefinition,
  });

  let fixPlan = null;
  let clarifyingQuestions = [];

  if (intent === "FIX") {
    // Historical node gone from current draft
    if (
      (diagnosis.warnings || []).some(
        (w) => w.code === "HISTORICAL_NODE_MISSING"
      )
    ) {
      fixPlan = {
        applicable: false,
        summary: "Cannot fix — failed node missing from current draft",
        plan: normalizePlan({
          intent: "FIX",
          summary: "No fix",
          operations: [],
        }),
        preview: null,
        unresolvedInputs: [],
        warnings: diagnosis.warnings,
        destructive: false,
      };
    } else if (Array.isArray(forceFixOps)) {
      fixPlan = validateFixPlan({
        definition,
        operations: forceFixOps,
        summary: "Forced fixture fix",
      });
    } else {
      let candidates = buildFixCandidates({
        diagnosis,
        definition,
        selectedNodeId,
      });

      // Clarification answer for model choice
      if (
        clarification?.questionId === "modelNodeId" &&
        clarification?.answer &&
        diagnosis.problem?.nodeId
      ) {
        candidates = [
          {
            issueCode: "AI_MODEL_REQUIRED",
            fixable: true,
            confidence: DIAG_STATUS.CONFIRMED,
            destructive: false,
            explanation: "Connect selected Chat Model",
            operations: [
              {
                type: "connectNodes",
                sourceNodeId: clarification.answer,
                sourceHandle: "model",
                targetNodeId: diagnosis.problem.nodeId,
                targetHandle: "model",
              },
            ],
            unresolvedInputs: [],
          },
        ];
      }

      const primary = candidates[0];
      if (primary?.clarifyingQuestions?.length) {
        clarifyingQuestions = primary.clarifyingQuestions;
        fixPlan = {
          applicable: false,
          summary: primary.explanation,
          plan: normalizePlan({
            intent: "FIX",
            summary: primary.explanation,
            operations: [],
          }),
          preview: null,
          unresolvedInputs: primary.unresolvedInputs || [],
          warnings: [],
          destructive: false,
          clarifyingQuestions,
        };
      } else if (primary?.operations?.length) {
        fixPlan = validateFixPlan({
          definition,
          operations: primary.operations,
          summary: primary.explanation,
          unresolvedInputs: primary.unresolvedInputs || [],
          destructive: Boolean(primary.destructive),
        });
      } else if (primary?.unresolvedInputs?.length) {
        fixPlan = {
          applicable: false,
          summary: primary.explanation,
          plan: normalizePlan({
            intent: "FIX",
            summary: primary.explanation,
            operations: [],
            unresolvedInputs: primary.unresolvedInputs,
          }),
          preview: null,
          unresolvedInputs: primary.unresolvedInputs,
          warnings: [],
          destructive: false,
        };
      } else {
        fixPlan = {
          applicable: false,
          summary: "No safe automatic fix available",
          plan: normalizePlan({
            intent: "FIX",
            summary: "No safe automatic fix",
            operations: [],
          }),
          preview: null,
          unresolvedInputs: diagnosis.unresolvedInputs || [],
          warnings: [],
          destructive: false,
        };
      }
    }
  }

  const assistantMessage = formatDiagnosisMessage(diagnosis, {
    intent,
    fixPlan,
  });

  return {
    intent,
    assistantMessage,
    summary: diagnosis.summary,
    diagnosis,
    evidence: diagnosis.evidence,
    fixPlan:
      intent === "FIX"
        ? {
            summary: fixPlan?.summary || null,
            plan: fixPlan?.plan || null,
            preview: fixPlan?.preview || null,
            unresolvedInputs: fixPlan?.unresolvedInputs || [],
            warnings: fixPlan?.warnings || [],
            destructive: Boolean(fixPlan?.destructive),
            applicable: Boolean(fixPlan?.applicable),
          }
        : null,
    plan:
      intent === "FIX" && fixPlan?.applicable
        ? fixPlan.plan
        : normalizePlan({
            intent,
            summary: diagnosis.summary,
            operations: [],
          }),
    preview: intent === "FIX" ? fixPlan?.preview || null : null,
    unresolvedInputs:
      intent === "FIX"
        ? fixPlan?.unresolvedInputs || diagnosis.unresolvedInputs || []
        : diagnosis.unresolvedInputs || [],
    clarifyingQuestions,
    assumptions: [],
    warnings: [
      ...(diagnosis.warnings || []),
      ...(fixPlan?.warnings || []),
    ],
    needsClarification: clarifyingQuestions.some((q) => q.required),
    createdWorkflowRun: false,
  };
};

module.exports = {
  DIAG_STATUS,
  ERROR_KNOWLEDGE,
  knowledgeFor,
  buildDiagnosis,
  buildFixCandidates,
  validateFixPlan,
  formatDiagnosisMessage,
  runDiagnosticTurn,
  sanitizeEvidenceDetail,
};
