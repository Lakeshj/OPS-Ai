/**
 * Authoritative OpsAi schedule recurrence engine (Part 7).
 * Single source of truth for validation, next-occurrence math, and strategy classification.
 */

const crypto = require("node:crypto");
const { DateTime } = require("luxon");
const { CronExpressionParser } = require("cron-parser");
const {
  normalizeScheduleRule: normalizeLegacyFields,
} = require("../config/nodeContract");

const SCHEDULE_STRATEGIES = {
  CRON: "CRON_COMPATIBLE",
  ANCHORED: "ANCHORED_RECURRENCE",
};

/** Max single setTimeout delay before reconciliation recalculates. */
const MAX_SCHEDULER_WAKE_MS = 24 * 60 * 60 * 1000;

const generateRuleId = () =>
  `sch_${crypto.randomBytes(4).toString("hex")}`;

const intervalValue = (rule, key, fallback = 1) =>
  Math.max(1, Number(rule[key] ?? rule.every ?? fallback) || fallback);

const uiDayOfWeek = (dt) => (dt.weekday === 7 ? 0 : dt.weekday);

const weekStartSunday = (dt) =>
  dt.minus({ days: uiDayOfWeek(dt) }).startOf("day");

const toDateTime = (value, zone) => {
  if (value instanceof DateTime) return value.setZone(zone);
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone });
  return DateTime.fromISO(String(value), { zone });
};

const resolveTimezone = (rule, nodeData = {}, definition = {}) => {
  const tz =
    rule?.timezone ||
    nodeData?.timezone ||
    definition?.settings?.timezone ||
    "UTC";
  const probe = DateTime.now().setZone(String(tz));
  if (!probe.isValid) {
    throw new Error(`Invalid timezone: ${tz}`);
  }
  return String(tz);
};

/** Normalize legacy + assign stable rule id when missing. */
const normalizeCanonicalRule = (rawRule, options = {}) => {
  const base = normalizeLegacyFields(rawRule);
  const intervalType = base.triggerInterval || base.field || "weeks";
  const rule = {
    ...base,
    id: base.id || options.ruleId || generateRuleId(),
    triggerInterval: intervalType,
    field: intervalType,
    secondsInterval: intervalValue(base, "secondsInterval", 30),
    minutesInterval: intervalValue(base, "minutesInterval", 5),
    hoursInterval: intervalValue(base, "hoursInterval", 1),
    daysInterval: intervalValue(base, "daysInterval", 1),
    weeksInterval: intervalValue(base, "weeksInterval", 1),
    monthsInterval: intervalValue(base, "monthsInterval", 1),
    triggerAtHour: Number(base.triggerAtHour ?? 9),
    triggerAtMinute: Number(base.triggerAtMinute ?? 0),
    triggerAtDay: Array.isArray(base.triggerAtDay)
      ? [...base.triggerAtDay].map(Number).sort((a, b) => a - b)
      : [1],
    triggerAtDayOfMonth: Math.min(
      31,
      Math.max(1, Number(base.triggerAtDayOfMonth ?? 1))
    ),
    cronExpression:
      base.cronExpression || base.expression
        ? String(base.cronExpression || base.expression).trim()
        : undefined,
    recurrenceAnchor: base.recurrenceAnchor || null,
  };
  return rule;
};

const classifyScheduleStrategy = (rawRule) => {
  const rule = normalizeCanonicalRule(rawRule);
  const intervalType = rule.triggerInterval;
  if (intervalType === "cron") return SCHEDULE_STRATEGIES.CRON;
  if (intervalType === "days" && rule.daysInterval > 1) {
    return SCHEDULE_STRATEGIES.ANCHORED;
  }
  if (intervalType === "weeks" && rule.weeksInterval > 1) {
    return SCHEDULE_STRATEGIES.ANCHORED;
  }
  if (intervalType === "months" && rule.monthsInterval > 1) {
    return SCHEDULE_STRATEGIES.ANCHORED;
  }
  return SCHEDULE_STRATEGIES.CRON;
};

const requiresAnchorScheduling = (rawRule) =>
  classifyScheduleStrategy(rawRule) === SCHEDULE_STRATEGIES.ANCHORED;

