const path = require("path");
const fs = require("fs");

const DEFAULTS_PATH = path.join(__dirname, "..", "..", "config.default.json");

const loadConfig = (overrides = {}) => {
  let base = {};
  try {
    base = JSON.parse(fs.readFileSync(DEFAULTS_PATH, "utf8"));
  } catch {
    base = {};
  }
  const envCommand = process.env.OPSAI_GSC_MCP_COMMAND;
  const envArgs = process.env.OPSAI_GSC_MCP_ARGS;
  const envCwd = process.env.OPSAI_GSC_MCP_CWD;
  const external = {
    ...(base.external || {}),
    ...(overrides.external || {}),
  };
  if (envCommand) external.command = envCommand;
  if (envArgs) {
    try {
      external.args = JSON.parse(envArgs);
    } catch {
      external.args = String(envArgs)
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  if (envCwd) external.cwd = envCwd;
  return {
    ...base,
    ...overrides,
    external,
    transport:
      overrides.transport ||
      process.env.OPSAI_GSC_MCP_TRANSPORT ||
      base.transport ||
      "stdio",
  };
};

module.exports = { loadConfig };
