const express = require("express");
const validate = require("../../middleware/validate");
const {
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
} = require("./workflows.controller");
const {
  validateCreate,
  validateUpdate,
  validateCredential,
} = require("./workflows.validation");

const router = express.Router();

// Credentials live under /workflows but are workspace-scoped, so they are
// declared before the /:id routes to avoid being captured by them.
router.get("/credentials", listCredentials);
router.post("/credentials", validate(validateCredential), createCredential);
router.delete("/credentials/:credentialId", removeCredential);

// Callable / Error Workflow picker metadata — before /:id
router.get("/callable-targets", listCallableTargets);
router.get("/error-targets", listErrorTargets);

router.get("/", list);
router.post("/", validate(validateCreate), create);
router.get("/:id/runs", listRuns);
router.get("/:id/runs/:runId/lineage", getRunLineage);
router.get("/:id/runs/:runId/error-routing", getErrorRouting);
router.get(
  "/:id/runs/:runId/nodes/:nodeId/child-invocation",
  getChildInvocation
);
router.get("/:id/runs/:runId", getRun);
router.post("/:id/runs/:runId/cancel", cancelRun);
router.post("/:id/runs/:runId/resume", resumeRun);
router.post("/:id/runs", startRun);
router.get("/:id/editor-session", getEditorSession);
router.post("/:id/editor-session/invalidate", invalidateEditorSession);
router.post("/:id/nodes/:nodeId/execute", executeNodeStep);
router.post("/:id/nodes/:nodeId/run-to", runToNode);
router.post("/:id/nodes/:nodeId/execute-previous", executePrevious);
router.get("/:id/nodes/:nodeId/input", getNodeInput);
router.post("/:id/nodes/:nodeId/expression-preview", previewExpression);
router.post("/:id/nodes/:nodeId/schedule-preview", previewScheduleOccurrences);
router.post("/:id/webhook/test", webhookTestTrigger);
router.post("/:id/webhook", webhookTrigger);
router.patch("/:id/error-workflow", setErrorWorkflow);
router.get("/:id", getById);
router.put("/:id", validate(validateUpdate), update);
router.delete("/:id", remove);

module.exports = router;
