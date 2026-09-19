const asyncHandler = require("../../utils/asyncHandler");
const workflowsService = require("./workflows.service");
const credentialsService = require("./credentials.service");

const list = asyncHandler(async (req, res) => {
  if (req.query.workspaceId) {
    res.json(
      await workflowsService.listByWorkspace(req.query.workspaceId, req.user)
    );
    return;
  }
  res.json(await workflowsService.listAll(req.user));
});

const listCallableTargets = asyncHandler(async (req, res) => {
  if (!req.query.workspaceId) {
    res.status(400).json({ message: "workspaceId is required" });
    return;
  }
  res.json(
    await workflowsService.listCallableTargets(
      req.query.workspaceId,
      req.user,
      { excludeWorkflowId: req.query.excludeWorkflowId || null }
    )
  );
});

const listErrorTargets = asyncHandler(async (req, res) => {
  if (!req.query.workspaceId) {
    res.status(400).json({ message: "workspaceId is required" });
    return;
  }
  res.json(
    await workflowsService.listErrorTargets(req.query.workspaceId, req.user, {
      excludeWorkflowId: req.query.excludeWorkflowId || null,
    })
  );
});

const setErrorWorkflow = asyncHandler(async (req, res) => {
  const raw = req.body?.errorWorkflowId;
  const errorWorkflowId =
    raw === undefined || raw === null || raw === "" ? null : String(raw);
  res.json(
    await workflowsService.setErrorWorkflow(
      req.params.id,
      errorWorkflowId,
      req.user
    )
  );
});

const getById = asyncHandler(async (req, res) => {
  res.json(await workflowsService.getById(req.params.id, req.user));
});

const create = asyncHandler(async (req, res) => {
  const workflow = await workflowsService.create(req.body, req.user);
  res.status(201).json(workflow);
});

const update = asyncHandler(async (req, res) => {
  res.json(await workflowsService.update(req.params.id, req.body, req.user));
});

const remove = asyncHandler(async (req, res) => {
  res.json(await workflowsService.remove(req.params.id, req.user));
});

const startRun = asyncHandler(async (req, res) => {
  const run = await workflowsService.startRun(
    req.params.id,
    req.body?.input ?? {},
    req.user
  );
  res.status(201).json(run);
});

/** Inbound webhook trigger — body becomes run input. */
const webhookTrigger = asyncHandler(async (req, res) => {
  const payload =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : { payload: req.body };
  const idempotencyKey =
    req.get("Idempotency-Key") ||
    req.get("X-Idempotency-Key") ||
    (typeof payload.idempotencyKey === "string"
      ? payload.idempotencyKey
      : null);
  const delivery = await workflowsService.startWebhookDelivery(
    req.params.id,
    payload,
    req.user,
    idempotencyKey ? String(idempotencyKey).slice(0, 190) : null
  );
  if (delivery.mode === "respond" && delivery.httpResponse) {
    const hr = delivery.httpResponse;
    for (const [k, v] of Object.entries(hr.headers || {})) {
      res.setHeader(k, v);
    }
    if (hr.responseType === "text") {
      res.status(hr.statusCode).send(hr.body == null ? "" : String(hr.body));
      return;
    }
    res.status(hr.statusCode).json(hr.body);
    return;
  }
  res.status(201).json(delivery.run);
});

/**
 * Editor Test trigger for webhooks — always returns run + httpResponse envelope
 * so Respond-mode UIs can show the custom reply without losing run history.
 */
const webhookTestTrigger = asyncHandler(async (req, res) => {
  const payload =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : { payload: req.body };
  const delivery = await workflowsService.startWebhookDelivery(
    req.params.id,
    payload,
    req.user,
    null
  );
  res.status(200).json({
    mode: delivery.mode,
    run: delivery.run,
    httpResponse: delivery.httpResponse || null,
  });
});

const listCredentials = asyncHandler(async (req, res) => {
  res.json(
    await credentialsService.listByWorkspace(req.query.workspaceId, req.user)
  );
});

const createCredential = asyncHandler(async (req, res) => {
  res.status(201).json(await credentialsService.create(req.body, req.user));
});

