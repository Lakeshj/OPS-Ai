/**
 * Meta Ads Insights report catalog (read-only).
 * One source of truth for report levels, fields, filters and date presets.
 *
 * Filter fields use Meta's dot notation (campaign.id, ad.effective_status).
 * Dates resolve in the ad account timezone, never in UTC.
 */

const { DateTime, IANAZone } = require("luxon");
const AppError = require("../utils/AppError");

const COMMON_FIELDS = Object.freeze([
  "account_id",
  "account_name",
  "account_currency",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "spend",
  "actions",
  "action_values",
  "cost_per_action_type",
  "date_start",
  "date_stop",
]);

const NUMERIC_FIELDS = Object.freeze([
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "spend",
]);

const ACTION_FIELDS = Object.freeze(["actions", "action_values", "cost_per_action_type"]);

const REPORTS = Object.freeze({
  account_performance: Object.freeze({
    level: "account",
    label: "Meta Ads Account Performance",
    entity: "account",
    identityFields: Object.freeze([]),
    filterKeys: Object.freeze([]),
  }),
  campaign_performance: Object.freeze({
    level: "campaign",
    label: "Meta Ads Campaign Performance",
    entity: "campaign",
    identityFields: Object.freeze(["campaign_id", "campaign_name"]),
    filterKeys: Object.freeze(["campaignId", "effectiveStatus"]),
  }),
  ad_set_performance: Object.freeze({
    level: "adset",
    label: "Meta Ads Ad Set Performance",
    entity: "ad set",
    identityFields: Object.freeze(["campaign_id", "campaign_name", "adset_id", "adset_name"]),
    filterKeys: Object.freeze(["campaignId", "adSetId", "effectiveStatus"]),
  }),
  ad_performance: Object.freeze({
    level: "ad",
    label: "Meta Ads Ad Performance",
    entity: "ad",
    identityFields: Object.freeze([
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
    ]),
    filterKeys: Object.freeze(["campaignId", "adSetId", "adId", "effectiveStatus"]),
  }),
});

