const toSheet = (input = {}) => {
  const rows = Array.isArray(input.rows)
    ? input.rows
    : Array.isArray(input.opportunities)
      ? input.opportunities
      : [];
  const headers = [
    ...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : []))),
  ];
  return {
    handoff: "googleSheets",
    title: input.title || "GSC MCP export",
    siteUrl: input.siteUrl || "",
    headers,
    values: rows.map((r) => headers.map((h) => (r == null ? "" : r[h]))),
    rowCount: rows.length,
  };
};

module.exports = { toSheet };
