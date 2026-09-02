const express = require("express");
const validate = require("../../middleware/validate");
const {
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

router.get("/", list);
router.post("/", validate(validateCreate), create);
router.get("/:id/runs", listRuns);
router.get("/:id/runs/:runId", getRun);
router.post("/:id/runs", startRun);
router.get("/:id/editor-session", getEditorSession);
router.post("/:id/nodes/:nodeId/execute", executeNodeStep);
router.post("/:id/nodes/:nodeId/run-to", runToNode);
router.post("/:id/nodes/:nodeId/execute-previous", executePrevious);
router.get("/:id/nodes/:nodeId/input", getNodeInput);
router.post("/:id/nodes/:nodeId/expression-preview", previewExpression);
router.post("/:id/webhook", webhookTrigger);
router.get("/:id", getById);
router.put("/:id", validate(validateUpdate), update);
router.delete("/:id", remove);

module.exports = router;
