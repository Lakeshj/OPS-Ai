/**
 * Part 14D.5 — In-memory XLSX workbook builder (exceljs).
 * No filesystem writes. Output uses canonical WorkflowItem.binary.
 */

const ExcelJS = require("exceljs");

const MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const LIMITS = Object.freeze({
  maxSheets: 20,
  maxRowsPerSheet: 10000,
  maxCells: 200000,
  maxBytes: 8 * 1024 * 1024,
  maxCellChars: 8000,
});

const itemPayload = (item) => {
  if (item && typeof item === "object" && !Array.isArray(item) && "json" in item) {
    return item.json && typeof item.json === "object" ? item.json : { value: item.json };
  }
  if (item && typeof item === "object" && !Array.isArray(item)) return item;
  return { value: item };
};

const interpolateMaybe = (value, context) => {
  if (typeof value !== "string" || !value.includes("{{")) return value;
  const { interpolate } = require("./workflowNodes.service");
  return interpolate(value, {
    input: context.input,
    steps: context.steps,
    items: context.items,
    item: context.item,
  });
};

const rowsFromSource = (sheetCfg, inputItems, context) => {
  const field = sheetCfg.field || sheetCfg.rowsField;
  if (field) {
    const first = itemPayload(inputItems[0] || { json: {} }) || {};
    const raw = first[field];
    if (Array.isArray(raw)) {
      return raw.map((row) =>
        row && typeof row === "object" && "json" in row ? row.json : row
      );
    }
  }
  if (sheetCfg.rows != null) {
    const resolved = interpolateMaybe(sheetCfg.rows, context);
    if (Array.isArray(resolved)) return resolved;
    if (typeof resolved === "string") {
      try {
        const parsed = JSON.parse(resolved);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // fall through
      }
    }
  }
  return inputItems.map((it) => itemPayload(it) || {});
};

const cellString = (value) => {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > LIMITS.maxCellChars ? s.slice(0, LIMITS.maxCellChars) : s;
};

const executeXlsxBuilder = async (node, context) => {
  const data = node.data || {};
  const inputItems = Array.isArray(context.inputItems) ? context.inputItems : [];
  let sheets = Array.isArray(data.sheets) ? data.sheets : [];
  if (sheets.length === 0) {
    sheets = [{ name: "Sheet1", headerRow: true }];
  }
  if (sheets.length > LIMITS.maxSheets) {
    throw new Error(`XLSX Builder allows at most ${LIMITS.maxSheets} sheets`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpsAi";
  const rowCounts = [];
  let cells = 0;

  for (const cfg of sheets) {
    const name = String(interpolateMaybe(cfg.name || "Sheet", context) || "Sheet").slice(0, 31);
    const ws = workbook.addWorksheet(name || "Sheet");
    const rows = rowsFromSource(cfg, inputItems, context);
    if (rows.length > LIMITS.maxRowsPerSheet) {
      throw new Error(`XLSX Builder allows at most ${LIMITS.maxRowsPerSheet} rows per sheet`);
    }
    const headerRow = cfg.headerRow !== false;
    const columnOrder = Array.isArray(cfg.columnOrder)
      ? cfg.columnOrder.map(String)
      : [];
    const keys = columnOrder.length
      ? columnOrder
      : [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
    if (headerRow && keys.length) {
      ws.addRow(keys);
      cells += keys.length;
    }
    for (const row of rows) {
      const obj = row && typeof row === "object" ? row : { value: row };
      const values = keys.length ? keys.map((k) => cellString(obj[k])) : [cellString(obj)];
      ws.addRow(values);
      cells += values.length;
      if (cells > LIMITS.maxCells) {
        throw new Error(`XLSX Builder exceeds the ${LIMITS.maxCells} cell limit`);
      }
    }
    rowCounts.push(headerRow && keys.length ? rows.length + 1 : rows.length);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = Buffer.from(buffer);
  if (bytes.length > LIMITS.maxBytes) {
    throw new Error("XLSX Builder exceeded the 8 MB workbook size limit");
  }
  const fileName = String(
    interpolateMaybe(data.fileName || "report.xlsx", context) || "report.xlsx"
  );
  const safeName = fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  const b64 = bytes.toString("base64");

  const binaryKey = String(data.binaryProperty || "data").trim() || "data";
  return {
    items: [
      {
        json: {
          fileName: safeName,
          sheetCount: sheets.length,
          rowCounts,
          size: bytes.length,
        },
        binary: {
          [binaryKey]: {
            fileName: safeName,
            mimeType: MIME,
            data: b64,
            size: bytes.length,
          },
        },
      },
    ],
    output: {
      fileName: safeName,
      sheetCount: sheets.length,
      rowCounts,
      mimeType: MIME,
      size: bytes.length,
    },
    resolved: { fileName: safeName, sheetCount: sheets.length },
  };
};

module.exports = {
  executeXlsxBuilder,
  LIMITS,
  MIME,
};
