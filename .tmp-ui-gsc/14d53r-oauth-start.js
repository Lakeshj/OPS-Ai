/**
 * Probe live OAuth start. Prints status/code only — never secrets.
 */
const path = require("path");
module.paths.unshift(path.join(__dirname, "../backend/node_modules"));
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const jwt = require("jsonwebtoken");
const { pool } = require("../backend/config/database");
const config = require("../backend/config");

(async () => {
  const [users] = await pool.execute(
    `SELECT id, role FROM users ORDER BY created_at DESC LIMIT 1`
  );
  const user = users[0];
  const [ws] = await pool.execute(
    `SELECT workspace_id FROM workspace_users WHERE user_id = ? LIMIT 1`,
    [user.id]
  );
  const token = jwt.sign(
    { userId: user.id, role: user.role, isDeveloper: false },
    config.jwt.secret,
    { algorithm: "HS256", expiresIn: "15m" }
  );
  const res = await fetch("http://localhost:5013/workflows/google-oauth/start", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: ws[0]?.workspace_id,
      product: "google_gsc",
    }),
  });
  const text = await res.text();
  let code = "";
  try {
    code = JSON.parse(text).code || JSON.parse(text).error || "";
  } catch {
    code = "";
  }
  const hasTokenish =
    /ya29\.|1\/\/[A-Za-z0-9_-]{8,}|access_token|refresh_token|sk-[A-Za-z0-9_-]{12,}/i.test(
      text
    );
  const notConfigured = /GOOGLE_OAUTH_NOT_CONFIGURED|not configured/i.test(text);
  console.log("WORKSPACE", ws[0]?.workspace_id ? "SET" : "UNSET");
  console.log("HTTP", res.status);
  console.log("CODE", code || "NONE");
  console.log("NOT_CONFIGURED", notConfigured ? "YES" : "NO");
  console.log("HAS_AUTH_URL", /accounts\.google\.com/.test(text) ? "YES" : "NO");
  console.log("SECRET_IN_BODY", hasTokenish ? "YES" : "NO");
  await pool.end();
})().catch((err) => {
  console.error("PROBE_FAILED", err && err.message ? "error" : "error");
  process.exit(1);
});
