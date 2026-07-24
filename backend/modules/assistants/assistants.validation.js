const {
  AI_CAPABILITIES,
  normalizeCapability,
  normalizeProvider,
  normalizeSelection,
} = require("../../utils/aiProviders");

const ALLOWED_CAPABILITIES = AI_CAPABILITIES.map((item) => item.key);

const validateCreateAssistant = (req) => {
  const errors = [];
  const { name, taskType, capabilityType, provider, model, promptTemplate } =
    req.body || {};

  if (!name) errors.push("Name is required");
  if (!taskType) errors.push("taskType is required");
  if (!promptTemplate) errors.push("promptTemplate is required");

  if (capabilityType !== undefined) {
    const normalized = normalizeCapability(capabilityType);
    if (!ALLOWED_CAPABILITIES.includes(normalized)) {
      errors.push(
        `capabilityType must be one of: ${ALLOWED_CAPABILITIES.join(", ")}`
      );
    }
  }

  // Auto-fill / correct empty or mismatched provider+model before create.
  if (capabilityType !== undefined || provider !== undefined || model !== undefined) {
    const selection = normalizeSelection({
      capabilityType: capabilityType || "chat",
      provider,
      model,
    });
    req.body.capabilityType = selection.capabilityType;
    req.body.provider = selection.provider;
    req.body.model = selection.model;
  }

  if (provider !== undefined && !normalizeProvider(req.body.provider)) {
    errors.push("provider must be one of: openai, deepseek, gemini");
  }
  if (model !== undefined && !String(req.body.model || "").trim()) {
    errors.push("model cannot be empty");
  }

  return errors;
};

const validateUpdateAssistant = (req) => {
  const errors = [];
  const {
    name,
    taskType,
    capabilityType,
    provider,
    model,
    promptTemplate,
    description,
  } = req.body || {};

  const hasField = [
    name,
    taskType,
    capabilityType,
    provider,
    model,
    promptTemplate,
    description,
  ].some((value) => value !== undefined);

  if (!hasField) {
    errors.push("No fields to update");
  }
  if (name !== undefined && !String(name).trim()) {
    errors.push("Name cannot be empty");
  }
  if (taskType !== undefined && !String(taskType).trim()) {
    errors.push("taskType cannot be empty");
  }
  if (promptTemplate !== undefined && !String(promptTemplate).trim()) {
    errors.push("promptTemplate cannot be empty");
  }
  if (capabilityType !== undefined) {
    const normalized = normalizeCapability(capabilityType);
    if (!ALLOWED_CAPABILITIES.includes(normalized)) {
      errors.push(
        `capabilityType must be one of: ${ALLOWED_CAPABILITIES.join(", ")}`
      );
    }
  }

  if (
    capabilityType !== undefined ||
    provider !== undefined ||
    model !== undefined
  ) {
    const selection = normalizeSelection({
      capabilityType: capabilityType || "chat",
      provider,
      model,
    });
    if (capabilityType !== undefined) {
      req.body.capabilityType = selection.capabilityType;
    }
    if (provider !== undefined || model !== undefined || capabilityType !== undefined) {
      req.body.provider = selection.provider;
      req.body.model = selection.model;
    }
  }

  return errors;
};

module.exports = { validateCreateAssistant, validateUpdateAssistant };
