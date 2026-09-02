/**
 * Converts structured schedule rules to cron expressions and builds test payloads.
 */

const { normalizeScheduleRule, requiresAnchorScheduling } = require("../config/nodeContract");

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const pad = (n) => String(n).padStart(2, "0");

const intervalValue = (rule, key, legacyEvery, fallback = 1) =>
  Math.max(1, Number(rule[key] ?? rule.every ?? legacyEvery) || fallback);

const ruleToCron = (rawRule) => {
  const rule = normalizeScheduleRule(rawRule);
  if (!rule || typeof rule !== "object") return "0 9 * * 1-5";

  const interval = rule.triggerInterval || rule.field || "weeks";
  const cronExpr = rule.cronExpression || rule.expression;

  if (interval === "cron" && cronExpr) {
    return String(cronExpr).trim();
  }

  // N>1 weeks/months/days cannot be expressed as simple cron — caller must use anchor scheduling
  if (requiresAnchorScheduling(rule)) {
    return null;
  }

  const minute = Number(rule.triggerAtMinute ?? 0);
  const hour = Number(rule.triggerAtHour ?? 9);

  switch (interval) {
    case "seconds": {
      const every = intervalValue(rule, "secondsInterval", 30);
      return `*/${every} * * * * *`;
    }
    case "minutes": {
      const every = intervalValue(rule, "minutesInterval", 5);
      return `*/${every} * * * *`;
    }
    case "hours": {
      const every = intervalValue(rule, "hoursInterval", 1);
      return `${minute} */${every} * * *`;
    }
    case "days": {
      const every = intervalValue(rule, "daysInterval", 1);
      return `${minute} ${hour} */${every} * *`;
    }
    case "weeks": {
      const days = Array.isArray(rule.triggerAtDay) ? rule.triggerAtDay : [1];
      const dow = days.map((d) => Number(d)).join(",");
      return `${minute} ${hour} * * ${dow}`;
    }
    case "months": {
      const dom = Math.min(31, Math.max(1, Number(rule.triggerAtDayOfMonth) || 1));
      return `${minute} ${hour} ${dom} * *`;
    }
    default:
      return `${minute} ${hour} * * 1-5`;
  }
};

const rulesToCrons = (data) => {
  const rules = Array.isArray(data?.scheduleRules) ? data.scheduleRules : [];
  if (rules.length > 0) {
    return rules.map(ruleToCron).filter((c) => c != null);
  }
  if (data?.cron) return [String(data.cron)];
  return ["0 9 * * 1-5"];
};

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
  ruleToCron,
  rulesToCrons,
  buildTestTriggerPayload,
  requiresAnchorScheduling,
};
