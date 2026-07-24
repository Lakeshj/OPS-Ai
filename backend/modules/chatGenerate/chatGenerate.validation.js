const validateGenerate = (req) => {
  const errors = [];
  const { prompt, threadId } = req.body || {};

  if (!threadId || typeof threadId !== "string") {
    errors.push("threadId is required");
  }

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    errors.push("Prompt is required");
  }

  if (
    req.body?.assistantId != null &&
    typeof req.body.assistantId !== "string"
  ) {
    errors.push("assistantId must be a string when provided");
  }

  return errors;
};

module.exports = { validateGenerate };