const removeCredential = asyncHandler(async (req, res) => {
  await credentialsService.remove(req.params.credentialId, req.user);
  res.json({ success: true });
});

const startGoogleOAuth = asyncHandler(async (req, res) => {
  const googleOAuth = require("../../services/googleOAuth.service");
  res.json(
    await googleOAuth.startGoogleOAuth(
      {
        workspaceId: req.body?.workspaceId,
        workflowId: req.body?.workflowId,
        product: req.body?.product,
        name: req.body?.name,
        credentialId: req.body?.credentialId,
        gmailPermissions: req.body?.gmailPermissions,
      },
      req.user
    )
  );
});

const listConnectionTypes = asyncHandler(async (_req, res) => {
  const registry = require("../../services/connectionRegistry.service");
  const googleOAuth = require("../../services/googleOAuth.service");
  res.json({
    predefined: registry.listPredefined(),
    generic: registry.listGenericMethods(),
    oauth2RedirectUri: require("../../services/genericOAuth2.service").redirectUri(),
    googleOAuthRedirectUri: googleOAuth.redirectUri(),
    platformManagedGoogleOAuthAvailable: googleOAuth.platformClientConfigured(),
  });
});

const getCredentialEditor = asyncHandler(async (req, res) => {
  res.json(await credentialsService.getEditorView(req.params.credentialId, req.user));
});

const updateCredential = asyncHandler(async (req, res) => {
  res.json(
    await credentialsService.update(req.params.credentialId, req.body, req.user)
  );
});

const startOAuth2 = asyncHandler(async (req, res) => {
  const genericOAuth2 = require("../../services/genericOAuth2.service");
  res.json(
    await genericOAuth2.startOAuth2(
      {
        workspaceId: req.body?.workspaceId,
        credentialId: req.body?.credentialId,
      },
      req.user
    )
  );
});

const oauth2Callback = asyncHandler(async (req, res) => {
  const genericOAuth2 = require("../../services/genericOAuth2.service");
  try {
    const result = await genericOAuth2.finishOAuth2(req.query.code, req.query.state);
    genericOAuth2.applyOAuthPopupResponseHeaders(res);
    res.send(
      genericOAuth2.oauth2CallbackHtml({
        ok: true,
        credentialId: result.credentialId,
      })
    );
  } catch (err) {
    genericOAuth2.applyOAuthPopupResponseHeaders(res);
    res.status(400).send(
      genericOAuth2.oauth2CallbackHtml({
        ok: false,
        error: genericOAuth2.sanitizeOAuth2Error(err),
      })
    );
  }
});

