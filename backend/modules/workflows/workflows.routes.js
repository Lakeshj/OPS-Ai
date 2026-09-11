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
  startGoogleOAuth,
  listConnectionTypes,
  getCredentialEditor,
  startOAuth2,
  testCredential,
  listGscSites,
  listGa4Properties,
  listGmailLabels,
  listSheetTabs,
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
router.get("/credentials/:credentialId/editor", getCredentialEditor);
router.post("/credentials/:credentialId/test", testCredential);
router.get("/connection-types", listConnectionTypes);
router.post("/google-oauth/start", startGoogleOAuth);
router.post("/oauth2/start", startOAuth2);
router.get("/google-oauth/gsc-sites", listGscSites);
router.get("/google-oauth/ga4-properties", listGa4Properties);
router.get("/google-oauth/gmail-labels", listGmailLabels);
router.get("/google-oauth/sheet-tabs", listSheetTabs);

// Part 14D.4 — unified + n8n import (before /:id)
router.post("/import/preview", previewWorkflowImport);
router.post("/import", commitWorkflowImport);
router.post("/import/n8n/preview", previewN8nImport);
router.post("/import/n8n", importN8nDraft);

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

// Part 14A — Workflow Copilot (before generic /:id)
router.post("/:id/copilot/context", copilotContext);
router.post("/:id/copilot/plan", copilotPlan);
router.post("/:id/copilot/validate-plan", copilotValidatePlan);
router.post("/:id/copilot/apply-plan", copilotApplyPlan);
router.post("/:id/copilot/diagnose", copilotDiagnose);

router.get("/:id/export", exportWorkflowNative);
router.get("/:id", getById);
router.put("/:id", validate(validateUpdate), update);
router.delete("/:id", remove);

module.exports = router;
