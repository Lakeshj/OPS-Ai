/**
 * Instagram Login insights catalogs (graph.instagram.com v27).
 * Server-owned — no free-text metrics. Separate from Meta Ads Insights.
 */

const AppError = require("../utils/AppError");

const CATALOG_VERSION = "instagram-insights-v27-m4";

const PERIODS = Object.freeze([
  "day",
  "week",
  "days_28",
  "month",
  "lifetime",
  "total_over_range",
]);

const METRIC_TYPES = Object.freeze(["time_series", "total_value"]);

const ACCOUNT_BREAKDOWNS = Object.freeze([
  "age",
  "city",
  "country",
  "gender",
  "follow_type",
]);

/** @type {Record<string, {
 *   allowedPeriods: string[],
 *   requiredMetricType?: string|null,
 *   supportsDateRange: boolean,
 *   supportsBreakdown: boolean,
 *   allowedBreakdowns?: string[],
 *   title: string,
 * }>} */
const ACCOUNT_METRICS = Object.freeze({
  views: {
    title: "Views",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: null,
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  reach: {
    title: "Reach",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: null,
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  follower_count: {
    title: "Follower count",
    allowedPeriods: ["day"],
    requiredMetricType: null,
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  profile_views: {
    title: "Profile views",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: null,
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  accounts_engaged: {
    title: "Accounts engaged",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  total_interactions: {
    title: "Total interactions",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  likes: {
    title: "Likes",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  comments: {
    title: "Comments",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  shares: {
    title: "Shares",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  saves: {
    title: "Saves",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  replies: {
    title: "Replies",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  follows_and_unfollows: {
    title: "Follows and unfollows",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  profile_links_taps: {
    title: "Profile links taps",
    allowedPeriods: ["day", "week", "days_28", "total_over_range"],
    requiredMetricType: "total_value",
    supportsDateRange: true,
    supportsBreakdown: false,
  },
  online_followers: {
    title: "Online followers",
    allowedPeriods: ["lifetime"],
    requiredMetricType: null,
    supportsDateRange: false,
    supportsBreakdown: false,
  },
  follower_demographics: {
    title: "Follower demographics",
    allowedPeriods: ["lifetime"],
    requiredMetricType: "total_value",
    supportsDateRange: false,
    supportsBreakdown: true,
    allowedBreakdowns: [...ACCOUNT_BREAKDOWNS],
  },
  engaged_audience_demographics: {
    title: "Engaged audience demographics",
    allowedPeriods: ["lifetime"],
    requiredMetricType: "total_value",
    supportsDateRange: false,
    supportsBreakdown: true,
    allowedBreakdowns: [...ACCOUNT_BREAKDOWNS],
  },
  reached_audience_demographics: {
    title: "Reached audience demographics",
    allowedPeriods: ["lifetime"],
    requiredMetricType: "total_value",
    supportsDateRange: false,
    supportsBreakdown: true,
    allowedBreakdowns: [...ACCOUNT_BREAKDOWNS],
  },
});

/**
 * Media metrics keyed by provider name.
 * mediaTypes: IMAGE | VIDEO | CAROUSEL_ALBUM | REELS | STORY
 */
const MEDIA_METRICS = Object.freeze({
  views: {
    title: "Views",
    mediaTypes: ["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS", "STORY"],
  },
  reach: {
    title: "Reach",
    mediaTypes: ["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS", "STORY"],
  },
  likes: {
    title: "Likes",
    mediaTypes: ["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS"],
  },
  comments: {
    title: "Comments",
    mediaTypes: ["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS"],
  },
  shares: {
    title: "Shares",
    mediaTypes: ["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS"],
  },
  saved: {
    title: "Saved",
    mediaTypes: ["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS"],
  },
  total_interactions: {
    title: "Total interactions",
    mediaTypes: ["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS"],
  },
  ig_reels_avg_watch_time: {
    title: "Reels average watch time",
    mediaTypes: ["REELS"],
  },
  ig_reels_video_view_total_time: {
    title: "Reels total watch time",
    mediaTypes: ["REELS"],
  },
  replies: {
    title: "Replies",
    mediaTypes: ["STORY"],
  },
  navigation: {
    title: "Navigation",
    mediaTypes: ["STORY"],
  },
  exits: {
    title: "Exits",
    mediaTypes: ["STORY"],
  },
  taps_forward: {
    title: "Taps forward",
    mediaTypes: ["STORY"],
  },
  taps_back: {
    title: "Taps back",
    mediaTypes: ["STORY"],
  },
});

const ACCOUNT_PRESETS = Object.freeze({
  overview: ["views", "reach", "accounts_engaged", "total_interactions"],
  engagement: ["likes", "comments", "shares", "saves"],
  audience: ["follower_count", "follows_and_unfollows", "profile_views"],
  demographics: ["follower_demographics"],
  custom: null,
});

const MEDIA_PRESETS = Object.freeze({
  overview: ["views", "reach", "total_interactions"],
  engagement: ["likes", "comments", "shares", "saved"],
  reels: [
    "views",
    "reach",
    "ig_reels_avg_watch_time",
    "ig_reels_video_view_total_time",
  ],
  stories: ["views", "reach", "replies", "navigation"],
  custom: null,
});

const DATE_PRESETS = Object.freeze([
  "last7days",
  "last14days",
  "last28days",
  "last30days",
  "thisMonth",
  "lastMonth",
  "custom",
]);

const catalogError = (message, code = "INSTAGRAM_INSIGHTS_INVALID") =>
  new AppError(message, 400, code);

const listOf = (value) => {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
};

const normalizeMediaType = (raw) => {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return "";
  if (value === "CAROUSEL") return "CAROUSEL_ALBUM";
  if (value === "REEL" || value === "IGTV") return "REELS";
  if (value === "STORIES") return "STORY";
  return value;
};

const resolveAccountPresetMetrics = (preset, customMetrics) => {
  const key = String(preset || "overview").trim() || "overview";
  if (!Object.prototype.hasOwnProperty.call(ACCOUNT_PRESETS, key)) {
    throw catalogError(`Unknown Instagram account insights preset: ${key}.`);
  }
  if (key === "custom") {
    const metrics = listOf(customMetrics);
    if (!metrics.length) {
      throw catalogError("Select at least one account insights metric.");
    }
    return metrics;
  }
  return [...ACCOUNT_PRESETS[key]];
};

const resolveMediaPresetMetrics = (preset, customMetrics) => {
  const key = String(preset || "overview").trim() || "overview";
  if (!Object.prototype.hasOwnProperty.call(MEDIA_PRESETS, key)) {
    throw catalogError(`Unknown Instagram media insights preset: ${key}.`);
  }
  if (key === "custom") {
    const metrics = listOf(customMetrics);
    if (!metrics.length) {
      throw catalogError("Select at least one media insights metric.");
    }
    return metrics;
  }
  return [...MEDIA_PRESETS[key]];
};

const getAccountMetric = (name) => {
  const key = String(name || "").trim();
  if (!Object.prototype.hasOwnProperty.call(ACCOUNT_METRICS, key)) {
    throw catalogError(
      `Unsupported Instagram account insight metric: ${key || "(empty)"}.`,
      "INSTAGRAM_INSIGHTS_METRIC_INVALID"
    );
  }
  return { name: key, ...ACCOUNT_METRICS[key] };
};

const getMediaMetric = (name) => {
  const key = String(name || "").trim();
  if (!Object.prototype.hasOwnProperty.call(MEDIA_METRICS, key)) {
    throw catalogError(
      `Unsupported Instagram media insight metric: ${key || "(empty)"}.`,
      "INSTAGRAM_INSIGHTS_METRIC_INVALID"
    );
  }
  return { name: key, ...MEDIA_METRICS[key] };
};

const assertAccountMetricPeriod = (metricName, period) => {
  const metric = getAccountMetric(metricName);
  const p = String(period || "").trim();
  if (!PERIODS.includes(p)) {
    throw catalogError(`Unsupported Instagram insights period: ${p || "(empty)"}.`);
  }
  if (!metric.allowedPeriods.includes(p)) {
    throw catalogError(
      `Metric "${metric.name}" does not support period "${p}". Allowed: ${metric.allowedPeriods.join(", ")}.`,
      "INSTAGRAM_INSIGHTS_PERIOD_INVALID"
    );
  }
  return metric;
};

const assertMediaMetricForType = (metricName, mediaType) => {
  const metric = getMediaMetric(metricName);
  const type = normalizeMediaType(mediaType);
  if (!type) {
    throw catalogError(
      "Media type is required to validate media insights metrics.",
      "INSTAGRAM_MEDIA_TYPE_REQUIRED"
    );
  }
  if (!metric.mediaTypes.includes(type)) {
    throw catalogError(
      `Metric "${metric.name}" is not available for media type ${type}.`,
      "INSTAGRAM_INSIGHTS_MEDIA_UNSUPPORTED"
    );
  }
  return metric;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toUnixDay = (iso) => {
  const text = String(iso || "").trim();
  if (!ISO_DATE_RE.test(text)) {
    throw catalogError(`${text || "Date"} must be YYYY-MM-DD.`, "INSTAGRAM_DATE_RANGE_INVALID");
  }
  const ms = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) {
    throw catalogError(`${text} must be YYYY-MM-DD.`, "INSTAGRAM_DATE_RANGE_INVALID");
  }
  return Math.floor(ms / 1000);
};

/**
 * Resolve date preset to since/until (UTC days, inclusive).
 * Does not silently rewrite caller-supplied custom since/until.
 */
const resolveInsightsDateRange = ({
  dateRange,
  since,
  until,
  nowMs = Date.now(),
} = {}) => {
  const customSince = String(since || "").trim();
  const customUntil = String(until || "").trim();
  if (customSince || customUntil) {
    if (!customSince || !customUntil) {
      throw catalogError(
        "Provide both since and until dates (YYYY-MM-DD).",
        "INSTAGRAM_DATE_RANGE_INVALID"
      );
    }
    const sinceSec = toUnixDay(customSince);
    const untilSec = toUnixDay(customUntil);
    if (sinceSec > untilSec) {
      throw catalogError(
        "since must be on or before until.",
        "INSTAGRAM_DATE_RANGE_INVALID"
      );
    }
    return {
      since: customSince,
      until: customUntil,
      sinceUnix: sinceSec,
      untilUnix: untilSec,
      preset: "custom",
    };
  }

  const preset = String(dateRange || "last7days").trim() || "last7days";
  if (!DATE_PRESETS.includes(preset) || preset === "custom") {
    throw catalogError(
      `Choose a date range preset or provide since/until.`,
      "INSTAGRAM_DATE_RANGE_INVALID"
    );
  }

  const today = new Date(Number(nowMs));
  const utcDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const format = (ms) => new Date(ms).toISOString().slice(0, 10);

  let startMs;
  let endMs = utcDay - dayMs; // yesterday by default for trailing windows

  switch (preset) {
    case "last7days":
      startMs = endMs - 6 * dayMs;
      break;
    case "last14days":
      startMs = endMs - 13 * dayMs;
      break;
    case "last28days":
      startMs = endMs - 27 * dayMs;
      break;
    case "last30days":
      startMs = endMs - 29 * dayMs;
      break;
    case "thisMonth": {
      startMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
      endMs = utcDay;
      break;
    }
    case "lastMonth": {
      startMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
      endMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0);
      break;
    }
    default:
      throw catalogError(`Unsupported date range: ${preset}.`, "INSTAGRAM_DATE_RANGE_INVALID");
  }

  const sinceIso = format(startMs);
  const untilIso = format(endMs);
  return {
    since: sinceIso,
    until: untilIso,
    sinceUnix: toUnixDay(sinceIso),
    untilUnix: toUnixDay(untilIso),
    preset,
  };
};

/**
 * Build validated account insight request groups.
 * Metrics with incompatible periods/types are not silently coerced.
 */
const buildAccountInsightRequests = ({
  preset,
  metrics,
  period,
  dateRange,
  since,
  until,
  breakdown,
  metricType,
  nowMs,
}) => {
  const names = resolveAccountPresetMetrics(preset, metrics);
  const requestedPeriod = String(period || "").trim();
  const breakdownValue = String(breakdown || "").trim();
  const metricTypeOverride = String(metricType || "").trim();

  const wantsRange = Boolean(
    String(dateRange || "").trim() ||
      String(since || "").trim() ||
      String(until || "").trim() ||
      requestedPeriod === "total_over_range"
  );
  let range = null;
  if (wantsRange) {
    range = resolveInsightsDateRange({ dateRange, since, until, nowMs });
  }
  if (requestedPeriod === "total_over_range" && !range) {
    throw catalogError(
      "Period total_over_range requires a date range (since/until).",
      "INSTAGRAM_DATE_RANGE_INVALID"
    );
  }

  const groups = new Map();
  for (const name of names) {
    const metric = getAccountMetric(name);
    let periodForMetric = requestedPeriod;
    if (!periodForMetric) {
      periodForMetric = metric.allowedPeriods.includes("day")
        ? "day"
        : metric.allowedPeriods[0];
    }
    assertAccountMetricPeriod(name, periodForMetric);

    if (metric.supportsBreakdown) {
      if (!breakdownValue) {
        throw catalogError(
          `Metric "${name}" requires a breakdown (${(metric.allowedBreakdowns || []).join(", ")}).`,
          "INSTAGRAM_INSIGHTS_BREAKDOWN_REQUIRED"
        );
      }
      if (!(metric.allowedBreakdowns || []).includes(breakdownValue)) {
        throw catalogError(
          `Breakdown "${breakdownValue}" is not valid for ${name}.`,
          "INSTAGRAM_INSIGHTS_BREAKDOWN_INVALID"
        );
      }
    }
    // Non-demographic metrics ignore breakdown; do not fail the whole request.

    const type =
      metricTypeOverride ||
      metric.requiredMetricType ||
      (periodForMetric === "total_over_range" ? "total_value" : "");

    if (metric.requiredMetricType && type && type !== metric.requiredMetricType) {
      throw catalogError(
        `Metric "${name}" requires metric_type=${metric.requiredMetricType}.`,
        "INSTAGRAM_INSIGHTS_METRIC_TYPE_INVALID"
      );
    }
    if (type && !METRIC_TYPES.includes(type)) {
      throw catalogError(
        `Unsupported metric_type: ${type}.`,
        "INSTAGRAM_INSIGHTS_METRIC_TYPE_INVALID"
      );
    }

    if (
      (periodForMetric === "total_over_range" ||
        (metric.supportsDateRange && (since || until || dateRange))) &&
      !metric.supportsDateRange
    ) {
      throw catalogError(
        `Metric "${name}" does not support since/until date ranges.`,
        "INSTAGRAM_DATE_RANGE_INVALID"
      );
    }

    const key = [
      periodForMetric,
      type || "",
      metric.supportsBreakdown ? breakdownValue : "",
      metric.supportsDateRange && range ? `${range.sinceUnix}:${range.untilUnix}` : "",
    ].join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        period: periodForMetric,
        metricType: type || undefined,
        breakdown: metric.supportsBreakdown ? breakdownValue : undefined,
        sinceUnix: metric.supportsDateRange && range ? range.sinceUnix : undefined,
        untilUnix: metric.supportsDateRange && range ? range.untilUnix : undefined,
        since: metric.supportsDateRange && range ? range.since : undefined,
        until: metric.supportsDateRange && range ? range.until : undefined,
        metrics: [],
      });
    }
    groups.get(key).metrics.push(name);
  }

  return {
    groups: [...groups.values()],
    range,
    metrics: names,
  };
};

const buildMediaInsightRequest = ({
  preset,
  metrics,
  mediaType,
}) => {
  const type = normalizeMediaType(mediaType);
  if (!type) {
    throw catalogError(
      "Media type is required to validate media insights metrics.",
      "INSTAGRAM_MEDIA_TYPE_REQUIRED"
    );
  }
  const key = String(preset || "overview").trim() || "overview";
  if (key === "custom") {
    const names = resolveMediaPresetMetrics("custom", metrics);
    const validated = names.map((name) => assertMediaMetricForType(name, type).name);
    return { metrics: validated, mediaType: type, rejected: [] };
  }
  const { allowed, rejected } = filterMediaPresetForType(key, type);
  if (!allowed.length) {
    throw catalogError(
      `No metrics in preset "${key}" are available for media type ${type}.`,
      "INSTAGRAM_INSIGHTS_MEDIA_UNSUPPORTED"
    );
  }
  return { metrics: allowed, mediaType: type, rejected };
};

const filterMediaPresetForType = (preset, mediaType) => {
  const type = normalizeMediaType(mediaType);
  const names = resolveMediaPresetMetrics(preset, null);
  const allowed = [];
  const rejected = [];
  for (const name of names) {
    const metric = getMediaMetric(name);
    if (metric.mediaTypes.includes(type)) allowed.push(name);
    else rejected.push(name);
  }
  return { allowed, rejected, mediaType: type };
};

module.exports = {
  CATALOG_VERSION,
  PERIODS,
  METRIC_TYPES,
  ACCOUNT_BREAKDOWNS,
  ACCOUNT_METRICS,
  MEDIA_METRICS,
  ACCOUNT_PRESETS,
  MEDIA_PRESETS,
  DATE_PRESETS,
  resolveAccountPresetMetrics,
  resolveMediaPresetMetrics,
  getAccountMetric,
  getMediaMetric,
  assertAccountMetricPeriod,
  assertMediaMetricForType,
  normalizeMediaType,
  resolveInsightsDateRange,
  buildAccountInsightRequests,
  buildMediaInsightRequest,
  filterMediaPresetForType,
  listOf,
};
