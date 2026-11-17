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
    mode: "read_only_api",
    allowMutations: false,
  };
};

module.exports = { loadConfig };
