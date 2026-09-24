/**
 * Part 14D.5 — Calendar date-range presets for GSC / GA4.
 * Resolves to YYYY-MM-DD at runtime (UTC calendar dates).
 *
 * Phase 2: optional comparison range (second API period). Comparison is never
 * inferred from the primary preset — only explicit comparison dates when enabled.
 */

const { DateTime } = require("luxon");

const GSC_PRESETS = Object.freeze([
  "today",
  "yesterday",
  "last7days",
  "last28days",
  "last30days",
  "custom",
]);

const GA4_PRESETS = Object.freeze([
  "today",
  "yesterday",
  "last7days",
  "last28days",
  "last30days",
  "lastCalendarWeek",
  "lastCalendarMonth",
  "custom",
]);

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const todayUtc = (nowMs) =>
  DateTime.fromMillis(nowMs || Date.now(), { zone: "utc" }).startOf("day");

const iso = (dt) => dt.toISODate();

const isYmd = (value) => YMD_RE.test(String(value || "").trim());

const resolveDateRange = (preset, { startDate, endDate, nowMs } = {}) => {
  const key = String(preset || "last7days");
  const today = todayUtc(nowMs);
  if (key === "custom") {
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    if (!isYmd(start) || !isYmd(end)) {
      throw new Error("Custom date range requires startDate and endDate (YYYY-MM-DD)");
    }
    if (start > end) {
      throw new Error("Custom startDate must be on or before endDate");
    }
    return { startDate: start, endDate: end, preset: "custom" };
  }
  if (key === "today") {
    return { startDate: iso(today), endDate: iso(today), preset: key };
  }
  if (key === "yesterday") {
    const y = today.minus({ days: 1 });
    return { startDate: iso(y), endDate: iso(y), preset: key };
  }
  if (key === "last7days") {
    return {
      startDate: iso(today.minus({ days: 6 })),
      endDate: iso(today),
      preset: key,
    };
  }
  if (key === "last28days") {
    return {
      startDate: iso(today.minus({ days: 27 })),
      endDate: iso(today),
      preset: key,
    };
  }
  if (key === "last30days") {
    return {
      startDate: iso(today.minus({ days: 29 })),
      endDate: iso(today),
      preset: key,
    };
  }
  if (key === "lastCalendarWeek") {
    const lastWeek = today.minus({ weeks: 1 });
    const start = lastWeek.startOf("week");
    const end = lastWeek.endOf("week");
    return { startDate: iso(start), endDate: iso(end), preset: key };
  }
  if (key === "lastCalendarMonth") {
    const lastMonth = today.minus({ months: 1 });
    return {
      startDate: iso(lastMonth.startOf("month")),
      endDate: iso(lastMonth.endOf("month")),
      preset: key,
    };
  }
  throw new Error(`Unknown date range preset: ${key}`);
};

const isComparisonEnabled = (value) =>
  value === true || value === "true" || value === 1 || value === "1";

/**
 * Resolve primary (+ optional comparison) ranges for GSC / GA4 nodes.
 *
 * Node data fields (existing + Phase 2):
 * - dateRange, startDate, endDate — primary (unchanged when comparison off)
 * - comparisonEnabled — boolean
 * - comparisonStartDate, comparisonEndDate — Compare Against (custom only)
 *
 * When comparison is enabled and the user supplies primary start/end while a
 * preset is selected, those explicit primary dates win (all four editable).
 * Comparison dates are never auto-calculated from the primary range.
 *
 * @returns {{
 *   dateRange: { startDate: string, endDate: string, preset: string },
 *   comparison: { enabled: false } | { enabled: true, startDate: string, endDate: string }
 * }}
 */
const resolvePrimaryAndComparison = (
  data = {},
  {
    startDate,
    endDate,
    comparisonStartDate,
    comparisonEndDate,
    nowMs,
  } = {}
) => {
  const preset = data.dateRange || "last7days";
  const comparisonOn = isComparisonEnabled(data.comparisonEnabled);

  const start = startDate != null ? startDate : data.startDate;
  const end = endDate != null ? endDate : data.endDate;
  const compareStart =
    comparisonStartDate != null
      ? comparisonStartDate
      : data.comparisonStartDate;
  const compareEnd =
    comparisonEndDate != null ? comparisonEndDate : data.comparisonEndDate;

  let primary;
  if (
    comparisonOn &&
    String(preset) !== "custom" &&
    isYmd(start) &&
    isYmd(end)
  ) {
    // Comparison mode with explicit primary dates — do not silently alter them.
    primary = resolveDateRange("custom", {
      startDate: start,
      endDate: end,
      nowMs,
    });
  } else {
    primary = resolveDateRange(preset, {
      startDate: start,
      endDate: end,
      nowMs,
    });
  }

  const dateRange = {
    startDate: primary.startDate,
    endDate: primary.endDate,
    preset: primary.preset,
  };

  if (!comparisonOn) {
    return {
      dateRange,
      comparison: { enabled: false },
    };
  }

  let comparison;
  try {
    comparison = resolveDateRange("custom", {
      startDate: compareStart,
      endDate: compareEnd,
      nowMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/startDate and endDate/i.test(msg)) {
      throw new Error(
        "Compare Against requires comparisonStartDate and comparisonEndDate (YYYY-MM-DD)"
      );
    }
    if (/on or before/i.test(msg)) {
      throw new Error(
        "Compare Against startDate must be on or before endDate"
      );
    }
    throw err;
  }

  return {
    dateRange,
    comparison: {
      enabled: true,
      startDate: comparison.startDate,
      endDate: comparison.endDate,
    },
  };
};

module.exports = {
  GSC_PRESETS,
  GA4_PRESETS,
  resolveDateRange,
  resolvePrimaryAndComparison,
  isComparisonEnabled,
  isYmd,
};
