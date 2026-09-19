const { toSheet } = require("./toSheet");
const { toEmail } = require("./toEmail");
const { normalizeResult } = require("../errors");

const runAction = (toolId, input = {}) => {
  switch (toolId) {
    case "prepare_sheet_rows":
      return normalizeResult(toolId, { data: toSheet(input) });
    case "prepare_email_digest":
      return normalizeResult(toolId, { data: toEmail(input) });
    default:
      return normalizeResult(toolId, {
        ok: false,
        error: {
          code: "MCP_VALIDATION",
          message: `Unknown action tool: ${toolId}`,
        },
      });
  }
};

module.exports = { runAction };
