const {
  ESSENTIAL_INTELLIGENCE_IDS,
  ESSENTIAL_DATA_IDS,
  PROCESSOR_CAPABILITY_IDS,
  categoryForCapabilityId,
} = require("../contracts/capabilities");

const INTELLIGENCE_IDS = [...ESSENTIAL_INTELLIGENCE_IDS];
const DATA_IDS = [...ESSENTIAL_DATA_IDS];

const categorizeCapability = (id) =>
  categoryForCapabilityId(id) || "unknown";

module.exports = {
  INTELLIGENCE_IDS,
  DATA_IDS,
  PROCESSOR_CAPABILITY_IDS,
  categorizeCapability,
};
