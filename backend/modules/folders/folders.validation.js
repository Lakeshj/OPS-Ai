const validateCreateFolder = (req) => {
  const errors = [];
  const { name, workspaceId, createdBy } = req.body || {};

  if (!name) errors.push("Name is required");
  if (!workspaceId) errors.push("workspaceId is required");
  if (!createdBy) errors.push("createdBy is required");

  return errors;
};

module.exports = { validateCreateFolder };
