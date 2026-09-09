/**
 * Part 14D.5 — Calendar date-range presets for GSC / GA4.
 * Resolves to YYYY-MM-DD at runtime (UTC calendar dates).
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

const todayUtc = (nowMs) =>
  DateTime.fromMillis(nowMs || Date.now(), { zone: "utc" }).startOf("day");

const iso = (dt) => dt.toISODate();

const resolveDateRange = (preset, { startDate, endDate, nowMs } = {}) => {
  const key = String(preset || "last7days");
  const today = todayUtc(nowMs);
  if (key === "custom") {
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
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

module.exports = {
  GSC_PRESETS,
  GA4_PRESETS,
  resolveDateRange,
};