const ruleToCron = (rawRule) => {
  const rule = normalizeCanonicalRule(rawRule);
  if (classifyScheduleStrategy(rule) === SCHEDULE_STRATEGIES.ANCHORED) {
    return null;
  }

  const intervalType = rule.triggerInterval;
  const cronExpr = rule.cronExpression;

  if (intervalType === "cron") {
    return cronExpr || null;
  }

  const minute = rule.triggerAtMinute;
  const hour = rule.triggerAtHour;

  switch (intervalType) {
    case "seconds":
      return `*/${rule.secondsInterval} * * * * *`;
    case "minutes":
      return `*/${rule.minutesInterval} * * * *`;
    case "hours":
      return `${minute} */${rule.hoursInterval} * * *`;
    case "days":
      return `${minute} ${hour} * * *`;
    case "weeks": {
      const dow = (rule.triggerAtDay || [1]).join(",");
      return `${minute} ${hour} * * ${dow}`;
    }
    case "months":
      return `${minute} ${hour} ${rule.triggerAtDayOfMonth} * *`;
    default:
      return `${minute} ${hour} * * 1-5`;
  }
};

const validateScheduleRule = (rawRule, context = {}) => {
  const errors = [];
  let rule;
  try {
    rule = normalizeCanonicalRule(rawRule);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }

  const intervalType = rule.triggerInterval;

  if (intervalType === "cron") {
    if (!rule.cronExpression) {
      errors.push("Custom cron rule requires a cron expression");
    } else {
      try {
        CronExpressionParser.parse(rule.cronExpression, {
          tz: resolveTimezone(rule, context.nodeData, context.definition),
        });
      } catch {
        errors.push(`Invalid cron expression: ${rule.cronExpression}`);
      }
    }
    return errors;
  }

  const intervalKeys = {
    seconds: "secondsInterval",
    minutes: "minutesInterval",
    hours: "hoursInterval",
    days: "daysInterval",
    weeks: "weeksInterval",
    months: "monthsInterval",
  };
  const key = intervalKeys[intervalType];
  if (!key) {
    errors.push(`Unsupported schedule interval: ${intervalType}`);
    return errors;
  }
  if (intervalValue(rule, key) < 1) {
    errors.push("Interval must be at least 1");
  }

  if (intervalType !== "seconds" && intervalType !== "minutes") {
    if (rule.triggerAtHour < 0 || rule.triggerAtHour > 23) {
      errors.push("Hour must be between 0 and 23");
    }
    if (rule.triggerAtMinute < 0 || rule.triggerAtMinute > 59) {
      errors.push("Minute must be between 0 and 59");
    }
  }

  if (intervalType === "weeks") {
    const days = rule.triggerAtDay || [];
    if (days.length === 0) {
      errors.push("Weekly schedule requires at least one weekday");
    }
    if (days.some((d) => d < 0 || d > 6)) {
      errors.push("Weekday must be between 0 (Sun) and 6 (Sat)");
    }
  }

  if (intervalType === "months") {
    if (rule.triggerAtDayOfMonth < 1 || rule.triggerAtDayOfMonth > 31) {
      errors.push("Day of month must be between 1 and 31");
    }
  }

  try {
    resolveTimezone(rule, context.nodeData, context.definition);
  } catch (err) {
    errors.push(err.message);
  }

  if (classifyScheduleStrategy(rule) === SCHEDULE_STRATEGIES.ANCHORED) {
    // anchored rules are supported — no silent drop
    return errors;
  }

  const cron = ruleToCron(rule);
  if (!cron) {
    errors.push("Schedule rule could not be converted to a supported recurrence");
  } else {
    try {
      CronExpressionParser.parse(cron, {
        tz: resolveTimezone(rule, context.nodeData, context.definition),
      });
    } catch {
      errors.push(`Invalid derived cron expression: ${cron}`);
    }
  }

  return errors;
};

const normalizeScheduleNodeData = (nodeData = {}, options = {}) => {
  const data = { ...nodeData };
  const legacyCron = String(data.cron || "").trim();
  let rules = Array.isArray(data.scheduleRules) ? data.scheduleRules : [];

  if (rules.length === 0 && legacyCron) {
    rules = [{ field: "cron", expression: legacyCron, cronExpression: legacyCron }];
  }

  data.scheduleRules = rules.map((rule, index) =>
    normalizeCanonicalRule(rule, { ruleId: rule.id || `legacy-${index}` })
  );
  if (legacyCron && !data.cron) data.cron = legacyCron;
  return data;
};

