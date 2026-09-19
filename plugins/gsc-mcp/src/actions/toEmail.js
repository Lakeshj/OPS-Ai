const toEmail = (input = {}) => {
  const rows = Array.isArray(input.rows)
    ? input.rows
    : Array.isArray(input.opportunities)
      ? input.opportunities
      : [];
  const title = input.title || "GSC SEO digest";
  const siteUrl = input.siteUrl || "";
  const lines = rows.slice(0, 25).map((r, i) => {
    if (!r || typeof r !== "object") return `${i + 1}. ${String(r)}`;
    const label = r.query || r.page || r.opportunity || `row ${i + 1}`;
    const metrics = [
      r.clicks != null ? `clicks=${r.clicks}` : null,
      r.impressions != null ? `impr=${r.impressions}` : null,
      r.ctr != null ? `ctr=${r.ctr}` : null,
      r.position != null ? `pos=${r.position}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `${i + 1}. ${label}${metrics ? ` (${metrics})` : ""}`;
  });
  const body = [
    title,
    siteUrl ? `Property: ${siteUrl}` : null,
    "",
    ...lines,
    rows.length > 25 ? `\n…and ${rows.length - 25} more` : null,
  ]
    .filter((x) => x != null)
    .join("\n");
  return {
    handoff: "gmail",
    subject: title,
    emailBody: body,
    siteUrl,
    itemCount: rows.length,
  };
};

module.exports = { toEmail };
