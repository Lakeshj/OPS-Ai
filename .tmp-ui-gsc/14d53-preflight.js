/**
 * 14D.5.3 preflight — SET/UNSET only. No secret values printed.
 */
const path = require("path");
module.paths.unshift(path.join(__dirname, "../backend/node_modules"));

require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const config = require("../backend/config");
const { pool } = require("../backend/config/database");

const flag = (v) => (v && String(v).trim() ? "SET" : "UNSET");
const looksPlaceholder = (v) =>
  !v ||
  /your_|change-me|generate_|example|placeholder/i.test(String(v));

(async () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    config.googleOAuth?.redirectUri ||
    "http://localhost:5013/api/google-oauth/callback";
  const credKey = process.env.WORKFLOW_CREDENTIALS_KEY;
  const jwtFallback = Boolean(process.env.JWT_SECRET);

  console.log("=== PREFLIGHT (names + SET/UNSET only) ===");
  console.log("GOOGLE_OAUTH_CLIENT_ID", flag(clientId));
  console.log("GOOGLE_OAUTH_CLIENT_SECRET", flag(clientSecret));
  console.log(
    "GOOGLE_OAUTH_REDIRECT_URI",
    process.env.GOOGLE_OAUTH_REDIRECT_URI ? "SET" : "UNSET_USES_DEFAULT"
  );
  console.log("GOOGLE_OAUTH_REDIRECT_URI_EFFECTIVE", redirect);
  console.log(
    "REDIRECT_MATCHES_EXPECTED",
    redirect === "http://localhost:5013/api/google-oauth/callback" ? "YES" : "NO"
  );
  console.log("CORS_ORIGIN", flag(process.env.CORS_ORIGIN));
  console.log("WORKFLOW_CREDENTIALS_KEY", flag(credKey));
  console.log(
    "ENCRYPTION",
    flag(credKey) === "SET"
      ? "WORKFLOW_CREDENTIALS_KEY"
      : jwtFallback
        ? "JWT_FALLBACK"
        : "UNSET"
  );
  console.log("OPENAI_API_KEY", flag(process.env.OPENAI_API_KEY));
  console.log("DEEPSEEK_API_KEY", flag(process.env.DEEPSEEK_API_KEY));
  console.log("GEMINI_API_KEY", flag(process.env.GEMINI_API_KEY));
  console.log("BACKEND_PORT", config.port || 5013);
  console.log("FRONTEND_BASE", "http://localhost:3001");
  console.log("BACKEND_BASE", "http://localhost:5013");
  console.log("DB_NAME_EFFECTIVE", config.db.database);
  console.log(
    "OAUTH_CLIENT_LOOKS_PLACEHOLDER",
    looksPlaceholder(clientId) || looksPlaceholder(clientSecret) ? "YES" : "NO"
  );

  const [rows] = await pool.execute(
    `SELECT type, COUNT(*) AS n
       FROM workflow_credentials
      WHERE type IN ('google_gsc','google_ga4','google_gmail','google_sheets')
      GROUP BY type`
  );
  console.log("STORED_GOOGLE_CREDENTIALS");
  if (!rows.length) console.log("  none");
  for (const r of rows) console.log(" ", r.type, Number(r.n));

  const oauthReady =
    flag(clientId) === "SET" &&
    flag(clientSecret) === "SET" &&
    !(looksPlaceholder(clientId) || looksPlaceholder(clientSecret));
  console.log("OAUTH_OPERATOR_READY", oauthReady ? "YES" : "NO");
  await pool.end();
})().catch((err) => {
  console.error("PREFLIGHT_ERROR", err && err.code ? err.code : "failed");
  process.exit(1);
});
