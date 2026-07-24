const validateCreateWorkspace = (req) => {
  const errors = [];
  const { name, createdBy } = req.body || {};

  if (!name) errors.push("Name is required");
  if (!createdBy) errors.push("createdBy is required");

  return errors;
};

module.exports = { validateCreateWorkspace };
