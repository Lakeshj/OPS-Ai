/**
 * Frontend mirror of plugins/ga4-mcp capability IDs + filter schemas.
 * Keep IDs/names aligned with:
 *   plugins/ga4-mcp/src/contracts/capabilities.js
 *   plugins/ga4-mcp/src/contracts/filters.js
 */
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";

export const GA4_MCP_CAPABILITY_IDS = [
  "engagement_opportunities",
  "landing_underperformance",
  "acquisition_concentration",
  "page_performance",
] as const;

export type Ga4McpCapabilityId = (typeof GA4_MCP_CAPABILITY_IDS)[number];

export const GA4_MCP_CAPABILITY_OPTIONS: Array<{
  name: string;
  value: Ga4McpCapabilityId;
  description: string;
}> = [
  {
    name: "Engagement Opportunities",
    value: "engagement_opportunities",
    description:
      "Find pages with weak engagement signals using sessions, engagement rate and bounce rate.",
  },
  {
    name: "Landing Underperformance",
    value: "landing_underperformance",
    description:
      "Evaluate landing-page performance using traffic and landing-page engagement signals.",
  },
  {
    name: "Acquisition Concentration",
    value: "acquisition_concentration",
    description:
      "Identify concentration across actual GA4 acquisition dimensions such as channel group or source/medium.",
  },
  {
    name: "Page Performance",
    value: "page_performance",
    description:
      "Rank page-level GA4 data for downstream filtering, sorting and analysis.",
  },
];

const num = (
  name: string,
  displayName: string,
  defaultValue: number,
  description?: string
): ParamDescriptor => ({
  name,
  displayName,
  type: "number",
  default: defaultValue,
  description,
});

const opts = (
  name: string,
  displayName: string,
  defaultValue: string,
  options: Array<{ name: string; value: string }>,
  description?: string
): ParamDescriptor => ({
  name,
  displayName,
  type: "options",
  default: defaultValue,
  options,
  description,
});

/** Per-capability filter fields (canonical names match backend FILTER_KEYS). */
export const GA4_MCP_CAPABILITY_FILTERS: Record<
  Ga4McpCapabilityId,
  ParamDescriptor[]
> = {
  engagement_opportunities: [
    {
      name: "_engagementHelp",
      displayName: "Engagement Opportunities",
      type: "notice",
      description:
        "Find pages with weak engagement signals using sessions, engagement rate and bounce rate.",
    },
    num("minSessions", "Min sessions", 100, "Ignore rows below this session count."),
    num(
      "maxEngagementRate",
      "Max engagement rate",
      0.4,
      "Qualify when engagement rate is at or below this value (0–1)."
    ),
    num(
      "minBounceRate",
      "Min bounce rate",
      0.6,
      "Qualify when bounce rate is at or above this value (0–1)."
    ),
    num("minScore", "Min score", 0, "Drop opportunities scoring below this threshold."),
    num("limit", "Limit", 50, "Max opportunities to return (0 = unlimited)."),
  ],
  landing_underperformance: [
    {
      name: "_landingHelp",
      displayName: "Landing Underperformance",
      type: "notice",
      description:
        "Evaluate landing-page performance using traffic and landing-page engagement signals.",
    },
    num("minSessions", "Min sessions", 150, "Ignore landing rows below this session count."),
    num(
      "maxEngagementRate",
      "Max engagement rate",
      0.35,
      "Qualify when engagement rate is at or below this value (0–1)."
    ),
    num(
      "minBounceRate",
      "Min bounce rate",
      0.65,
      "Qualify when bounce rate is at or above this value (0–1)."
    ),
    num(
      "maxViewsPerSession",
      "Max views per session",
      1.2,
      "Qualify when views/session is at or below this value."
    ),
    num(
      "maxAverageSessionDuration",
      "Max avg session duration (s)",
      25,
      "Qualify when average session duration (seconds) is at or below this value."
    ),
    num("minScore", "Min score", 0),
    num("limit", "Limit", 50, "Max opportunities to return (0 = unlimited)."),
  ],
  acquisition_concentration: [
    {
      name: "_acquisitionHelp",
      displayName: "Acquisition Concentration",
      type: "notice",
      description:
        "Identify concentration across actual GA4 acquisition dimensions such as channel group or source/medium.",
    },
    num(
      "minShare",
      "Min share",
      0.35,
      "Concentration threshold: channel must account for at least this share of total traffic (0–1)."
    ),
    num(
      "minConcentrationShare",
      "Min concentration share",
      0.35,
      "Alias for min share; effective threshold is the higher of the two."
    ),
    num("minVolume", "Min volume", 100, "Minimum sessions/users for a channel to qualify."),
    num("minScore", "Min score", 0),
    num("limit", "Limit", 20, "Max opportunities to return (0 = unlimited)."),
  ],
  page_performance: [
    {
      name: "_pagePerfHelp",
      displayName: "Page Performance",
      type: "notice",
      description:
        "Rank page-level GA4 data for downstream filtering, sorting and analysis. DATA only — no opportunity scores.",
    },
    opts(
      "sortMetric",
      "Rank by",
      "sessions",
      [
        { name: "Sessions", value: "sessions" },
        { name: "Total users", value: "totalUsers" },
        { name: "Screen page views", value: "screenPageViews" },
        { name: "Engagement rate", value: "engagementRate" },
        { name: "Bounce rate", value: "bounceRate" },
        { name: "Avg session duration", value: "averageSessionDuration" },
        { name: "User engagement duration", value: "userEngagementDuration" },
        { name: "Views per session", value: "screenPageViewsPerSession" },
      ],
      "Metric used for ranking (must exist in upstream rows)."
    ),
    opts(
      "sortDirection",
      "Sort direction",
      "desc",
      [
        { name: "Descending", value: "desc" },
        { name: "Ascending", value: "asc" },
      ]
    ),
    opts(
      "entityDim",
      "Page dimension",
      "auto",
      [
        { name: "Auto (pagePath, then landingPage)", value: "auto" },
        { name: "pagePath", value: "pagePath" },
        { name: "landingPage", value: "landingPage" },
      ]
    ),
    num("minSessions", "Min sessions", 0),
    num("minTotalUsers", "Min total users", 0),
    num("minPageViews", "Min page views", 0),
    num(
      "minMetricValue",
      "Min rank-metric value",
      0,
      "Optional floor on the selected ranking metric (leave 0 for no floor)."
    ),
    num("limit", "Limit", 50, "Max rows to return (0 = unlimited)."),
  ],
};
