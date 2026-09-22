/**
 * GA4 MCP V1 capability registry — locked IDs from STEP 2 contracts.
 * UI labels are presentation-only; evaluation logic is Step 4.
 */

const AUDIENCES = Object.freeze({
  WORKFLOW: "workflow",
  AGENT: "agent",
});

const CAPABILITY_IDS = Object.freeze({
  ENGAGEMENT: "engagement_opportunities",
  LANDING: "landing_underperformance",
  ACQUISITION: "acquisition_concentration",
  PAGE_PERFORMANCE: "page_performance",
});

const TOOL_LABELS = Object.freeze({
  engagement_opportunities: "Engagement Opportunities",
  landing_underperformance: "Landing Underperformance",
  acquisition_concentration: "Acquisition Concentration",
  page_performance: "Page Performance",
});

/** Intelligence capabilities (opportunity generators). */
const ESSENTIAL_INTELLIGENCE_IDS = Object.freeze([
  CAPABILITY_IDS.ENGAGEMENT,
  CAPABILITY_IDS.LANDING,
  CAPABILITY_IDS.ACQUISITION,
]);

/** Data / analysis capabilities (not opportunity generators). */
const ESSENTIAL_DATA_IDS = Object.freeze([CAPABILITY_IDS.PAGE_PERFORMANCE]);

/** All processor multi-select options (order stable for UI + execution). */
const PROCESSOR_CAPABILITY_IDS = Object.freeze([
  ...ESSENTIAL_INTELLIGENCE_IDS,
  ...ESSENTIAL_DATA_IDS,
]);

const CATEGORY_BY_ID = Object.freeze({
  engagement_opportunities: "intelligence",
  landing_underperformance: "intelligence",
  acquisition_concentration: "intelligence",
  page_performance: "data",
});

const CAPABILITY_DEFS = Object.freeze({
  engagement_opportunities: Object.freeze({
    id: "engagement_opportunities",
    label: TOOL_LABELS.engagement_opportunities,
    category: "intelligence",
    opportunity_type: "low_engagement",
    row_kind: null,
    purpose:
      "Flag URLs with meaningful traffic where engagement quality is poor.",
    requiredDimensionsAnyOf: Object.freeze(["pagePath", "landingPage"]),
    requiredMetricsAllOf: Object.freeze(["sessions"]),
    requiredMetricsAnyOf: Object.freeze(["engagementRate", "bounceRate"]),
    optionalDimensions: Object.freeze([
      "pageTitle",
      "hostName",
      "deviceCategory",
      "country",
      "date",
    ]),
    optionalMetrics: Object.freeze([
      "totalUsers",
      "userEngagementDuration",
      "screenPageViews",
      "engagedSessions",
      "averageSessionDuration",
    ]),
    implemented: true,
  }),
  landing_underperformance: Object.freeze({
    id: "landing_underperformance",
    label: TOOL_LABELS.landing_underperformance,
    category: "intelligence",
    opportunity_type: "landing_underperformance",
    row_kind: null,
    purpose:
      "Flag entry URLs with substantial sessions but weak visit payoff.",
    requiredDimensionsPreferred: "landingPage",
    requiredDimensionsProxy: "pagePath",
    requiredMetricsAllOf: Object.freeze(["sessions"]),
    requiredMetricsAnyOf: Object.freeze([
      "engagementRate",
      "bounceRate",
      "screenPageViews",
      "screenPageViewsPerSession",
      "averageSessionDuration",
    ]),
    optionalDimensions: Object.freeze([
      "pageTitle",
      "sessionDefaultChannelGroup",
      "deviceCategory",
      "country",
    ]),
    optionalMetrics: Object.freeze([
      "totalUsers",
      "userEngagementDuration",
      "engagedSessions",
      "bounceRate",
      "screenPageViews",
      "averageSessionDuration",
    ]),
    implemented: true,
  }),
  acquisition_concentration: Object.freeze({
    id: "acquisition_concentration",
    label: TOOL_LABELS.acquisition_concentration,
    category: "intelligence",
    opportunity_type: "acquisition_concentration",
    alternateOpportunityTypes: Object.freeze(["acquisition_channel"]),
    row_kind: null,
    purpose:
      "Identify concentration of sessions/users across real GA4 acquisition dimensions.",
    requiredDimensionsAnyOf: Object.freeze([
      "sessionDefaultChannelGroup",
      "sessionSourceMedium",
      "sessionSource",
      "sessionMedium",
      "firstUserDefaultChannelGroup",
    ]),
    /** Never treat these as acquisition dimensions. */
    forbiddenAsAcquisition: Object.freeze([
      "pagePath",
      "pageTitle",
      "landingPage",
      "pageLocation",
      "eventName",
      "hostName",
    ]),
    requiredMetricsAnyOf: Object.freeze(["sessions", "totalUsers"]),
    optionalDimensions: Object.freeze([
      "sessionCampaignName",
      "firstUserSource",
      "firstUserMedium",
      "date",
    ]),
    optionalMetrics: Object.freeze([
      "newUsers",
      "engagedSessions",
      "engagementRate",
    ]),
    concentrationThresholdDefault: 0.35,
    implemented: true,
  }),
  page_performance: Object.freeze({
    id: "page_performance",
    label: TOOL_LABELS.page_performance,
    category: "data",
    opportunity_type: null,
    row_kind: "ranked_page",
    purpose:
      "Produce a ranked page leaderboard for Filter → Sort → AI → Sheet/Gmail.",
    requiredDimensionsAnyOf: Object.freeze(["pagePath", "landingPage"]),
    requiredMetricsAnyOf: Object.freeze([
      "sessions",
      "screenPageViews",
      "totalUsers",
      "engagementRate",
      "bounceRate",
      "averageSessionDuration",
      "userEngagementDuration",
      "screenPageViewsPerSession",
    ]),
    optionalDimensions: Object.freeze(["pageTitle", "hostName"]),
    optionalMetrics: Object.freeze([
      "engagementRate",
      "bounceRate",
      "userEngagementDuration",
      "averageSessionDuration",
      "screenPageViewsPerSession",
    ]),
    inventsScore: false,
    implemented: true,
  }),
});

const labelForCapabilityId = (id) =>
  TOOL_LABELS[id] || String(id || "").replace(/_/g, " ");

const categoryForCapabilityId = (id) => CATEGORY_BY_ID[id] || null;

const isProcessorCapability = (id) =>
  PROCESSOR_CAPABILITY_IDS.includes(String(id || "").trim());

const isIntelligenceCapability = (id) =>
  ESSENTIAL_INTELLIGENCE_IDS.includes(String(id || "").trim());

const isDataCapability = (id) =>
  ESSENTIAL_DATA_IDS.includes(String(id || "").trim());

const getCapabilityDef = (id) => CAPABILITY_DEFS[String(id || "").trim()] || null;

module.exports = {
  AUDIENCES,
  CAPABILITY_IDS,
  TOOL_LABELS,
  ESSENTIAL_INTELLIGENCE_IDS,
  ESSENTIAL_DATA_IDS,
  PROCESSOR_CAPABILITY_IDS,
  CATEGORY_BY_ID,
  CAPABILITY_DEFS,
  labelForCapabilityId,
  categoryForCapabilityId,
  isProcessorCapability,
  isIntelligenceCapability,
  isDataCapability,
  getCapabilityDef,
};
