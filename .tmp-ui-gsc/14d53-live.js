/**
 * 14D.5.3 live probes that this environment can actually run.
 * Never prints secrets. Google OAuth is expected BLOCKED_BY_CONFIG when unset.
 */
const path = require("path");
const fs = require("fs");

module.paths.unshift(path.join(__dirname, "../backend/node_modules"));
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });

const { executeAiGenerate } = require("../backend/services/workflowAiGenerate.service");
const { executeXlsxBuilder, MIME } = require("../backend/services/workflowXlsxBuilder.service");
const ExcelJS = require("exceljs");

const report = {
  LIVE_OAUTH_1: "BLOCKED_BY_CONFIG",
  LIVE_AIGEN_1: "NOT_RUN",
  LIVE_AIGEN_2: "NOT_RUN",
  LIVE_XLSX_1: "NOT_RUN",
  notes: [],
};

const containsSecret = (blob) => {
  const key = String(process.env.OPENAI_API_KEY || "");
  if (key && blob.includes(key)) return "openai_key";
  if (/sk-[A-Za-z0-9_-]{20,}/.test(blob)) return "sk_pattern";
  if (/ya29\.[A-Za-z0-9._-]+/.test(blob)) return "google_access";
  if (/1\/\/[A-Za-z0-9_-]+/.test(blob)) return "google_refresh";
  return null;
};

(async () => {
  const oauthConfigured = Boolean(
    String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim() &&
      String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim()
  );
  if (!oauthConfigured) {
    report.notes.push("oauth_env UNSET — LIVE-OAUTH-1 cannot start");
    report.LIVE_OAUTH_1 = "BLOCKED_BY_CONFIG";
  } else {
    report.notes.push("oauth_env SET — connect must be completed in editor");
    report.LIVE_OAUTH_1 = "NOT_RUN";
  }

  const leak1 = containsSecret(JSON.stringify({ envNamesOnly: true }));
  if (leak1) throw new Error("precheck leak detector misfire");

  const ready = await executeAiGenerate(
    {
      id: "aigen-live-1",
      type: "aiGenerate",
      data: {
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: "Return exactly the word READY.",
      },
    },
    { input: {}, inputItems: [{ json: {} }] }
  );
  const readyText = String(ready.items?.[0]?.json?.text || ready.output?.text || "");
  const readyBlob = JSON.stringify(ready);
  const readyLeak = containsSecret(readyBlob);
  const readyOk =
    /\bREADY\b/.test(readyText) &&
    ready.items.length === 1 &&
    ready.resolved?.agent === false &&
    ready.resolved?.tools === false &&
    !readyLeak;
  report.LIVE_AIGEN_1 = readyOk ? "PASS" : "FAIL";
  report.notes.push(
    `aigen1 text_has_READY=${/\bREADY\b/.test(readyText)} items=${ready.items.length} leak=${readyLeak || "none"} agent=${ready.resolved?.agent} tools=${ready.resolved?.tools}`
  );

  const expr = await executeAiGenerate(
    {
      id: "aigen-live-2",
      type: "aiGenerate",
      data: {
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: "{{input.prompt}}",
      },
    },
    {
      input: { prompt: "Return exactly the word EXPRESSION_OK." },
      inputItems: [{ json: { prompt: "Return exactly the word EXPRESSION_OK." } }],
    }
  );
  const exprText = String(expr.items?.[0]?.json?.text || expr.output?.text || "");
  const exprLeak = containsSecret(JSON.stringify(expr));
  const exprOk = /\bEXPRESSION_OK\b/.test(exprText) && expr.items.length === 1 && !exprLeak;
  report.LIVE_AIGEN_2 = exprOk ? "PASS" : "FAIL";
  report.notes.push(
    `aigen2 text_has_EXPRESSION_OK=${/\bEXPRESSION_OK\b/.test(exprText)} items=${expr.items.length} leak=${exprLeak || "none"}`
  );

  const built = await executeXlsxBuilder(
    {
      id: "xlsx-live-1",
      type: "xlsxBuilder",
      data: {
        fileName: "opsai-live-test.xlsx",
        sheets: [
          {
            name: "Summary",
            headerRow: true,
            rows: [{ status: "opsai_live_test", when: "2026-09-08" }],
          },
          {
            name: "Details",
            headerRow: true,
            rows: [
              { row: 1, note: "sheet-two" },
              { row: 2, note: "multi-sheet" },
            ],
          },
        ],
      },
    },
    { input: {}, inputItems: [{ json: {} }] }
  );
  const bin = built.items?.[0]?.binary?.data;
  const buf = Buffer.from(bin.data, "base64");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const names = wb.worksheets.map((s) => s.name);
  const summaryOk = names.includes("Summary");
  const detailsOk = names.includes("Details");
  const fileOk = built.items?.[0]?.json?.fileName === "opsai-live-test.xlsx";
  const mimeOk = bin.mimeType === MIME;
  const xlsxOk =
    summaryOk && detailsOk && fileOk && mimeOk && buf.length > 100 && names.length === 2;
  report.LIVE_XLSX_1 = xlsxOk ? "PASS" : "FAIL";
  report.notes.push(
    `xlsx1 sheets=${names.join(",")} bytes=${buf.length} fileName_ok=${fileOk} mime_ok=${mimeOk}`
  );
  fs.writeFileSync(path.join(__dirname, "opsai-live-test.xlsx"), buf);

  fs.writeFileSync(
    path.join(__dirname, "14d53-live-report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.LIVE_AIGEN_1 === "FAIL" || report.LIVE_AIGEN_2 === "FAIL" || report.LIVE_XLSX_1 === "FAIL") {
    process.exit(1);
  }
})().catch((err) => {
  console.error("LIVE_PROBE_FAILED", err && err.message ? err.message : "error");
  process.exit(1);
});