const EFFECTIVE_STATUS = Object.freeze({
  campaign: Object.freeze([
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "ARCHIVED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ]),
  adset: Object.freeze([
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "CAMPAIGN_PAUSED",
    "ARCHIVED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ]),
  ad: Object.freeze([
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "PENDING_REVIEW",
    "DISAPPROVED",
    "PREAPPROVED",
    "PENDING_BILLING_INFO",
    "CAMPAIGN_PAUSED",
    "ARCHIVED",
    "ADSET_PAUSED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ]),
});

const ID_FILTER_FIELDS = Object.freeze({
  campaignId: "campaign.id",
  adSetId: "adset.id",
  adId: "ad.id",
});

const STATUS_FILTER_FIELD = Object.freeze({
  campaign: "campaign.effective_status",
  adset: "adset.effective_status",
  ad: "ad.effective_status",
});

const ALL_FILTER_KEYS = Object.freeze(["campaignId", "adSetId", "adId", "effectiveStatus"]);

const DATE_PRESETS = Object.freeze([
  "today",
  "yesterday",
  "last7days",
  "last14days",
  "last30days",
  "thisMonth",
  "lastMonth",
  "custom",
]);

const DEFAULT_DATE_RANGE = "last7days";
const DEFAULT_LIMIT = 100;
const PAGE_SIZE = 100;
const MAX_ROWS = 2000;
const MAX_PAGES = 20;
const MAX_IDS_PER_FILTER = 50;
const MAX_LOOKBACK_MONTHS = 37;

const catalogError = (message, code) => new AppError(message, 400, code);

const reportFor = (reportType) => {
  const key = String(reportType || "").trim();
  if (!Object.prototype.hasOwnProperty.call(REPORTS, key)) {
    throw catalogError(
      "Choose a Meta Ads report: Account, Campaign, Ad Set or Ad Performance.",
      "META_FIELD_UNSUPPORTED"
    );
  }
  return { reportType: key, ...REPORTS[key] };
};

const fieldsFor = (reportType) => {
  const report = reportFor(reportType);
  return [...COMMON_FIELDS, ...report.identityFields];
};

const listOf = (value) => {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((entry) => String(entry == null ? "" : entry).trim()).filter(Boolean);
};

/**
 * Validate the node's filters object for one report.
 * Unknown keys and keys that do not apply to the report are rejected.
 */
const validateFilters = (reportType, filters) => {
  const report = reportFor(reportType);
  if (filters != null && (typeof filters !== "object" || Array.isArray(filters))) {
    throw catalogError("Meta Ads filters must be an object.", "META_FILTER_INVALID");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(filters || {})) {
    const values = listOf(value);
    if (!values.length) continue;
    if (!ALL_FILTER_KEYS.includes(key)) {
      throw catalogError(`Unknown Meta Ads filter: ${key}.`, "META_FILTER_INVALID");
    }
    if (!report.filterKeys.includes(key)) {
      throw catalogError(
        `The ${key} filter does not apply to ${report.label}.`,
        "META_FILTER_INVALID"
      );
    }
    if (values.length > MAX_IDS_PER_FILTER) {
      throw catalogError(
        `A Meta Ads filter accepts at most ${MAX_IDS_PER_FILTER} values.`,
        "META_FILTER_INVALID"
      );
    }
    if (key === "effectiveStatus") {
      const allowed = EFFECTIVE_STATUS[report.level];
      const statuses = [...new Set(values.map((entry) => entry.toUpperCase()))];
      for (const status of statuses) {
        if (!allowed.includes(status)) {
          throw catalogError(
            `${status} is not a valid ${report.entity} status.`,
            "META_FILTER_INVALID"
          );
        }
      }
      normalized.effectiveStatus = statuses;
      continue;
    }
    const ids = [...new Set(values)];
    for (const id of ids) {
      if (!/^\d{1,20}$/.test(id)) {
        throw catalogError(`Meta ${key} values must be numeric ids.`, "META_FILTER_INVALID");
      }
    }
    normalized[key] = ids;
  }
  return normalized;
};

const buildFiltering = (reportType, normalizedFilters) => {
  const report = reportFor(reportType);
  const filtering = [];
  for (const key of ["campaignId", "adSetId", "adId"]) {
    const ids = normalizedFilters[key];
    if (ids && ids.length) {
      filtering.push({ field: ID_FILTER_FIELDS[key], operator: "IN", value: ids });
    }
  }
  if (normalizedFilters.effectiveStatus && normalizedFilters.effectiveStatus.length) {
    filtering.push({
      field: STATUS_FILTER_FIELD[report.level],
      operator: "IN",
      value: normalizedFilters.effectiveStatus,
    });
  }
  return filtering;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseIsoDate = (value, zone, label) => {
  const text = String(value == null ? "" : value).trim();
  const parsed = ISO_DATE_RE.test(text) ? DateTime.fromISO(text, { zone }) : null;
  if (!parsed || !parsed.isValid) {
    throw catalogError(`${label} must be a date in YYYY-MM-DD format.`, "META_DATE_WINDOW");
  }
  return parsed.startOf("day");
};

/**
 * Resolve a preset or custom range to inclusive since/until dates in the
 * ad account timezone. "Last N days" ends yesterday and excludes today.
 */
const resolveMetaDateRange = ({
  dateRange,
  customStartDate,
  customEndDate,
  timezone,
  nowMs = Date.now(),
} = {}) => {
  const zone = String(timezone || "").trim();
  if (!zone || !IANAZone.isValidZone(zone)) {
    throw catalogError(
      "Meta did not return a valid timezone for this ad account.",
      "META_DATE_WINDOW"
    );
  }
  const preset = String(dateRange || "").trim() || DEFAULT_DATE_RANGE;
  if (!DATE_PRESETS.includes(preset)) {
    throw catalogError(`Unsupported Meta Ads date range: ${preset}.`, "META_DATE_WINDOW");
  }
  const today = DateTime.fromMillis(Number(nowMs), { zone }).startOf("day");
  let since;
  let until;
  switch (preset) {
    case "today":
      since = today;
      until = today;
      break;
    case "yesterday":
      since = today.minus({ days: 1 });
      until = since;
      break;
    case "last7days":
    case "last14days":
    case "last30days": {
      const days = preset === "last7days" ? 7 : preset === "last14days" ? 14 : 30;
      until = today.minus({ days: 1 });
      since = today.minus({ days });
      break;
    }
    case "thisMonth":
      since = today.startOf("month");
      until = today;
      break;
    case "lastMonth":
      since = today.minus({ months: 1 }).startOf("month");
      until = since.endOf("month").startOf("day");
      break;
    default:
      since = parseIsoDate(customStartDate, zone, "Start date");
      until = parseIsoDate(customEndDate, zone, "End date");
      if (since > until) {
        throw catalogError("Start date must be on or before end date.", "META_DATE_WINDOW");
      }
      if (until > today) {
        throw catalogError("End date cannot be in the future.", "META_DATE_WINDOW");
      }
      break;
  }
  if (since < today.minus({ months: MAX_LOOKBACK_MONTHS })) {
    throw catalogError(
      `Meta Insights only covers the last ${MAX_LOOKBACK_MONTHS} months.`,
      "META_DATE_WINDOW"
    );
  }
  return {
    preset,
    since: since.toISODate(),
    until: until.toISODate(),
    timezone: zone,
  };
};

/**
 * Query parameters for GET act_{id}/insights. Never sets date_preset.
 */
const ALLOWED_BREAKDOWNS = Object.freeze([
  "age",
  "gender",
  "country",
  "impression_device",
  "publisher_platform",
  "platform_position",
]);

const SCOPE_TO_REPORT = Object.freeze({
  account: "account_performance",
  campaign: "campaign_performance",
  adset: "ad_set_performance",
  ad: "ad_performance",
});

const DEMOGRAPHIC_MODES = Object.freeze({
  age: Object.freeze(["age"]),
  gender: Object.freeze(["gender"]),
  age_and_gender: Object.freeze(["age", "gender"]),
});

const PLACEMENT_MODES = Object.freeze({
  publisher_platform: Object.freeze(["publisher_platform"]),
  platform_position: Object.freeze(["platform_position"]),
  publisher_and_position: Object.freeze(["publisher_platform", "platform_position"]),
});

const FROZEN_BREAKDOWN_KEYS = Object.freeze(
  new Set([
    "age",
    "gender",
    "age,gender",
    "country",
    "impression_device",
    "publisher_platform",
    "platform_position",
    "publisher_platform,platform_position",
  ])
);

const breakdownKey = (list) =>
  (Array.isArray(list) ? list : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(",");

const breakdownError = (message) => catalogError(message, "META_BREAKDOWN_INVALID");

/**
 * Frozen M6 breakdown sets only. Arbitrary Meta breakdown arrays are rejected.
 */
const validateBreakdowns = (list) => {
  const names = (Array.isArray(list) ? list : []).map((entry) => String(entry || "").trim()).filter(Boolean);
  if (!names.length) {
    throw breakdownError("A Meta Ads breakdown is required.");
  }
  for (const name of names) {
    if (!ALLOWED_BREAKDOWNS.includes(name)) {
      throw breakdownError(`Unsupported Meta Ads breakdown: ${name}.`);
    }
  }
  if (!FROZEN_BREAKDOWN_KEYS.has(breakdownKey(names))) {
    throw breakdownError("That Meta Ads breakdown combination is not available.");
  }
  return names.slice();
};

const resolveDemographicBreakdowns = (mode) => {
  const key = String(mode || "age_and_gender").trim();
  if (!Object.prototype.hasOwnProperty.call(DEMOGRAPHIC_MODES, key)) {
    throw breakdownError("Demographic mode must be age, gender, or age_and_gender.");
  }
  return validateBreakdowns(DEMOGRAPHIC_MODES[key]);
};

const resolvePlacementBreakdowns = (mode) => {
  const key = String(mode || "publisher_and_position").trim();
  if (!Object.prototype.hasOwnProperty.call(PLACEMENT_MODES, key)) {
    throw breakdownError(
      "Placement breakdown must be publisher_platform, platform_position, or publisher_and_position."
    );
  }
  return validateBreakdowns(PLACEMENT_MODES[key]);
};

const resolveScopeReport = (scope) => {
  const key = String(scope || "account").trim();
  if (!Object.prototype.hasOwnProperty.call(SCOPE_TO_REPORT, key)) {
    throw catalogError("Scope must be account, campaign, ad set, or ad.", "META_FILTER_INVALID");
  }
  return { scope: key, reportType: SCOPE_TO_REPORT[key] };
};

const buildInsightsQuery = ({
  reportType,
  since,
  until,
  filters,
  pageSize,
  after,
  breakdowns,
  extraFields,
}) => {
  const report = reportFor(reportType);
  const normalized = validateFilters(reportType, filters);
  const filtering = buildFiltering(reportType, normalized);
  const size = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), PAGE_SIZE);
  const fields = fieldsFor(reportType).slice();
  for (const extra of Array.isArray(extraFields) ? extraFields : []) {
    const name = String(extra || "").trim();
    if (name && !fields.includes(name)) fields.push(name);
  }
  const query = {
    level: report.level,
    fields: fields.join(","),
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: String(size),
  };
  if (filtering.length) query.filtering = JSON.stringify(filtering);
  if (after) query.after = String(after);
  if (Array.isArray(breakdowns) && breakdowns.length) {
    query.breakdowns = breakdowns.join(",");
  }
  return query;
};

const rowLimits = ({ limit, returnAll }) => {
  const all = returnAll === true || returnAll === "true";
  const requested = Number(limit);
  const maxRows = all
    ? MAX_ROWS
    : Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_LIMIT, 1), MAX_ROWS);
  return { returnAll: all, maxRows, maxPages: MAX_PAGES, pageSize: PAGE_SIZE };
};

module.exports = {
  COMMON_FIELDS,
  NUMERIC_FIELDS,
  ACTION_FIELDS,
  REPORTS,
  EFFECTIVE_STATUS,
  ID_FILTER_FIELDS,
  STATUS_FILTER_FIELD,
  DATE_PRESETS,
  DEFAULT_DATE_RANGE,
  DEFAULT_LIMIT,
  PAGE_SIZE,
  MAX_ROWS,
  MAX_PAGES,
  MAX_LOOKBACK_MONTHS,
  ALLOWED_BREAKDOWNS,
  SCOPE_TO_REPORT,
  DEMOGRAPHIC_MODES,
  PLACEMENT_MODES,
  reportFor,
  fieldsFor,
  validateFilters,
  buildFiltering,
  resolveMetaDateRange,
  validateBreakdowns,
  resolveDemographicBreakdowns,
  resolvePlacementBreakdowns,
  resolveScopeReport,
  buildInsightsQuery,
  rowLimits,
};
