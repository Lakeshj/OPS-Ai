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
  const run = await workflowsService.startRun(
    req.params.id,
    payload,
    req.user,
    idempotencyKey ? String(idempotencyKey).slice(0, 190) : null
  );
  res.status(201).json(run);
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
  removeCredential,
};