const validateScheduleNodeData = (nodeData = {}, definition = {}) => {
  const data = normalizeScheduleNodeData(nodeData);
  const errors = [];
  const rules = data.scheduleRules || [];
  if (rules.length === 0) {
    errors.push("Add at least one schedule rule");
    return errors;
  }
  for (const [index, rule] of rules.entries()) {
    const ruleErrors = validateScheduleRule(rule, { nodeData: data, definition });
    for (const err of ruleErrors) {
      errors.push(`Rule ${index + 1}: ${err}`);
    }
  }
  return errors;
};

const buildLocalDateTime = (dt, hour, minute, zone) => {
  const base = dt.setZone(zone).startOf("day");
  let candidate = base.set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
  if (!candidate.isValid) {
    // Spring-forward gap: shift to next valid local time (Luxon default).
    candidate = base.set({ hour, minute, second: 0, millisecond: 0 });
  }
  if (!candidate.isValid) return null;
  return candidate;
};

/** Bounded delay for scheduler wake-ups — never one multi-month setTimeout.
 *  delay = min(max(target - now, 0), MAX_SCHEDULER_WAKE_MS)
 *  Cap is max sleep horizon only; final wake uses actual remaining ms. */
const computeBoundedDelayMs = (targetMs, nowMs = Date.now()) => {
  const remaining = Math.max(0, targetMs - nowMs);
  return Math.min(remaining, MAX_SCHEDULER_WAKE_MS);
};

/**
 * Stable identity for an intended local wall-clock occurrence.
 * Second precision distinguishes sub-minute cron intervals (e.g. every 10s).
 * DST fall-back: repeated local wall times share the same key (no UTC offset).
 */
const buildLocalOccurrenceKey = (dt, zone) =>
  dt.setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm:ss");

const buildScheduleIdempotencyKey = (
  workflowId,
  nodeId,
  ruleId,
  dt,
  zone
) => {
  const localKey = buildLocalOccurrenceKey(dt, zone);
  return `schedule:${workflowId}:${nodeId}:${ruleId}:${localKey}:${zone}`;
};

const monthHasDay = (year, month, day, zone) => {
  const probe = DateTime.fromObject(
    { year, month, day, hour: 12, minute: 0 },
    { zone }
  );
  return probe.isValid && probe.day === day;
};

const getNextCronOccurrence = (rule, after, zone) => {
  const expr = ruleToCron(rule);
  if (!expr) return null;
  const parser = CronExpressionParser.parse(expr, {
    currentDate: after.toJSDate(),
    tz: zone,
  });
  const next = parser.next();
  return DateTime.fromJSDate(next.toDate(), { zone });
};

const getNextAnchoredOccurrence = (rule, after, zone, anchorIso) => {
  const anchor = toDateTime(anchorIso || after.toISO(), zone);
  const intervalType = rule.triggerInterval;
  const hour = rule.triggerAtHour;
  const minute = rule.triggerAtMinute;

  let cursor = after.setZone(zone).startOf("day");
  const limit = cursor.plus({ years: 3 });

  while (cursor < limit) {
    if (intervalType === "days") {
      const every = rule.daysInterval;
      const anchorDay = anchor.startOf("day");
      const daysDiff = Math.floor(cursor.diff(anchorDay, "days").days);
      if (daysDiff >= 0 && daysDiff % every === 0) {
        const occ = buildLocalDateTime(cursor, hour, minute, zone);
        if (occ && occ > after) return occ;
      }
      cursor = cursor.plus({ days: 1 });
      continue;
    }

    if (intervalType === "weeks") {
      const every = rule.weeksInterval;
      const days = rule.triggerAtDay || [1];
      const uiDow = uiDayOfWeek(cursor);
      if (days.includes(uiDow)) {
        const anchorWeek = weekStartSunday(anchor);
        const cursorWeek = weekStartSunday(cursor);
        const weeksDiff = Math.floor(
          cursorWeek.diff(anchorWeek, "weeks").weeks
        );
        if (weeksDiff >= 0 && weeksDiff % every === 0) {
          const occ = buildLocalDateTime(cursor, hour, minute, zone);
          if (occ && occ > after) return occ;
        }
      }
      cursor = cursor.plus({ days: 1 });
      continue;
    }

    if (intervalType === "months") {
      const every = rule.monthsInterval;
      const dom = rule.triggerAtDayOfMonth;
      const monthDiff =
        (cursor.year - anchor.year) * 12 + (cursor.month - anchor.month);
      if (
        monthDiff >= 0 &&
        monthDiff % every === 0 &&
        monthHasDay(cursor.year, cursor.month, dom, zone)
      ) {
        const occ = buildLocalDateTime(
          cursor.set({ day: dom }),
          hour,
          minute,
          zone
        );
        if (occ && occ > after) return occ;
      }
      cursor = cursor.plus({ days: 1 });
      continue;
    }

    break;
  }

  return null;
};

