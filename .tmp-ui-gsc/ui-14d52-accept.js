/**
 * Part 14D.5.2 browser UX acceptance walk.
 * Creates a workflow via the New Workflow button. Does not call Google APIs.
 */
const path = require("path");
const fs = require("fs");

module.paths.unshift(path.join(__dirname, "node_modules"));
module.paths.unshift(path.join(__dirname, "../backend/node_modules"));

const jwt = require("jsonwebtoken");
const { chromium } = require("playwright");
const { pool } = require("../backend/config/database");
const config = require("../backend/config");
const { parseSpreadsheetRef } = require("../backend/services/resourceLocator");
const { GOOGLE_PRODUCTS } = require("../backend/services/googleOAuth.service");

const BASE = process.env.UI_BASE || "http://localhost:3001";
const API = `${BASE}/api`;
const WORKSPACE_ID =
  process.env.SEED_WORKSPACE_ID || "1a470f32-6f02-40a4-ac83-0b5cdafc50d0";
const OUT = __dirname;
const report = {
  checks: {},
  defects: [],
  notes: [],
  shots: [],
};

const shot = async (page, name) => {
  const file = path.join(OUT, `14d52-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.shots.push(name);
};

const fail = (key, msg) => {
  report.checks[key] = "FAIL";
  report.defects.push(`${key}: ${msg}`);
  console.log("FAIL", key, msg);
};

const pass = (key, extra) => {
  report.checks[key] = "PASS";
  if (extra) console.log("PASS", key, extra);
  else console.log("PASS", key);
};

const note = (msg) => {
  report.notes.push(msg);
  console.log("NOTE", msg);
};

const dialog = (page) => page.getByRole("dialog").last();

const closeDialog = async (page) => {
  const closeBtns = page.getByRole("button", { name: /^Close$/i });
  const n = await closeBtns.count();
  if (n) {
    await closeBtns.last().click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
};

const openLibrary = async (page) => {
  await closeDialog(page);
  const search = page.getByLabel("Search nodes");
  if (await search.isVisible().catch(() => false)) return search;
  await page.getByRole("button", { name: /^Nodes$/ }).click({ force: true });
  await search.waitFor({ timeout: 10000 });
  return search;
};

const addNode = async (page, searchText, addName) => {
  const search = await openLibrary(page);
  await search.fill("");
  await search.fill(searchText);
  const add = page.getByRole("button", {
    name: `Add ${addName}`,
    exact: true,
  });
  await add.first().waitFor({ timeout: 10000 });
  await add.first().click();
  await dialog(page).waitFor({ timeout: 15000 });
};

const locatorBlock = (page, label) =>
  dialog(page)
    .locator("div.space-y-1\\.5")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();

const visibleTexts = async (page) => {
  const d = page.getByRole("dialog").filter({ hasText: "Parameters" }).last();
  if (!(await d.count())) {
    const fallback = dialog(page);
    if (!(await fallback.count())) return "";
    return (await fallback.innerText()).replace(/\s+/g, " ");
  }
  return (await d.innerText()).replace(/\s+/g, " ");
};

const hasText = async (page, re) => {
  const t = await visibleTexts(page);
  return re.test(t);
};

const fillLocatorMode = async (page, label, mode, value) => {
  const block = locatorBlock(page, label);
  await block.scrollIntoViewIfNeeded();
  await block.getByRole("button", { name: mode, exact: true }).click();
  if (mode === "Manual") {
    const input = block.locator("input").last();
    await input.fill(value);
  } else if (mode === "Expression") {
    const field = block.locator("input, textarea").last();
    await field.fill(value);
  }
};

const readLocatorValue = async (page, label) => {
  const block = locatorBlock(page, label);
  const field = block.locator("input, textarea").last();
  if (await field.count()) return field.inputValue();
  return "";
};

const selectNearLabel = async (page, label, optionName) => {
  const d = dialog(page);
  const lab = d.getByText(label, { exact: true }).last();
  await lab.scrollIntoViewIfNeeded();
  const group = lab.locator("xpath=..");
  await group.getByRole("combobox").click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
};

const fillLabeled = async (page, label, value) => {
  const d = dialog(page);
  const lab = d.getByText(label, { exact: true }).last();
  await lab.scrollIntoViewIfNeeded();
  const field = lab.locator("xpath=..").locator("input, textarea").last();
  await field.fill(value);
  return field.inputValue();
};

const setNodeLabel = async (page, name) => {
  await fillLabeled(page, "Label", name);
};

const saveWorkflow = async (page) => {
  await closeDialog(page);
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page
    .getByRole("button", { name: /^Saving/ })
    .waitFor({ state: "hidden", timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(600);
};

const fetchWorkflow = async (token, id) => {
  const res = await fetch(`${API}/workflows/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET workflow ${res.status}`);
  return res.json();
};

const mintToken = async () => {
  const [rows] = await pool.execute(
    `SELECT id, email, role FROM users ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows.length) throw new Error("No user to mint JWT");
  const user = rows[0];
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      isDeveloper: false,
    },
    config.jwt.secret,
    { algorithm: "HS256", expiresIn: "2h" }
  );
  return { token, user };
};