const testCredential = asyncHandler(async (req, res) => {
  const googleOAuth = require("../../services/googleOAuth.service");
  const { pool } = require("../../config/database");
  const { assertWorkspaceAccess } = require("../../services/authorization.service");
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [req.params.credentialId]
  );
  if (!rows.length) {
    const AppError = require("../../utils/AppError");
    throw new AppError("Credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(req.user, rows[0].workspace_id);
  if (googleOAuth.GOOGLE_TYPES.has(rows[0].type)) {
    res.json(await googleOAuth.testGoogleCredential(req.params.credentialId, req.user));
    return;
  }
  if (rows[0].type === "oauth2") {
    const view = await credentialsService.getEditorView(req.params.credentialId, req.user);
    if (view.editor?.hasAccessToken || view.connected) {
      res.json({ ok: true, type: "oauth2", message: "Account connected" });
      return;
    }
    res.json({
      ok: false,
      type: "oauth2",
      message: "Connect your account to use this connection",
    });
    return;
  }
  res.json({ ok: true, type: rows[0].type, message: "Connection tested successfully" });
});

const listGscSites = asyncHandler(async (req, res) => {
  const resources = require("../../services/workflowGoogleResources.service");
  const credentialId = String(req.query.credentialId || "").trim();
  const workspaceId = String(req.query.workspaceId || "").trim();
  res.json(await resources.listGscSitesForCredential({ credentialId, workspaceId }));
});

const listGa4Properties = asyncHandler(async (req, res) => {
  const resources = require("../../services/workflowGoogleResources.service");
  const credentialId = String(req.query.credentialId || "").trim();
  const workspaceId = String(req.query.workspaceId || "").trim();
  res.json(await resources.listGa4PropertiesForCredential({ credentialId, workspaceId }));
});

const listGmailLabels = asyncHandler(async (req, res) => {
  const resources = require("../../services/workflowGoogleResources.service");
  const credentialId = String(req.query.credentialId || "").trim();
  const workspaceId = String(req.query.workspaceId || "").trim();
  res.json(await resources.listGmailLabelsForCredential({ credentialId, workspaceId }));
});

const listSheetTabs = asyncHandler(async (req, res) => {
  const resources = require("../../services/workflowGoogleResources.service");
  const credentialId = String(req.query.credentialId || "").trim();
  const workspaceId = String(req.query.workspaceId || "").trim();
  const spreadsheetId = String(req.query.spreadsheetId || "").trim();
  res.json(
    await resources.listSheetTabsForSpreadsheet({
      credentialId,
      workspaceId,
      spreadsheetId,
    })
  );
});

const listGscMcpTools = asyncHandler(async (req, res) => {
  const host = require("../../services/mcpPluginHost.service");
  const payload = await host.listGscMcpTools({
    credentialId: String(req.query.credentialId || "").trim() || undefined,
    workspaceId: String(req.query.workspaceId || "").trim() || undefined,
    audience: String(req.query.audience || "assistant").trim() || "assistant",
    authUser: req.user,
  });
  res.json(payload);
});

const executeGscMcpTool = asyncHandler(async (req, res) => {
  const host = require("../../services/mcpPluginHost.service");
  const result = await host.executeGscMcpTool({
    toolId: req.body?.toolId,
    toolArgs: req.body?.toolArgs || {},
    mode: req.body?.mode || "raw",
    credentialId: String(req.body?.credentialId || "").trim(),
    workspaceId: String(req.body?.workspaceId || "").trim() || undefined,
    authUser: req.user,
  });
  res.json(result);
});

const gscMcpIntentHints = asyncHandler(async (req, res) => {
  const host = require("../../services/mcpPluginHost.service");
  res.json(host.intentHints(String(req.body?.text || req.query.text || "")));
});

const googleOAuthCallback = asyncHandler(async (req, res) => {
  const googleOAuth = require("../../services/googleOAuth.service");
  try {
    if (req.query.error) {
      const reason = String(req.query.error_description || req.query.error || "")
        .slice(0, 180);
      const friendly =
        /access_denied/i.test(String(req.query.error))
          ? "Google blocked sign-in (access_denied). If the app is in Testing, add this Google account as a test user — or use Custom OAuth2 with your own Google Cloud client. Unverified apps cannot be used by arbitrary Gmail accounts."
          : reason || "Google connect failed";
      googleOAuth.applyOAuthPopupResponseHeaders(res);
      res.status(400).send(
        googleOAuth.oauthCallbackHtml({
          ok: false,
          error: friendly,
        })
      );
      return;
    }
    const result = await googleOAuth.finishGoogleOAuth(req.query.code, req.query.state);
    googleOAuth.applyOAuthPopupResponseHeaders(res);
    res.send(
      googleOAuth.oauthCallbackHtml({
        ok: true,
        credentialId: result.credentialId,
      })
    );
  } catch (err) {
    try {
      console.warn(
        "[google-oauth] callback failed",
        JSON.stringify({
          code: err?.code || null,
          message: String(err?.message || "OAuth failed").slice(0, 160),
        })
      );
    } catch {
      // ignore
    }
    googleOAuth.applyOAuthPopupResponseHeaders(res);
    res.status(400).send(
      googleOAuth.oauthCallbackHtml({
        ok: false,
        error: googleOAuth.sanitizeCallbackError(err),
      })
    );
  }
});

const listRuns = asyncHandler(async (req, res) => {
  res.json(await workflowsService.listRuns(req.params.id, req.user));
});

const getRun = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.getRunById(req.params.runId, req.user, {
      workflowId: req.params.id,
    })
  );
});

const getRunLineage = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.getRunLineage(
      req.params.id,
      req.params.runId,
      req.user
    )
  );
});