const getNextScheduleOccurrence = (rawRule, options = {}) => {
  const rule = normalizeCanonicalRule(rawRule);
  const zone = resolveTimezone(
    rule,
    options.nodeData,
    options.definition
  );
  const after = toDateTime(options.after || DateTime.now(), zone);
  const strategy = classifyScheduleStrategy(rule);

  if (strategy === SCHEDULE_STRATEGIES.CRON) {
    return getNextCronOccurrence(rule, after, zone);
  }

  const anchor =
    options.anchor ||
    rule.recurrenceAnchor ||
    options.defaultAnchor ||
    after.toISO();
  return getNextAnchoredOccurrence(rule, after, zone, anchor);
};

const getNextScheduleOccurrences = (rawRule, options = {}) => {
  const count = Math.max(1, Math.min(Number(options.count) || 5, 20));
  const results = [];
  let after = options.after || DateTime.now();
  const zone = resolveTimezone(
    normalizeCanonicalRule(rawRule),
    options.nodeData,
    options.definition
  );
  after = toDateTime(after, zone);

  for (let i = 0; i < count * 8 && results.length < count; i += 1) {
    const next = getNextScheduleOccurrence(rawRule, {
      ...options,
      after,
    });
    if (!next) break;
    const localKey = buildLocalOccurrenceKey(next, zone);
    if (!results.some((r) => buildLocalOccurrenceKey(r, zone) === localKey)) {
      results.push(next);
    }
    after = next.plus({ seconds: 1 });
  }
  return results;
};

const ensureRecurrenceAnchors = (nodeData = {}, activationTime = new Date()) => {
  const data = normalizeScheduleNodeData(nodeData);
  const activationIso = activationTime.toISOString();
  data.scheduleRules = (data.scheduleRules || []).map((rule) => {
    if (classifyScheduleStrategy(rule) !== SCHEDULE_STRATEGIES.ANCHORED) {
      return rule;
    }
    if (rule.recurrenceAnchor) return rule;
    return { ...rule, recurrenceAnchor: activationIso };
  });
  return data;
};

const rulesToCrons = (nodeData = {}) => {
  const data = normalizeScheduleNodeData(nodeData);
  const rules = data.scheduleRules || [];
  if (rules.length === 0 && data.cron) return [String(data.cron)];
  const crons = [];
  for (const rule of rules) {
    const errors = validateScheduleRule(rule, { nodeData: data });
    if (errors.length > 0) continue;
    const cron = ruleToCron(rule);
    if (cron) crons.push(cron);
  }
  return crons.length > 0 ? crons : ["0 9 * * 1-5"];
};

const formatOccurrencePreview = (dt, zone) =>
  dt.setZone(zone).toFormat("MMM d, yyyy h:mm a");

module.exports = {
  SCHEDULE_STRATEGIES,
  MAX_SCHEDULER_WAKE_MS,
  generateRuleId,
  normalizeCanonicalRule,
  normalizeScheduleNodeData,
  classifyScheduleStrategy,
  requiresAnchorScheduling,
  ruleToCron,
  rulesToCrons,
  validateScheduleRule,
  validateScheduleNodeData,
  resolveTimezone,
  getNextScheduleOccurrence,
  getNextScheduleOccurrences,
  ensureRecurrenceAnchors,
  formatOccurrencePreview,
  computeBoundedDelayMs,
  buildLocalOccurrenceKey,
  buildScheduleIdempotencyKey,
};
