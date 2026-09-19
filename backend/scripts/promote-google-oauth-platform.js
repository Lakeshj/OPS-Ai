/**
 * One-shot: copy CUSTOM_APP Client ID/Secret from an existing Google credential
 * into backend/.env as GOOGLE_OAUTH_* for PLATFORM_MANAGED (Gmail Sign in).
 * Does not print secrets.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { decryptSecret } = require("../services/secretBox.service");

const ENV_PATH = path.join(__dirname, "../.env");

const upsertEnv = (content, key, value) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*#?\\s*${key}=.*$`, "m");
  if (re.test(content)) {
    return content.replace(re, line);
  }
  const block = `\n# Platform-managed Google OAuth (Gmail Sign in with Google)\n${line}\n`;
  return `${content.trimEnd()}${block}`;
};

(async () => {
  const [rows] = await pool.query(
    `SELECT id, name, type, config_json, secret_json
     FROM workflow_credentials
     WHERE type IN ('google_gsc','google_ga4','google_sheets','google_gmail')
     ORDER BY updated_at DESC
     LIMIT 20`
  );

  let clientId = "";
  let clientSecret = "";
  let source = null;

  for (const r of rows) {
    let cfg = {};
    try {
      cfg =
        typeof r.config_json === "string"
          ? JSON.parse(r.config_json)
          : r.config_json || {};
    } catch {
      /* ignore */
    }
    let secret = {};
    try {
      secret = decryptSecret(r.secret_json) || {};
    } catch {
      /* ignore */
    }
    const id = String(cfg.clientId || secret.clientId || "").trim();
    const sec = String(secret.clientSecret || "").trim();
    if (id && sec) {
      clientId = id;
      clientSecret = sec;
      source = { id: r.id, type: r.type, name: r.name };
      break;
    }
  }

  if (!clientId || !clientSecret) {
    console.error("No CUSTOM_APP Google credential with Client ID/Secret found.");
    process.exit(1);
  }

  let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  env = upsertEnv(env, "GOOGLE_OAUTH_CLIENT_ID", clientId);
  env = upsertEnv(env, "GOOGLE_OAUTH_CLIENT_SECRET", clientSecret);
  env = upsertEnv(
    env,
    "GOOGLE_OAUTH_REDIRECT_URI",
    "http://localhost:5013/api/google-oauth/callback"
  );
  fs.writeFileSync(ENV_PATH, env.endsWith("\n") ? env : `${env}\n`, "utf8");

  // Verify without printing secrets
  delete require.cache[require.resolve("../config")];
  require("dotenv").config({ path: ENV_PATH, override: true });
  const configured = Boolean(
    String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim() &&
      String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim()
  );

  console.log(
    JSON.stringify({
      ok: configured,
      sourceType: source.type,
      sourceName: source.name,
      clientIdSuffix: clientId.slice(-28),
      redirectUri: "http://localhost:5013/api/google-oauth/callback",
      note: "Restart backend npm run dev, then hard-refresh the workflow page.",
      googleCloud:
        "In Google Cloud Console for this OAuth client: enable Gmail API and add redirect URI above.",
    })
  );

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
