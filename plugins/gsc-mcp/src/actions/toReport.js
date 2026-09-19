const toReport = (input = {}) => {
  const rows = Array.isArray(input.rows)
    ? input.rows
    : Array.isArray(input.opportunities)
      ? input.opportunities
      : [];
  return {
    handoff: "report",
    title: input.title || "GSC SEO report",
    siteUrl: input.siteUrl || "",
    generatedAt: new Date().toISOString(),
    summary: {
      rowCount: rows.length,
      totalClicks: rows.reduce((s, r) => s + Number(r?.clicks || 0), 0),
      totalImpressions: rows.reduce(
        (s, r) => s + Number(r?.impressions || 0),
        0
      ),
    },
    sections: [
      {
        id: "data",
        title: "Results",
        rows: rows.slice(0, 500),
      },
    ],
  };
};

module.exports = { toReport };
