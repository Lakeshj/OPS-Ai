const validateCreateMessage = (req) => {
  const errors = [];
  const { threadId, content, isUserMessage } = req.body || {};

  if (!threadId) errors.push("threadId is required");
  if (!content) errors.push("content is required");
  if (isUserMessage === undefined) errors.push("isUserMessage is required");

  return errors;
};

module.exports = { validateCreateMessage };