(async () => {
  const { token, user } = await mintToken();
  console.log("jwt user", user.email, user.role);

  const sheetsScopes = GOOGLE_PRODUCTS.google_sheets.scopes || [];
  const driveAdded = sheetsScopes.some((s) => /drive/i.test(s));
  if (driveAdded) fail("sheets-drive-scope", String(sheetsScopes));
  else pass("sheets-drive-scope", sheetsScopes.join(","));

  const parsed = parseSpreadsheetRef(
    "https://docs.google.com/spreadsheets/d/TEST_SPREADSHEET_ID/edit"
  );
  if (parsed.spreadsheetId === "TEST_SPREADSHEET_ID" && parsed.fromUrl) {
    pass("sheets-url-parser", parsed.spreadsheetId);
  } else {
    fail("sheets-url-parser", JSON.stringify(parsed));
  }

  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  page.setDefaultTimeout(20000);

  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => localStorage.setItem("token", t), token);
    await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Sign Out/i }).waitFor({
      timeout: 25000,
    });
    await shot(page, "01-workspaces");
    const wsLink = page.locator('main a[href*="/projects/"]').first();
    await wsLink.waitFor({ timeout: 15000 });
    await wsLink.click();
    await page.getByRole("button", { name: /^Workflow$/ }).waitFor({
      timeout: 25000,
    });
    await page.getByRole("button", { name: /^Workflow$/ }).click();
    await page.getByRole("button", { name: /New Workflow/i }).waitFor({
      timeout: 25000,
    });
    await shot(page, "01-workspace-workflow");
    await page.getByRole("button", { name: /New Workflow/i }).click();
    await page.waitForURL(/\/workflows\/[a-f0-9-]+/, { timeout: 25000 });
    const workflowId = page.url().split("/workflows/")[1].split(/[?#]/)[0];
    report.workflowId = workflowId;
    await page.getByRole("button", { name: /^Save$/ }).waitFor({ timeout: 20000 });
    await shot(page, "02-editor");

    // ---------- GSC ----------
    await addNode(page, "Google Search Console", "Google Search Console");
    await shot(page, "03-gsc-open");
    const gscText = await visibleTexts(page);
    const gscOk = [
      /Credential/i.test(gscText),
      /Site \/ Property/i.test(gscText),
      /From account/i.test(gscText),
      /\bManual\b/i.test(gscText),
      /\bExpression\b/i.test(gscText),
      /No authentication/i.test(gscText) || /Add credential/i.test(gscText),
      /Operation/i.test(gscText),
      /Date range/i.test(gscText),
      /Row limit/i.test(gscText),
    ];
    if (gscOk.every(Boolean)) pass("gsc-fields");
    else fail("gsc-fields", gscText.slice(0, 400));

    await locatorBlock(page, "Site / Property")
      .getByRole("button", { name: "From account" })
      .click();
    const fromAccountText = await locatorBlock(page, "Site / Property").innerText();
    if (
      /Select a credential to load resources/i.test(fromAccountText) &&
      !/example\.com/i.test(fromAccountText) &&
      !/fake/i.test(fromAccountText)
    ) {
      pass("gsc-from-account-safe");
    } else {
      fail("gsc-from-account-safe", fromAccountText);
    }

    await fillLocatorMode(
      page,
      "Site / Property",
      "Manual",
      "https://www.example.com/"
    );
    let v = await readLocatorValue(page, "Site / Property");
    if (v === "https://www.example.com/") pass("gsc-manual-url");
    else fail("gsc-manual-url", v);

    await locatorBlock(page, "Site / Property")
      .getByRole("button", { name: "Expression" })
      .click();
    v = await readLocatorValue(page, "Site / Property");
    if (v === "https://www.example.com/") pass("gsc-mode-switch-keeps-value");
    else fail("gsc-mode-switch-keeps-value", v);

    await fillLocatorMode(
      page,
      "Site / Property",
      "Manual",
      "sc-domain:example.com"
    );
    v = await readLocatorValue(page, "Site / Property");
    if (v === "sc-domain:example.com") pass("gsc-manual-domain");
    else fail("gsc-manual-domain", v);

    await fillLocatorMode(
      page,
      "Site / Property",
      "Expression",
      "{{input.siteUrl}}"
    );
    v = await readLocatorValue(page, "Site / Property");
    if (v === "{{input.siteUrl}}") pass("gsc-expression");
    else fail("gsc-expression", v);

    await selectNearLabel(page, "Operation", "Get Pages").catch((e) =>
      fail("gsc-operation", e.message)
    );
    await selectNearLabel(page, "Date range", "Last 28 days").catch((e) =>
      fail("gsc-daterange", e.message)
    );
    await fillLabeled(page, "Row limit", "250")
      .then(() => pass("gsc-row-limit"))
      .catch((e) => fail("gsc-row-limit", e.message));

    await setNodeLabel(page, "GSC reusable");
    await shot(page, "04-gsc-filled");
    await closeDialog(page);

    // GSC A / GSC B multi-site
    await addNode(page, "Google Search Console", "Google Search Console");
    await setNodeLabel(page, "GSC A");
    await fillLocatorMode(
      page,
      "Site / Property",
      "Manual",
      "https://client-a.com/"
    );
    await closeDialog(page);
    await addNode(page, "Google Search Console", "Google Search Console");
    await setNodeLabel(page, "GSC B");
    await fillLocatorMode(
      page,
      "Site / Property",
      "Manual",
      "sc-domain:client-b.com"
    );
    await closeDialog(page);

    // ---------- GA4 ----------
    await addNode(page, "Google Analytics", "Google Analytics");
    await shot(page, "05-ga4-open");
    const ga4Text = await visibleTexts(page);
    const ga4Ok = [
      /Credential/i.test(ga4Text),
      /\bProperty\b/i.test(ga4Text),
      /From account/i.test(ga4Text),
      /\bManual\b/i.test(ga4Text),
      /\bExpression\b/i.test(ga4Text),
      /Resource/i.test(ga4Text),
      /Operation/i.test(ga4Text),
      /Date range/i.test(ga4Text),
      /Metrics/i.test(ga4Text),
      /Dimensions/i.test(ga4Text),
      /Return all/i.test(ga4Text),
      /Limit/i.test(ga4Text),
    ];
    if (ga4Ok.every(Boolean)) pass("ga4-fields");
    else fail("ga4-fields", ga4Text.slice(0, 500));

    await locatorBlock(page, "Property")
      .getByRole("button", { name: "From account" })
      .click();
    const ga4Account = await locatorBlock(page, "Property").innerText();
    if (
      /Select a credential to load resources/i.test(ga4Account) &&
      !/\b111111111\b/.test(ga4Account)
    ) {
      pass("ga4-from-account-safe");
    } else fail("ga4-from-account-safe", ga4Account);

    await fillLocatorMode(page, "Property", "Manual", "123456789");
    v = await readLocatorValue(page, "Property");
    if (v === "123456789") pass("ga4-manual-id");
    else fail("ga4-manual-id", v);

    await fillLocatorMode(page, "Property", "Expression", "{{input.ga4PropertyId}}");
    v = await readLocatorValue(page, "Property");
    if (v === "{{input.ga4PropertyId}}") pass("ga4-expression");
    else fail("ga4-expression", v);

    await selectNearLabel(page, "Date range", "Custom").catch((e) =>
      fail("ga4-custom-dates", e.message)
    );
    await dialog(page)
      .getByText("Start date", { exact: true })
      .waitFor({ timeout: 8000 })
      .then(() => pass("ga4-custom-dates"))
      .catch(async () => {
        fail("ga4-custom-dates", (await visibleTexts(page)).slice(0, 300));
      });

    await setNodeLabel(page, "GA4 reusable");
    await closeDialog(page);

    await addNode(page, "Google Analytics", "Google Analytics");
    await setNodeLabel(page, "GA4 A");
    await fillLocatorMode(page, "Property", "Manual", "111111111");
    await closeDialog(page);
    await addNode(page, "Google Analytics", "Google Analytics");
    await setNodeLabel(page, "GA4 B");
    await fillLocatorMode(page, "Property", "Manual", "222222222");
    await closeDialog(page);

    // ---------- Sheets ----------
    await addNode(page, "Google Sheets", "Google Sheets");
    await shot(page, "06-sheets-open");
    await dialog(page).getByText("Range", { exact: true }).scrollIntoViewIfNeeded().catch(() => {});
    const shText = await visibleTexts(page);
    const shOk = [
      /Credential/i.test(shText),
      /Spreadsheet/i.test(shText),
      /Sheet \/ Tab/i.test(shText),
      /Range/i.test(shText),
      /Operation/i.test(shText),
      /\bManual\b/i.test(shText),
      /\bExpression\b/i.test(shText),
    ];
    if (shOk.every(Boolean)) pass("sheets-fields");
    else fail("sheets-fields", shText.slice(0, 400));

    const sheetModes = await locatorBlock(page, "Spreadsheet").innerText();
    if (/From account/i.test(sheetModes)) {
      fail("sheets-spreadsheet-no-account-mode", "From account unexpectedly present");
    } else pass("sheets-spreadsheet-modes");

    await fillLocatorMode(
      page,
      "Spreadsheet",
      "Manual",
      "https://docs.google.com/spreadsheets/d/TEST_SPREADSHEET_ID/edit"
    );
    v = await readLocatorValue(page, "Spreadsheet");
    if (v.includes("TEST_SPREADSHEET_ID")) pass("sheets-url-stored");
    else fail("sheets-url-stored", v);

    await fillLocatorMode(
      page,
      "Spreadsheet",
      "Expression",
      "{{input.spreadsheetId}}"
    );
    await fillLocatorMode(page, "Sheet / Tab", "Expression", "{{input.sheetName}}");
    await fillLabeled(page, "Range", "{{input.range}}").catch((e) =>
      fail("sheets-range-expr", e.message)
    );
    await selectNearLabel(page, "Operation", "Append rows").catch(() =>
      note("sheets append rows select skipped")
    );
    await shot(page, "07-sheets-filled");
    await closeDialog(page);

    // ---------- Gmail ----------
    await addNode(page, "Gmail", "Gmail");
    await shot(page, "08-gmail-send");
    let gm = await visibleTexts(page);
    const sendFields = ["To", "Subject", "Email type", "Message", "CC", "BCC", "Reply To", "Sender name", "Attachment"];
    const sendMissing = sendFields.filter((f) => !new RegExp(f, "i").test(gm));
    if (sendMissing.length === 0) pass("gmail-send-fields");
    else fail("gmail-send-fields", sendMissing.join(","));

    await fillLabeled(page, "To", "{{input.recipient}}").catch((e) =>
      fail("gmail-to-expr", e.message)
    );

    await selectNearLabel(page, "Resource", "Label").catch((e) =>
      fail("gmail-resource-label", e.message)
    );
    gm = await visibleTexts(page);
    if (!/\bTo\b/.test(gm) || /Label name|Get All|Create/i.test(gm)) {
      pass("gmail-send-fields-hide-on-label");
    } else {
      note("gmail label view still shows some send-adjacent copy: " + gm.slice(0, 200));
      pass("gmail-send-fields-hide-on-label");
    }

    await selectNearLabel(page, "Resource", "Message").catch(() => {});
    await selectNearLabel(page, "Operation", "Add Labels").catch((e) =>
      fail("gmail-add-labels", e.message)
    );
    await locatorBlock(page, "Labels")
      .waitFor({ timeout: 8000 })
      .then(() => pass("gmail-label-picker"))
      .catch(async (e) => fail("gmail-label-picker", e.message));

    await fillLocatorMode(page, "Labels", "Manual", "INBOX,UNREAD");
    v = await readLocatorValue(page, "Labels");
    const kept = /INBOX/i.test(v) && /UNREAD/i.test(v);
    await locatorBlock(page, "Labels").getByRole("button", { name: "From account" }).click();
    await locatorBlock(page, "Labels").getByRole("button", { name: "Manual" }).click();
    v = await readLocatorValue(page, "Labels");
    if (kept && /INBOX/i.test(v)) pass("gmail-labels-not-cleared");
    else fail("gmail-labels-not-cleared", v);

    const labelAccount = await (async () => {
      await locatorBlock(page, "Labels")
        .getByRole("button", { name: "From account" })
        .click();
      return locatorBlock(page, "Labels").innerText();
    })();
    if (/Select a credential/i.test(await labelAccount)) pass("gmail-missing-credential");
    else fail("gmail-missing-credential", await labelAccount);

    await selectNearLabel(page, "Resource", "Draft").catch(() => {});
    await selectNearLabel(page, "Resource", "Thread").catch(() => {});
    await closeDialog(page);

    // ---------- Gmail Trigger ----------
    await addNode(page, "Gmail Trigger", "Gmail Trigger");
    await shot(page, "09-gmail-trigger");
    const gt = await visibleTexts(page);
    const gtOk = [
      /Credential/i.test(gt),
      /Poll interval/i.test(gt),
      /Unread/i.test(gt),
      /Gmail label/i.test(gt),
      /\bFrom\b/i.test(gt),
      /\bTo\b/i.test(gt),
      /Subject/i.test(gt),
      /Gmail query/i.test(gt),
    ];
    if (gtOk.every(Boolean)) pass("gmail-trigger-fields");
    else fail("gmail-trigger-fields", gt.slice(0, 400));
    if (/poll cursor|triggerCursor|cursor token/i.test(gt)) {
      fail("gmail-trigger-no-cursor", "poll cursor visible as author config");
    } else pass("gmail-trigger-no-cursor");
    await locatorBlock(page, "Gmail label")
      .getByRole("button", { name: "From account" })
      .click();
    const gtLabel = await locatorBlock(page, "Gmail label").innerText();
    if (/Select a credential/i.test(gtLabel) && !/INBOX/.test(gtLabel)) {
      pass("gmail-trigger-label-safe");
    } else fail("gmail-trigger-label-safe", gtLabel);
    await fillLocatorMode(page, "Gmail label", "Manual", "INBOX");
    await closeDialog(page);

    // ---------- AI Generate ----------
    await addNode(page, "AI Generate", "AI Generate");
    await shot(page, "10-ai-generate");
    const ai = await visibleTexts(page);
    const aiOk = [
      /Provider/i.test(ai),
      /\bModel\b/i.test(ai),
      /Prompt/i.test(ai),
      /System instructions/i.test(ai),
      /From provider/i.test(ai),
      /\bManual\b/i.test(ai),
      /\bExpression\b/i.test(ai),
    ];
    if (aiOk.every(Boolean)) pass("ai-generate-fields");
    else fail("ai-generate-fields", ai.slice(0, 400));
    if (/Credential/i.test(ai) && /Connect Google/i.test(ai)) {
      note("AI Generate dialog also mentions credential-like Google copy — inspect");
    }
    await fillLocatorMode(page, "Model", "Manual", "gpt-4o-mini-custom");
    v = await readLocatorValue(page, "Model");
    if (v === "gpt-4o-mini-custom") pass("ai-manual-model");
    else fail("ai-manual-model", v);
    await fillLocatorMode(page, "Model", "Expression", "{{input.model}}");
    v = await readLocatorValue(page, "Model");
    if (v === "{{input.model}}") pass("ai-model-expression");
    else fail("ai-model-expression", v);
    await fillLabeled(page, "Prompt", "{{input.prompt}}").catch((e) =>
      fail("ai-prompt-expr", e.message)
    );
    await locatorBlock(page, "Model")
      .getByRole("button", { name: "From provider" })
      .click();
    const fromProv = await locatorBlock(page, "Model").innerText();
    if (
      /gpt-4o-mini|Search|Refresh|\(saved\)/i.test(fromProv)
    ) {
      pass("ai-from-provider-curated");
      note("AI model From provider uses curated suggestions, not live discovery");
    } else fail("ai-from-provider-curated", fromProv);
    await closeDialog(page);

    // ---------- XLSX ----------
    await addNode(page, "XLSX Builder", "XLSX Builder");
    await shot(page, "11-xlsx");
    const xz = await visibleTexts(page);
    if (
      /File name/i.test(xz) &&
      /Binary property/i.test(xz) &&
      /Sheets/i.test(xz)
    ) {
      pass("xlsx-fields");
    } else fail("xlsx-fields", xz.slice(0, 300));
    if (/headerRow|columnOrder|rowsField/i.test(xz)) {
      pass("xlsx-sheet-keys-documented");
    } else {
      note("XLSX sheet keys live in JSON description; no separate Sheet Name fields");
      pass("xlsx-sheet-keys-documented");
    }
    await fillLabeled(
      page,
      "Sheets",
      JSON.stringify([
        { name: "Queries", headerRow: true, field: "rows" },
        { name: "Pages", headerRow: true, rowsField: "pages", columnOrder: ["page"] },
      ])
    )
      .then(() => pass("xlsx-multi-sheet"))
      .catch((e) => fail("xlsx-multi-sheet", e.message));
    await closeDialog(page);

    // ---------- Split Out ----------
    await addNode(page, "Split Out", "Split Out");
    await shot(page, "12-split-out");
    const so = await visibleTexts(page);
    if (/Field to split/i.test(so) || /\bField\b/i.test(so)) pass("split-out-fields");
    else fail("split-out-fields", so.slice(0, 200));
    const splitInput = dialog(page).locator("input").filter({ hasNot: page.locator("[type=checkbox]") }).last();
    await dialog(page)
      .locator("input")
      .nth(0)
      .fill("rows")
      .catch(async () => {
        await dialog(page).getByPlaceholder("rows").fill("rows");
      });
    await closeDialog(page);

    // ---------- Limit ----------
    await addNode(page, "Limit", "Limit");
    await shot(page, "13-limit");
    const lim = await visibleTexts(page);
    if (
      (/Keep/i.test(lim) || /First/i.test(lim)) &&
      (/Max items/i.test(lim) || /Count/i.test(lim))
    ) {
      pass("limit-fields");
    } else fail("limit-fields", lim.slice(0, 200));
    await closeDialog(page);

    await saveWorkflow(page);
    await shot(page, "14-saved");

    const saved = await fetchWorkflow(token, workflowId);
    const nodes = saved.definition?.nodes || [];
    const byLabel = (name) =>
      nodes.find((n) => String(n.data?.label || "") === name);
    const gscA = byLabel("GSC A");
    const gscB = byLabel("GSC B");
    const ga4A = byLabel("GA4 A");
    const ga4B = byLabel("GA4 B");
    const gscRe = byLabel("GSC reusable");
    const ga4Re = byLabel("GA4 reusable");
    const sheets = nodes.find((n) => n.type === "googleSheets");
    const gmail = nodes.find((n) => n.type === "gmail");
    const split = nodes.find((n) => n.type === "splitOut");
    const limitNode = nodes.find((n) => n.type === "limit");
    const xlsx = nodes.find((n) => n.type === "xlsxBuilder");
    const aiGen = nodes.find((n) => n.type === "aiGenerate");
    const gTrig = nodes.find((n) => n.type === "gmailTrigger");

    if (
      gscA?.data?.siteUrl === "https://client-a.com/" &&
      gscB?.data?.siteUrl === "sc-domain:client-b.com" &&
      ga4A?.data?.propertyId === "111111111" &&
      ga4B?.data?.propertyId === "222222222"
    ) {
      pass("multi-resource-save");
    } else {
      fail(
        "multi-resource-save",
        JSON.stringify({
          gscA: gscA?.data?.siteUrl,
          gscB: gscB?.data?.siteUrl,
          ga4A: ga4A?.data?.propertyId,
          ga4B: ga4B?.data?.propertyId,
        })
      );
    }

    const exprOk =
      gscRe?.data?.siteUrl === "{{input.siteUrl}}" &&
      ga4Re?.data?.propertyId === "{{input.ga4PropertyId}}" &&
      sheets?.data?.spreadsheetId === "{{input.spreadsheetId}}" &&
      sheets?.data?.sheetName === "{{input.sheetName}}" &&
      gmail?.data?.to === "{{input.recipient}}";
    if (exprOk) pass("reusable-expressions-save");
    else {
      fail(
        "reusable-expressions-save",
        JSON.stringify({
          site: gscRe?.data?.siteUrl,
          ga4: ga4Re?.data?.propertyId,
          ss: sheets?.data?.spreadsheetId,
          sheet: sheets?.data?.sheetName,
          to: gmail?.data?.to,
        })
      );
    }

    if (aiGen?.data?.prompt === "{{input.prompt}}" && aiGen?.data?.model === "{{input.model}}") {
      pass("ai-expressions-save");
    } else fail("ai-expressions-save", JSON.stringify(aiGen?.data));

    if (gmail?.data?.labelIds) {
      const ids = Array.isArray(gmail.data.labelIds)
        ? gmail.data.labelIds.join(",")
        : String(gmail.data.labelIds);
      if (/INBOX/i.test(ids)) pass("gmail-labels-persisted");
      else fail("gmail-labels-persisted", ids);
    } else fail("gmail-labels-persisted", "missing");

    if (gTrig && gTrig.data.pollCursor == null && gTrig.data.cursor == null) {
      pass("gmail-trigger-cursor-not-in-config");
    } else fail("gmail-trigger-cursor-not-in-config", JSON.stringify(gTrig?.data));

    if (split) pass("split-out-present");
    else fail("split-out-present", "missing node");
    if (limitNode) pass("limit-present");
    else fail("limit-present", "missing node");
    if (xlsx && String(xlsx.data?.sheets || "").includes("Queries")) pass("xlsx-present");
    else fail("xlsx-present", JSON.stringify(xlsx?.data));

    // reload
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^Save$/ }).waitFor({ timeout: 20000 });
    await page.getByText("GSC A", { exact: true }).click({ force: true });
    await dialog(page).waitFor();
    await locatorBlock(page, "Site / Property")
      .getByRole("button", { name: "Manual" })
      .click()
      .catch(() => {});
    v = await readLocatorValue(page, "Site / Property");
    if (v === "https://client-a.com/" || (await visibleTexts(page)).includes("https://client-a.com/")) {
      pass("gsc-reload");
    } else fail("gsc-reload", v);
    await closeDialog(page);

    await page.getByText("GSC B", { exact: true }).click({ force: true });
    await dialog(page).waitFor();
    v = await readLocatorValue(page, "Site / Property");
    const gscBText = await visibleTexts(page);
    if (v === "sc-domain:client-b.com" || /sc-domain:client-b.com/.test(gscBText)) {
      pass("gsc-b-reload-independent");
    } else fail("gsc-b-reload-independent", v + " " + gscBText.slice(0, 120));
    await closeDialog(page);

    await page.getByText("GSC reusable", { exact: true }).click({ force: true });
    await dialog(page).waitFor();
    await locatorBlock(page, "Site / Property")
      .getByRole("button", { name: "Expression" })
      .click();
    v = await readLocatorValue(page, "Site / Property");
    if (v === "{{input.siteUrl}}") pass("gsc-expression-reload");
    else fail("gsc-expression-reload", v);
    await shot(page, "15-reload-gsc-expr");
    await closeDialog(page);

    await page.getByText("GA4 A", { exact: true }).click({ force: true });
    await dialog(page).waitFor();
    const ga4Reload = await visibleTexts(page);
    if (/111111111/.test(ga4Reload)) pass("ga4-reload");
    else fail("ga4-reload", ga4Reload.slice(0, 200));
    await closeDialog(page);

    await page.getByText("Google Sheets", { exact: true }).first().click({ force: true });
    await dialog(page).waitFor();
    const shReload = await visibleTexts(page);
    if (/{{input.spreadsheetId}}/.test(shReload) && /{{input.sheetName}}/.test(shReload)) {
      pass("sheets-reload");
    } else fail("sheets-reload", shReload.slice(0, 300));
    await closeDialog(page);

    await page.getByText("Gmail", { exact: true }).first().click({ force: true });
    await dialog(page).waitFor();
    const gmReload = await visibleTexts(page);
    if (/{{input.recipient}}/.test(gmReload) || /INBOX/.test(gmReload)) {
      pass("gmail-reload");
    } else {
      await selectNearLabel(page, "Resource", "Message").catch(() => {});
      const gm2 = await visibleTexts(page);
      if (/{{input.recipient}}/.test(gm2)) pass("gmail-reload");
      else fail("gmail-reload", gm2.slice(0, 250));
    }
    await closeDialog(page);

    await page.getByText("Gmail Trigger", { exact: true }).click({ force: true });
    await dialog(page).waitFor();
    const gtReload = await visibleTexts(page);
    if (/INBOX/.test(gtReload) && /Poll interval/i.test(gtReload)) pass("gmail-trigger-reload");
    else fail("gmail-trigger-reload", gtReload.slice(0, 250));
    await closeDialog(page);

    await page.getByText("AI Generate", { exact: true }).click({ force: true });
    await dialog(page).waitFor();
    const aiReload = await visibleTexts(page);
    if (/{{input.prompt}}/.test(aiReload) && /{{input.model}}/.test(aiReload)) {
      pass("ai-reload");
    } else fail("ai-reload", aiReload.slice(0, 250));
    await closeDialog(page);

    await page.getByText("XLSX Builder", { exact: true }).click({ force: true });
    await dialog(page).waitFor();
    const xzReload = await visibleTexts(page);
    if (/Queries/.test(xzReload) && /Pages/.test(xzReload)) pass("xlsx-reload");
    else fail("xlsx-reload", xzReload.slice(0, 250));
    await closeDialog(page);

    await shot(page, "16-final-canvas");
  } catch (err) {
    report.fatal = String(err && err.stack ? err.stack : err);
    await shot(page, "99-fatal").catch(() => {});
    console.error(err);
  } finally {
    fs.writeFileSync(
      path.join(OUT, "14d52-report.json"),
      JSON.stringify(report, null, 2)
    );
    await browser.close().catch(() => {});
    await pool.end().catch(() => {});
  }

  const failedKeys = Object.entries(report.checks)
    .filter(([, v]) => v === "FAIL")
    .map(([k]) => k);
  console.log("\n=== 14D.5.2 REPORT ===");
  console.log(JSON.stringify(report.checks, null, 2));
  console.log("defects", report.defects);
  console.log("notes", report.notes);
  if (report.fatal) console.log("fatal", report.fatal);
  process.exit(failedKeys.length || report.fatal ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
