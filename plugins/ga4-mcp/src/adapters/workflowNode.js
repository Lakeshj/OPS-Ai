/**
 * Map capability results → WorkflowItems.
 * No Google client — local shaping only.
 */

const resultToWorkflowItems = (result) => {
  if (!result?.ok) {
    return {
      output: {
        ok: false,
        error: result?.error || { message: "failed" },
        warnings: result?.warnings || [],
      },
      items: [],
    };
  }

  const data = result.data;
  let rows = [];

  if (Array.isArray(data?.opportunities) && data.opportunities.length) {
    rows = data.opportunities;
  } else if (Array.isArray(data?.rows) && data.rows.length) {
    rows = data.rows;
  } else if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === "object") {
    rows = [];
  }

  return {
    output: {
      ok: true,
      capability: result.capability,
      warnings: result.warnings || data?.warnings || [],
      itemCount: rows.length,
      scaffold: data?.scaffold === true,
      implemented: data?.implemented === true,
    },
    items: rows.map((row, index) => ({
      json: row && typeof row === "object" ? row : { value: row },
      pairedItem: { item: index },
    })),
  };
};

module.exports = {
  resultToWorkflowItems,
};
