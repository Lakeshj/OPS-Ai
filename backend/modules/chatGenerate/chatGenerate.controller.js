const asyncHandler = require("../../utils/asyncHandler");
const chatGenerateService = require("./chatGenerate.service");

const generate = asyncHandler(async (req, res) => {
  const result = await chatGenerateService.generate(req.body, req.user);
  res.json(result);
});

module.exports = { generate };
