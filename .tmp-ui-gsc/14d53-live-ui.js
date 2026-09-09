/**
 * 14D.5.3 editor walk: Connect Google Account + AI Generate Run step.
 */
const path = require("path");
const fs = require("fs");

module.paths.unshift(path.join(__dirname, "node_modules"));
module.paths.unshift(path.join(__dirname, "../backend/node_modules"));

require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const jwt = require("jsonwebtoken");
const { chromium } = require("playwright");
const { pool } = require("../backend/config/database");
const config = require("../backend/config");

const BASE = process.env.UI_BASE || "http://localhost:3001";
const API = `${BASE}/api`;
const OUT = __dirname;
const report = { checks: {}, notes: [], shots: [] };

const shot = async (page, name) => {
  const file = path.join(OUT, `14d53-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.shots.push(name);
};

const mintToken = async () => {
  const [rows] = await pool.execute(
    `SELECT id, email, role FROM users ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows.length) throw new Error("No user to mint JWT");
  const user = rows[0];
  const [ws] = await pool.execute(
    `SELECT workspace_id FROM workspace_users WHERE user_id = ? LIMIT 1`,
    [user.id]
  );
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
  return {
    token,
    userId: user.id,
    role: user.role,
    workspaceId: ws[0]?.workspace_id || null,
  };
};

const dialog = (page) => page.getByRole("dialog").last();

const addNode = async (page, searchText, addName) => {
  const search = page.getByLabel("Search nodes");
  if (!(await search.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /^Nodes$/ }).click({ force: true });
    await search.waitFor({ timeout: 10000 });
  }
  await search.fill("");
  await search.fill(searchText);
  const add = page.getByRole("button", { name: `Add ${addName}`, exact: true });
  await add.first().waitFor({ timeout: 10000 });
  await add.first().click();
  await dialog(page).waitFor({ timeout: 15000 });
};

(async () => {
  const { token, role, workspaceId } = await mintToken();
  report.notes.push(`jwt_role=${role} workspace=${workspaceId ? "SET" : "UNSET"}`);

  const startRes = await fetch(`${API}/workflows/google-oauth/start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: workspaceId || "00000000-0000-0000-0000-000000000000",
      product: "google_gsc",
    }),
  });
  let startBody = "";
  try {
    startBody = await startRes.text();
  } catch {
    startBody = "";
  }
  const startSafe = startBody.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
  report.notes.push(`oauth_start_http=${startRes.status}`);
  if (
    startRes.status === 503 &&
    /GOOGLE_OAUTH_NOT_CONFIGURED|not configured/i.test(startSafe)
  ) {
    report.checks["LIVE-OAUTH-1-API"] = "BLOCKED_BY_CONFIG";
  } else if (startRes.status === 403 || startRes.status === 404) {
    report.checks["LIVE-OAUTH-1-API"] = "BLOCKED_BY_CONFIG";
    report.notes.push("oauth_start_denied_before_or_with_config_check");
  } else {
    report.checks["LIVE-OAUTH-1-API"] = `HTTP_${startRes.status}`;
  }

  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  page.setDefaultTimeout(25000);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message || err)));
  const consoleSecrets = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/ya29\.|1\/\/[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}/.test(t)) {
      consoleSecrets.push("secret_pattern");
    }
  });

  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => localStorage.setItem("token", t), token);
    await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Sign Out/i }).waitFor({
      timeout: 25000,
    });
    const wsLink = page.locator('main a[href*="/projects/"]').first();
    await wsLink.waitFor({ timeout: 15000 });
    await wsLink.click();
    await page.getByRole("button", { name: /^Workflow$/ }).click();
    await page.getByRole("button", { name: /New Workflow/i }).click();
    await page.waitForURL(/\/workflows\/[a-f0-9-]+/, { timeout: 25000 });
    report.workflowId = page.url().split("/workflows/")[1].split(/[?#]/)[0];
    await page.getByRole("button", { name: /^Save$/ }).waitFor({ timeout: 20000 });

    await addNode(page, "Google Search Console", "Google Search Console");
    await shot(page, "01-gsc");
    const connect = page.getByRole("button", {
      name: /Connect Google Account/i,
    });
    await connect.first().waitFor({ timeout: 10000 });
    const popupPromise = page
      .waitForEvent("popup", { timeout: 2500 })
      .then(() => "popup")
      .catch(() => "no-popup");
    await connect.first().click();
    const popupState = await popupPromise;
    await page.waitForTimeout(1200);
    const toastText = await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
    const bodyText = await page.locator("body").innerText();
    const blockedCopy =
      /not configured|Could not start Google sign-in|GOOGLE_OAUTH/i.test(
        [...toastText, bodyText].join("\n")
      );
    await shot(page, "02-connect");
    if (popupState === "no-popup" && blockedCopy) {
      report.checks["LIVE-OAUTH-1-UI"] = "BLOCKED_BY_CONFIG";
    } else if (popupState === "popup") {
      report.checks["LIVE-OAUTH-1-UI"] = "UNEXPECTED_POPUP";
    } else {
      report.checks["LIVE-OAUTH-1-UI"] = blockedCopy
        ? "BLOCKED_BY_CONFIG"
        : "UNCLEAR";
    }
    report.notes.push(`oauth_ui popup=${popupState} blockedCopy=${blockedCopy}`);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    await addNode(page, "AI Generate", "AI Generate");
    const prompt = dialog(page).locator("textarea").last();
    await prompt.waitFor({ timeout: 10000 });
    await prompt.fill("Return exactly the word READY.");
    await dialog(page).getByRole("button", { name: /^Run step$/ }).click();
    await page
      .getByText(/\bREADY\b/, { timeout: 45000 })
      .waitFor()
      .catch(() => {});
    await shot(page, "03-aigen");
    const after = await dialog(page).innerText();
    const hasReady = /\bREADY\b/.test(after);
    const leakUi =
      /sk-[A-Za-z0-9_-]{20,}/.test(after) ||
      /ya29\./.test(after) ||
      (process.env.OPENAI_API_KEY && after.includes(process.env.OPENAI_API_KEY));
    report.checks["LIVE-AIGEN-1-UI"] = hasReady && !leakUi ? "PASS" : "FAIL";
    report.notes.push(`aigen_ui ready=${hasReady} leak=${leakUi} consoleSecrets=${consoleSecrets.length} pageErrors=${pageErrors.length}`);
  } catch (err) {
    report.checks.fatal = String(err && err.message ? err.message : err);
    await shot(page, "99-fatal").catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    await pool.end().catch(() => {});
    fs.writeFileSync(
      path.join(OUT, "14d53-ui-report.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report, null, 2));
  }
})().catch((err) => {
  console.error("UI_LIVE_FAILED", err && err.message ? err.message : "error");
  process.exit(1);
});
