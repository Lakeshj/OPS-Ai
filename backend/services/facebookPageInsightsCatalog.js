/**
 * Curated Facebook Page / Post Insights metric catalog (organic).
 * UI must not accept arbitrary metric strings.
 * Meta has deprecated many Page metrics — keep this list explicit and map
 * unsupported-metric Graph errors separately from execution failures.
 */

const AppError = require("../utils/AppError");

const PAGE_METRICS = Object.freeze({
  page_impressions: Object.freeze({
    label: "Page impressions",
    periods: Object.freeze(["day", "week", "days_28"]),
    defaultPeriod: "day",
  }),
  page_impressions_unique: Object.freeze({
    label: "Page reach",
    periods: Object.freeze(["day", "week", "days_28"]),
    defaultPeriod: "day",
  }),
  page_post_engagements: Object.freeze({
    label: "Post engagements",
    periods: Object.freeze(["day", "week", "days_28"]),
    defaultPeriod: "day",
  }),
  page_fans: Object.freeze({
    label: "Page fans",
    periods: Object.freeze(["day"]),
    defaultPeriod: "day",
  }),
  page_fan_adds: Object.freeze({
    label: "New Page likes",
    periods: Object.freeze(["day", "week", "days_28"]),
    defaultPeriod: "day",
  }),
  page_views_total: Object.freeze({
    label: "Page views",
    periods: Object.freeze(["day", "week", "days_28"]),
    defaultPeriod: "day",
  }),
  page_actions_post_reactions_total: Object.freeze({
    label: "Post reactions",
    periods: Object.freeze(["day", "week", "days_28"]),
    defaultPeriod: "day",
  }),
});

const POST_METRICS = Object.freeze({
  post_impressions: Object.freeze({
    label: "Post impressions",
    periods: Object.freeze(["lifetime"]),
    defaultPeriod: "lifetime",
  }),
  post_impressions_unique: Object.freeze({
    label: "Post reach",
    periods: Object.freeze(["lifetime"]),
    defaultPeriod: "lifetime",
  }),
  post_engaged_users: Object.freeze({
    label: "Engaged users",
    periods: Object.freeze(["lifetime"]),
    defaultPeriod: "lifetime",
  }),
  post_clicks: Object.freeze({
    label: "Post clicks",
    periods: Object.freeze(["lifetime"]),
    defaultPeriod: "lifetime",
  }),
  post_reactions_by_type_total: Object.freeze({
    label: "Reactions by type",
    periods: Object.freeze(["lifetime"]),
    defaultPeriod: "lifetime",
  }),
});

const PAGE_REPORTS = Object.freeze({
  page_overview: Object.freeze({
    label: "Page overview",
    metrics: Object.freeze([
      "page_impressions",
      "page_impressions_unique",
      "page_post_engagements",
      "page_fan_adds",
      "page_views_total",
    ]),
    defaultPeriod: "day",
  }),
  page_audience: Object.freeze({
    label: "Page audience",
    metrics: Object.freeze(["page_fans", "page_fan_adds"]),
    defaultPeriod: "day",
  }),
  page_engagement: Object.freeze({
    label: "Page engagement",
    metrics: Object.freeze([
      "page_post_engagements",
      "page_actions_post_reactions_total",
    ]),
    defaultPeriod: "day",
  }),
});

const POST_REPORTS = Object.freeze({
  post_overview: Object.freeze({
    label: "Post overview",
    metrics: Object.freeze([
      "post_impressions",
      "post_impressions_unique",
      "post_engaged_users",
      "post_clicks",
    ]),
    defaultPeriod: "lifetime",
  }),
  post_reactions: Object.freeze({
    label: "Post reactions",
    metrics: Object.freeze(["post_reactions_by_type_total"]),
    defaultPeriod: "lifetime",
  }),
});

const catalogError = (message, code = "FACEBOOK_PAGE_METRIC_UNSUPPORTED") =>
  new AppError(message, 400, code);

const resolvePageInsightsRequest = ({ reportType, metrics, period } = {}) => {
  const reportKey = String(reportType || "page_overview").trim();
  let metricKeys;
  let defaultPeriod = "day";
  if (Object.prototype.hasOwnProperty.call(PAGE_REPORTS, reportKey)) {
    metricKeys = [...PAGE_REPORTS[reportKey].metrics];
    defaultPeriod = PAGE_REPORTS[reportKey].defaultPeriod;
  } else if (metrics != null && String(metrics).trim()) {
    metricKeys = String(metrics)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else {
    throw catalogError("Choose a Facebook Page Insights report.");
  }
  for (const key of metricKeys) {
    if (!Object.prototype.hasOwnProperty.call(PAGE_METRICS, key)) {
      throw catalogError(`Unsupported Facebook Page metric: ${key}.`);
    }
  }
  const periodKey = String(period || defaultPeriod).trim() || defaultPeriod;
  for (const key of metricKeys) {
    if (!PAGE_METRICS[key].periods.includes(periodKey)) {
      throw catalogError(
        `${PAGE_METRICS[key].label} does not support period "${periodKey}".`,
        "FACEBOOK_PAGE_PERIOD_UNSUPPORTED"
      );
    }
  }
  return {
    kind: "page",
    reportType: reportKey,
    metrics: metricKeys,
    period: periodKey,
    labels: Object.fromEntries(
      metricKeys.map((key) => [key, PAGE_METRICS[key].label])
    ),
  };
};

const resolvePostInsightsRequest = ({ reportType, metrics, period } = {}) => {
  const reportKey = String(reportType || "post_overview").trim();
  let metricKeys;
  let defaultPeriod = "lifetime";
  if (Object.prototype.hasOwnProperty.call(POST_REPORTS, reportKey)) {
    metricKeys = [...POST_REPORTS[reportKey].metrics];
    defaultPeriod = POST_REPORTS[reportKey].defaultPeriod;
  } else if (metrics != null && String(metrics).trim()) {
    metricKeys = String(metrics)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else {
    throw catalogError("Choose a Facebook Post Insights report.");
  }
  for (const key of metricKeys) {
    if (!Object.prototype.hasOwnProperty.call(POST_METRICS, key)) {
      throw catalogError(`Unsupported Facebook Post metric: ${key}.`);
    }
  }
  const periodKey = String(period || defaultPeriod).trim() || defaultPeriod;
  for (const key of metricKeys) {
    if (!POST_METRICS[key].periods.includes(periodKey)) {
      throw catalogError(
        `${POST_METRICS[key].label} does not support period "${periodKey}".`,
        "FACEBOOK_PAGE_PERIOD_UNSUPPORTED"
      );
    }
  }
  return {
    kind: "post",
    reportType: reportKey,
    metrics: metricKeys,
    period: periodKey,
    labels: Object.fromEntries(
      metricKeys.map((key) => [key, POST_METRICS[key].label])
    ),
  };
};

module.exports = {
  PAGE_METRICS,
  POST_METRICS,
  PAGE_REPORTS,
  POST_REPORTS,
  resolvePageInsightsRequest,
  resolvePostInsightsRequest,
};
