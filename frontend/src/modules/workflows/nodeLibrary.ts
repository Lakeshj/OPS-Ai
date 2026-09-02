import catalog from "./nodeLibrary.json";
import type { WorkflowNodeType } from "./types";

export type LibraryNodeTypeKind =
  | "Trigger"
  | "Action"
  | "Logic"
  | "AI"
  | "Core"
  | "Transform"
  | "Tool";

export interface LibraryNode {
  id: string;
  name: string;
  category: string;
  type: LibraryNodeTypeKind | string;
  description: string;
  icon: string;
  provider: string | null;
  available: boolean;
  engineType: WorkflowNodeType | null;
}

export interface NodeLibraryCatalog {
  version: number;
  updatedAt: string;
  categories: string[];
  nodes: LibraryNode[];
}

export const nodeLibraryCatalog = catalog as NodeLibraryCatalog;

export const LIBRARY_CATEGORIES = nodeLibraryCatalog.categories;

export function searchLibraryNodes(
  query: string,
  category: string | "all" = "all"
): LibraryNode[] {
  const q = query.trim().toLowerCase();
  return nodeLibraryCatalog.nodes.filter((n) => {
    if (category !== "all" && n.category !== category) return false;
    if (!q) return true;
    return (
      n.name.toLowerCase().includes(q) ||
      n.category.toLowerCase().includes(q) ||
      n.description.toLowerCase().includes(q) ||
      String(n.provider || "")
        .toLowerCase()
        .includes(q) ||
      n.type.toLowerCase().includes(q)
    );
  });
}

export function resolveEngineType(node: LibraryNode): WorkflowNodeType {
  if (node.engineType) return node.engineType;
  if (node.available) return "noop";
  return "integration";
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadLibraryJson() {
  const blob = new Blob([JSON.stringify(nodeLibraryCatalog, null, 2)], {
    type: "application/json",
  });
  downloadBlob("workflow-node-library.json", blob);
}

export function downloadLibraryCsv() {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Node Name", "Category", "Type", "Description", "Provider", "Available"]
      .map(esc)
      .join(","),
    ...nodeLibraryCatalog.nodes.map((n) =>
      [
        n.name,
        n.category,
        n.type,
        n.description,
        n.provider || "",
        n.available ? "true" : "false",
      ]
        .map(esc)
        .join(",")
    ),
  ];
  downloadBlob(
    "workflow-node-library.csv",
    new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" })
  );
}

/** Minimal XLSX (SpreadsheetML XML in a zip) — Excel-compatible. */
export async function downloadLibraryXlsx() {
  const rows = nodeLibraryCatalog.nodes;
  const headers = [
    "Node Name",
    "Category",
    "Type",
    "Description",
    "Provider",
    "Available",
  ];

  const escapeXml = (value: unknown) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const colLetter = (i: number) => String.fromCharCode(65 + i);

  let sheetData = "";
  const all = [
    headers,
    ...rows.map((n) => [
      n.name,
      n.category,
      n.type,
      n.description,
      n.provider || "",
      n.available ? "true" : "false",
    ]),
  ];
  all.forEach((row, rIdx) => {
    const r = rIdx + 1;
    sheetData += `<row r="${r}">`;
    row.forEach((value, cIdx) => {
      const ref = `${colLetter(cIdx)}${r}`;
      sheetData += `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    });
    sheetData += `</row>`;
  });

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetData}</sheetData>
</worksheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Node Library" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const files: Array<{ name: string; content: string }> = [
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rels },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
  ];

  const enc = new TextEncoder();
  const crcTable = (() => {
    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (buf: Uint8Array) => {
    let crc = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  };

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = enc.encode(file.name);
    const dataBuf = enc.encode(file.content);
    const crc = crc32(dataBuf);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBuf.length, true);
    lv.setUint32(22, dataBuf.length, true);
    lv.setUint16(26, nameBuf.length, true);
    lv.setUint16(28, 0, true);
    parts.push(local, nameBuf, dataBuf);

    const centralHeader = new Uint8Array(46);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBuf.length, true);
    cv.setUint32(24, dataBuf.length, true);
    cv.setUint16(28, nameBuf.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.push(centralHeader, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = concat(central);
  const localData = concat(parts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralDir.length, true);
  ev.setUint32(16, localData.length, true);

  const zip = concat([localData, centralDir, end]);
  downloadBlob(
    "workflow-node-library.xlsx",
    new Blob([zip], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
}

function concat(chunks: Uint8Array[]) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