const getErrorRouting = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.getErrorRoutingForRun(
      req.params.id,
      req.params.runId,
      req.user
    )
  );
});

const getChildInvocation = asyncHandler(async (req, res) => {
  const executionIndex = Number(req.query.executionIndex);
  res.json(
    await workflowsService.getChildInvocationForStep(
      req.params.id,
      req.params.runId,
      req.params.nodeId,
      Number.isFinite(executionIndex) ? executionIndex : 0,
      req.user
    )
  );
});

const cancelRun = asyncHandler(async (req, res) => {
  res.json(await workflowsService.cancelRun(req.params.runId, req.user));
});

const resumeRun = asyncHandler(async (req, res) => {
  const result = await workflowsService.resumeRun(
    req.params.id,
    req.params.runId,
    req.user
  );
  res.status(202).json(result);
});

/** Public opaque-token resume — token in body only (never query/path). */
const resumeByExternalToken = asyncHandler(async (req, res) => {
  const token =
    (typeof req.body?.token === "string" && req.body.token) ||
    (typeof req.headers.authorization === "string" &&
    req.headers.authorization.toLowerCase().startsWith("bearer ")
      ? req.headers.authorization.slice(7).trim()
      : null);
  const result = await workflowsService.resumeByExternalToken(token);
  res.status(result.status).json(result.body);
});

const executeNodeStep = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.executeNodeStep(
      req.params.id,
      req.params.nodeId,
      req.body,
      req.user
    )
  );
});

const runToNode = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.runToNode(
      req.params.id,
      req.params.nodeId,
      req.body,
      req.user
    )
  );
});

const executePrevious = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.executePrevious(
      req.params.id,
      req.params.nodeId,
      req.body,
      req.user
    )
  );
});

const getNodeInput = asyncHandler(async (req, res) => {
  let definitionOverride;
  if (req.query.definition) {
    try {
      definitionOverride = JSON.parse(String(req.query.definition));
    } catch {
      definitionOverride = undefined;
    }
  }
  res.json(
    await workflowsService.getNodeInput(
      req.params.id,
      req.params.nodeId,
      req.user,
      definitionOverride
    )
  );
});

const getEditorSession = asyncHandler(async (req, res) => {
  res.json(await workflowsService.getEditorSession(req.params.id, req.user));
});

const previewExpression = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.previewExpression(
      req.params.id,
      req.params.nodeId,
      req.body,
      req.user
    )
  );
});

const previewScheduleOccurrences = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.previewScheduleOccurrences(
      req.params.id,
      { ...req.body, nodeId: req.params.nodeId },
      req.user
    )
  );
});

const invalidateEditorSession = asyncHandler(async (req, res) => {
  res.json(
    await workflowsService.invalidateEditorSession(
      req.params.id,
      req.body,
      req.user
    )
  );
});

/** Part 14A — Copilot context (safe, bounded). Does not create workflow runs. */
const copilotContext = asyncHandler(async (req, res) => {
  const workflow = await workflowsService.getById(req.params.id, req.user);
  const definition = req.body?.definition || workflow.definition;
  const {
    buildCopilotContext,
  } = require("../../services/workflowCopilot.service");
  res.json(
    buildCopilotContext({
      workflow,
      definition,
      selectedNodeId: req.body?.selectedNodeId || null,
      execution: req.body?.execution || null,
      intent: req.body?.intent || "EXPLAIN",
    })
  );
});

/** Part 14A — validate Copilot plan without mutating editor/DB. */
const copilotValidatePlan = asyncHandler(async (req, res) => {
  await workflowsService.getById(req.params.id, req.user);
  const {
    validateCopilotOperations,
    normalizePlan,
  } = require("../../services/workflowCopilot.service");
  const plan = normalizePlan(req.body?.plan || req.body);
  const result = validateCopilotOperations({
    definition: req.body?.definition,
    operations: plan.operations,
    workflowId: req.params.id,
    baseRevisionHash: req.body?.baseRevisionHash,
    workspace: req.body?.workspace,
    intentHints: req.body?.intentHints,
  });
  res.json({ ...result, plan: { ...plan, unresolvedInputs: result.unresolvedInputs } });
});

