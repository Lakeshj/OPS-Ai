const path = require("path");
const fs = require("fs");

const DEFAULTS_PATH = path.join(__dirname, "..", "config.default.json");

const loadConfig = (overrides = {}) => {
  let base = {};
  try {
    base = JSON.parse(fs.readFileSync(DEFAULTS_PATH, "utf8"));
  } catch {
    base = {};
  }
  return {
    ...base,
    ...overrides,
    // Hard locks — never enable Google / remote MCP from env in V1 scaffold
    allowGoogleApi: false,
    allowOAuth: false,
    allowExternalMcp: false,
    mode: "upstream_processor",
  };
};

module.exports = { loadConfig };
