const { engagementOpportunities } = require("./engagementOpportunities");
const { landingUnderperformance } = require("./landingUnderperformance");
const { acquisitionConcentration } = require("./acquisitionConcentration");
const { pagePerformance } = require("./pagePerformance");
const { normalizeResult } = require("../errors");
const {
  PROCESSOR_CAPABILITY_IDS,
  isDataCapability,
} = require("../contracts/capabilities");

const runSafe = (capabilityId, fn, input) => {
  try {
    const data = fn(input);
    return normalizeResult(capabilityId, {
      data,
      warnings: data?.warnings || [],
    });
  } catch (err) {
    return normalizeResult(capabilityId, {
      ok: false,
      error: {
        code: err.code || "GA4_VALIDATION",
        message: err.message || `Capability failed: ${capabilityId}`,
      },
    });
  }
};

/**
 * Run one capability against isolated upstream rows.
 * All four V1 capabilities are implemented (STEP 4–7).
 */
const runCapability = (capabilityId, input = {}) => {
  const id = String(capabilityId || "").trim();
  switch (id) {
    case "engagement_opportunities":
      return runSafe(id, engagementOpportunities, input);
    case "landing_underperformance":
      return runSafe(id, landingUnderperformance, input);
    case "acquisition_concentration":
      return runSafe(id, acquisitionConcentration, input);
    case "page_performance":
      return runSafe(id, pagePerformance, input);
    default:
      return normalizeResult(id, {
        ok: false,
        error: {
          code: "GA4_UNKNOWN_CAPABILITY",
          message: `Unknown GA4 capability: ${id}`,
        },
      });
  }
};

/** Extract stamped items from a capability result (intelligence or data). */
const itemsFromCapabilityResult = (capabilityId, result) => {
  if (!result?.ok || !result.data) return [];
  const data = result.data;
  if (isDataCapability(capabilityId)) {
    if (Array.isArray(data.rows)) return data.rows;
    return [];
  }
  if (Array.isArray(data.opportunities)) return data.opportunities;
  return [];
};

module.exports = {
  runCapability,
  itemsFromCapabilityResult,
  CAPABILITY_IDS: PROCESSOR_CAPABILITY_IDS,
};