/**
 * Part 14A — apply Copilot plan to a draft definition (returned only).
 * Does not persist, execute, or activate. Client applies to editor draft.
 */
const copilotApplyPlan = asyncHandler(async (req, res) => {
  await workflowsService.getById(req.params.id, req.user);
  const {
    applyCopilotOperations,
    normalizePlan,
  } = require("../../services/workflowCopilot.service");
  const plan = normalizePlan(req.body?.plan || req.body);
  const result = applyCopilotOperations({
    definition: req.body?.definition,
    operations: plan.operations,
    workflowId: req.params.id,
    baseRevisionHash: req.body?.baseRevisionHash,
    workspace: req.body?.workspace,
    intentHints: req.body?.intentHints,
  });
  res.json(result);
});

/** Part 14A — static diagnosis aggregator. */
const copilotDiagnose = asyncHandler(async (req, res) => {
  await workflowsService.getById(req.params.id, req.user);
  const {
    diagnoseWorkflow,
  } = require("../../services/workflowCopilot.service");
  const definition = req.body?.definition;
  res.json(diagnoseWorkflow(definition));
});

/**
 * Part 14B — planning turn for future Copilot drawer.
 * Accepts message + context; returns plan envelope. Never creates workflow_runs.
 */
const copilotPlan = asyncHandler(async (req, res) => {
  const workflow = await workflowsService.getById(req.params.id, req.user);
  const {
    planCopilotTurn,
  } = require("../../services/workflowCopilotPlan.service");
  // Prefer unsaved draft; never trust client execution as authoritative.
  const draft =
    req.body?.currentDraftDefinition || req.body?.definition || null;
  const result = await planCopilotTurn({
    message: req.body?.message,
    workflowId: req.params.id,
    revisionHash: req.body?.revisionHash,
    selectedNodeId: req.body?.selectedNodeId,
    runId: req.body?.runId,
    recentConversation: req.body?.recentConversation,
    clarification: req.body?.clarification,
    currentDraftDefinition: draft,
    workflow,
    workflowReferences: req.body?.workflowReferences,
    authUser: req.user,
    allowClientExecution: false,
  });
  res.json(result);
});

/** Part 14D.4 — static n8n import preview (no persist / no code execution). */
const previewN8nImport = asyncHandler(async (req, res) => {
  const {
    previewN8nImport: preview,
  } = require("../../services/n8nWorkflowImport.service");
  const result = preview(req.body?.workflow || req.body);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

/** Part 14D.4 — import n8n export as inactive draft. */
const importN8nDraft = asyncHandler(async (req, res) => {
  const {
    buildDraftImport,
  } = require("../../services/n8nWorkflowImport.service");
  const workspaceId = req.body?.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ message: "workspaceId is required" });
    return;
  }
  const built = buildDraftImport(req.body?.workflow || req.body, {
    name: req.body?.name,
  });
  if (!built.ok) {
    res.status(400).json(built);
    return;
  }
  const created = await workflowsService.create(
    {
      name: built.draft.name,
      description: built.draft.description,
      workspaceId,
      definition: built.draft.definition,
    },
    req.user
  );
  res.status(201).json({
    workflow: created,
    report: built.report,
    runtimeReady: built.runtimeReady,
    structureImportable: built.structureImportable,
  });
});

/** Part 14D.4 — unified import preview (OpsAi native | n8n | unknown). */
const previewWorkflowImport = asyncHandler(async (req, res) => {
  const portability = require("../../services/opsaiWorkflowPortability.service");
  const source = req.body?.workflow || req.body?.source || req.body;
  const rawLength = Buffer.byteLength(JSON.stringify(source || {}), "utf8");
  let result;
  try {
    result = portability.previewUnifiedImport(source, { rawLength });
  } catch (err) {
    res.status(err.statusCode || 400).json({
      ok: false,
      error: err.message,
      code: err.code || "IMPORT_PREVIEW_FAILED",
    });
    return;
  }
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  const workspaceId = req.body?.workspaceId || null;
  const commitToken =
    workspaceId && req.user?.userId
      ? portability.createPreviewCommitToken({
          fingerprint: result.fingerprint,
          workspaceId,
          userId: req.user.userId,
          format: result.format || result.detection?.format,
        })
      : null;
  res.json({ ...result, commitToken });
});

