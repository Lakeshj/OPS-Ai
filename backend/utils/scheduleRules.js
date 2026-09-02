/**
 * Schedule rule helpers — delegates to scheduleRecurrence (Part 7).
 */

const {
  normalizeScheduleNodeData,
  ruleToCron,
  rulesToCrons,
  requiresAnchorScheduling,
  validateScheduleNodeData,
  validateScheduleRule,
  getNextScheduleOccurrence,
  getNextScheduleOccurrences,
  ensureRecurrenceAnchors,
  formatOccurrencePreview,
  classifyScheduleStrategy,
  SCHEDULE_STRATEGIES,
} = require("./scheduleRecurrence");

const { normalizeScheduleRule } = require("../config/nodeContract");

const buildTestTriggerPayload = (timezone = "UTC") => {
  const now = new Date();
  const readable = now.toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "long",
    timeStyle: "medium",
  });
  const readableTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    timeStyle: "medium",
  });
  const dayName = now.toLocaleString("en-US", { weekday: "long", timeZone: timezone });
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    timestamp: now.toISOString(),
    "Readable date": readable,
    "Readable time": readableTime,
    "Day of week": dayName,
    Year: get("year"),
    Month: now.toLocaleString("en-US", { month: "long", timeZone: timezone }),
    "Day of month": get("day"),
    Hour: get("hour"),
    Minute: get("minute"),
    Second: get("second"),
    Timezone: timezone,
    readableDate: readable,
    dayOfWeek: dayName,
    dayOfMonth: get("day"),
    timezone,
  };
};

module.exports = {
  normalizeScheduleRule,
  normalizeScheduleNodeData,
  ruleToCron,
  rulesToCrons,
  requiresAnchorScheduling,
  validateScheduleNodeData,
  validateScheduleRule,
  getNextScheduleOccurrence,
  getNextScheduleOccurrences,
  ensureRecurrenceAnchors,
  formatOccurrencePreview,
  classifyScheduleStrategy,
  SCHEDULE_STRATEGIES,
  buildTestTriggerPayload,
};
