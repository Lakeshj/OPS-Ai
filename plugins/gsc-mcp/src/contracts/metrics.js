/**
 * Stable metric contracts for future GSC Filter / Sort / Analysis nodes.
 * Internal ids stay stable; UI labels are presentation-only.
 */

const METRIC_FIELDS = Object.freeze([
  {
    id: "get_impressions",
    field: "impressions",
    label: "Impressions",
    description: "Search impression count",
  },
  {
    id: "get_clicks",
    field: "clicks",
    label: "Clicks",
    description: "Search click count",
  },
  {
    id: "get_ctr",
    field: "ctr",
    label: "CTR",
    description: "Click-through rate (0–1)",
  },
  {
    id: "get_position",
    field: "position",
    label: "Position",
    description: "Average ranking position",
  },
]);

const labelForMetricId = (id) => {
  const hit = METRIC_FIELDS.find((m) => m.id === id || m.field === id);
  return hit ? hit.label : String(id || "");
};

const fieldForMetricId = (id) => {
  const hit = METRIC_FIELDS.find((m) => m.id === id || m.field === id);
  return hit ? hit.field : String(id || "");
};

const metricOptionsForUi = () =>
  METRIC_FIELDS.map((m) => ({
    value: m.id,
    label: m.label,
    field: m.field,
  }));

module.exports = {
  METRIC_FIELDS,
  labelForMetricId,
  fieldForMetricId,
  metricOptionsForUi,
};