/** Part 14D.4 — unified import commit → new inactive draft. */
const commitWorkflowImport = asyncHandler(async (req, res) => {
  const portability = require("../../services/opsaiWorkflowPortability.service");
  const workspaceId = req.body?.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ message: "workspaceId is required" });
    return;
  }
  await require("../../services/authorization.service").assertWorkspaceAccess(
    req.user,
    workspaceId
  );

  const source = req.body?.workflow || req.body?.source;
  if (!source || typeof source !== "object") {
    res.status(400).json({ message: "workflow/source JSON is required" });
    return;
  }

  // Reject client-supplied definition — always recompute from source.
  if (req.body?.previewDefinition || req.body?.definition) {
    // Ignore client definition; revalidation below is authoritative.
  }

  const rawLength = Buffer.byteLength(JSON.stringify(source), "utf8");
  let built;
  try {
    built = portability.buildUnifiedDraft(source, { name: req.body?.name });
  } catch (err) {
    res.status(err.statusCode || 400).json({
      ok: false,
      error: err.message,
      code: err.code || "IMPORT_COMMIT_FAILED",
    });
    return;
  }
  if (!built.ok) {
    res.status(400).json(built);
    return;
  }

  const format = built.format || built.detection?.format;
  const tokenCheck = portability.verifyPreviewCommitToken({
    token: req.body?.commitToken,
    fingerprint: built.fingerprint,
    workspaceId,
    userId: req.user.userId,
    format,
  });
  if (!tokenCheck.ok) {
    res.status(400).json({
      ok: false,
      error: "Import commit token invalid or mismatched — re-run preview",
      code: tokenCheck.code || "PREVIEW_COMMIT_TAMPER",
    });
    return;
  }

  // n8n runtime gate when migrating unsupported nodes
  if (format === "N8N" || format === "n8n") {
    // Draft create always allowed; run/activate blocked separately.
  }

  const created = await workflowsService.create(
    {
      name: built.draft.name,
      description: built.draft.description,
      workspaceId,
      definition: built.draft.definition,
    },
    req.user
  );
  res.status(201).json({
    workflow: created,
    report: built.report,
    format,
    runtimeReady: built.runtimeReady,
    structureImportable: built.structureImportable,
    fingerprint: built.fingerprint,
  });
});

/** Part 14D.4 — native OpsAi export (secrets/history excluded). */
const exportWorkflowNative = asyncHandler(async (req, res) => {
  const workflow = await workflowsService.getById(req.params.id, req.user);
  const portability = require("../../services/opsaiWorkflowPortability.service");
  const pkg = portability.buildNativeExport(workflow);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(
      (workflow.name || "workflow").replace(/[^\w.-]+/g, "_")
    )}.opsai.json"`
  );
  res.json(pkg);
});

module.exports = {
  list,
  listCallableTargets,
  listErrorTargets,
  setErrorWorkflow,
  getById,
  create,
  update,
  remove,
  startRun,
  webhookTrigger,
  webhookTestTrigger,
  listRuns,
  getRun,
  getRunLineage,
  getErrorRouting,
  getChildInvocation,
  cancelRun,
  resumeRun,
  resumeByExternalToken,
  executeNodeStep,
  runToNode,
  executePrevious,
  getNodeInput,
  getEditorSession,
  previewExpression,
  previewScheduleOccurrences,
  invalidateEditorSession,
  listCredentials,
  createCredential,
  updateCredential,
  removeCredential,
  startGoogleOAuth,
  listConnectionTypes,
  getCredentialEditor,
  startOAuth2,
  oauth2Callback,
  testCredential,
  listGscSites,
  listGa4Properties,
  listGmailLabels,
  listSheetTabs,
  listGscMcpTools,
  executeGscMcpTool,
  gscMcpIntentHints,
  googleOAuthCallback,
  copilotContext,
  copilotValidatePlan,
  copilotApplyPlan,
  copilotDiagnose,
  copilotPlan,
  previewN8nImport,
  importN8nDraft,
  previewWorkflowImport,
  commitWorkflowImport,
  exportWorkflowNative,
};
