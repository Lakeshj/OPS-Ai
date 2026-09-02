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
  res.json(await workflowsService.getRunById(req.params.runId, req.user));
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
  getById,
  create,
  update,
  remove,
  startRun,
  webhookTrigger,
  listRuns,
  getRun,
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
