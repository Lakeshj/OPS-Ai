/**
 * Instagram M8.9 — Unified Login Account Get field contract + ENUM repair.
 * No live Meta calls; no secrets printed.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };
const IG_USER = "17841477700000001";
const TOKEN = "SUAT-m89-test-token";

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const withEnv = async (patch, fn) => {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const next = patch[key];
    if (next === undefined || next === null) process.env[key] = "";
    else process.env[key] = String(next);
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
};

const FULL = {
  INSTAGRAM_APP_ID: "app-m89",
  INSTAGRAM_APP_SECRET: "secret-m89-do-not-leak",
  INSTAGRAM_OAUTH_REDIRECT_URI:
    "https://opsai.socialchamps.com/api/instagram-oauth/callback",
  INSTAGRAM_LOGIN_CONFIG_ID: "config-m89",
  META_APP_ID: null,
  META_APP_SECRET: null,
};

const loadCred = async () => ({
  id: "cred-ig-m89",
  type: "instagram",
  name: "eliteeagle.dev",
  workspaceId: "ws-1",
  secret: {
    accessToken: TOKEN,
    tokenKind: "unified_system_user",
    authMode: "unified_login",
    instagramUserId: IG_USER,
    username: "eliteeagle.dev",
  },
  config: {
    connected: true,
    instagramUserId: IG_USER,
    username: "eliteeagle.dev",
    accountType: "Business",
  },
});

async function main() {
  console.log("\nInstagram M8.9 Account Get + ENUM repair");

  const node = () => require("../services/workflowInstagram.service");
  const auth = () => require("../services/workflowInstagramAuth.service");

  await check("IG-M89-1 PROFILE_FIELDS exclude user_id and account_type", () => {
    const n = node();
    assert.equal(n.PROFILE_FIELDS.includes("user_id"), false);
    assert.equal(n.PROFILE_FIELDS.includes("account_type"), false);
    assert.match(n.PROFILE_FIELDS, /^id,username,/);
    assert.match(n.PROFILE_FIELDS, /biography/);
    assert.match(n.PROFILE_FIELDS, /website/);
    assert.match(n.PROFILE_FIELDS, /ig_id/);
    assert.match(n.PROFILE_FIELDS_REQUIRED, /^id,username$/);
  });

  await check("IG-M89-2 Account Get path is /{instagramUserId}", async () => {
    await withEnv(FULL, async () => {
      let seen = "";
      const result = await node().withInstagramNodeTestHooks(
        {
          loadCredential: loadCred,
          transport: async (url) => {
            seen = String(url);
            assert.equal(seen.includes("user_id"), false);
            assert.equal(seen.includes("account_type"), false);
            return {
              ok: true,
              status: 200,
              body: {
                id: IG_USER,
                username: "eliteeagle.dev",
                name: "Elite Eagle",
                biography: "qa",
                website: "https://example.com",
                profile_picture_url: "https://cdn.example/p.jpg",
                followers_count: 42,
                follows_count: 7,
                media_count: 3,
                ig_id: "12345",
              },
            };
          },
        },
        () =>
          node().executeInstagramNode(
            {
              data: {
                credentialId: "cred-ig-m89",
                resource: "account",
                operation: "get_profile",
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.ok(seen.includes(`/${IG_USER}?`));
      assert.match(seen, /fields=id%2Cusername/);
      const json = result.items[0].json;
      assert.equal(json.id, IG_USER);
      assert.equal(json.instagramUserId, IG_USER);
      assert.equal(json.username, "eliteeagle.dev");
      assert.equal(json.name, "Elite Eagle");
      assert.equal(json.profilePictureUrl, "https://cdn.example/p.jpg");
      assert.equal(json.followersCount, 42);
      assert.equal(json.followsCount, 7);
      assert.equal(json.mediaCount, 3);
      assert.equal(json.accountType, "Business"); // from credential metadata
      assert.equal(json._meta.provider, "instagram");
      assert.equal(json._meta.instagramUserId, IG_USER);
    });
  });

  await check("IG-M89-3 Media List uses same IG User media edge", async () => {
    await withEnv(FULL, async () => {
      let seen = "";
      const result = await node().withInstagramNodeTestHooks(
        {
          loadCredential: loadCred,
          transport: async (url) => {
            seen = String(url);
            return {
              ok: true,
              status: 200,
              body: {
                data: [
                  {
                    id: "media-1",
                    caption: "hi",
                    media_type: "IMAGE",
                    permalink: "https://instagram.com/p/x",
                    timestamp: "2026-01-01T00:00:00+0000",
                    username: "eliteeagle.dev",
                  },
                ],
              },
            };
          },
        },
        () =>
          node().executeInstagramNode(
            {
              data: {
                credentialId: "cred-ig-m89",
                resource: "media",
                operation: "list_media",
                limit: 10,
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.ok(seen.includes(`/${IG_USER}/media?`));
      assert.equal(result.items[0].json.id, "media-1");
      assert.equal(result.output.instagramUserId, IG_USER);
    });
  });

  await check("IG-M89-4 (#100) invalid field maps sanitized", () => {
    const err = auth().mapInstagramError(400, {
      error: {
        message: "(#100) Tried accessing nonexisting field (user_id)",
        code: 100,
        type: "OAuthException",
      },
    });
    assert.equal(err.code, "INSTAGRAM_INVALID_GRAPH_FIELD");
    assert.match(err.message, /user_id/);
    assert.equal(String(err.message).includes(TOKEN), false);
    const sanitized = node().sanitizeInvalidFieldError(err, {
      resource: "account",
      operation: "get_profile",
    });
    assert.equal(sanitized.code, "INSTAGRAM_INVALID_GRAPH_FIELD");
    assert.match(sanitized.message, /account\/get_profile/);
    assert.match(sanitized.message, /user_id/);
  });

  await check("IG-M89-5 get_profile does not request user_id even on fallback", async () => {
    await withEnv(FULL, async () => {
      const urls = [];
      await assert.rejects(
        () =>
          node().withInstagramNodeTestHooks(
            {
              loadCredential: loadCred,
              transport: async (url) => {
                urls.push(String(url));
                return {
                  ok: false,
                  status: 400,
                  body: {
                    error: {
                      message:
                        "(#100) Tried accessing nonexisting field (biography)",
                      code: 100,
                    },
                  },
                };
              },
            },
            () =>
              node().getProfile({
                credentialId: "cred-ig-m89",
                workspaceId: "ws-1",
                instagramUserId: IG_USER,
              })
          ),
        (err) => err.code === "INSTAGRAM_INVALID_GRAPH_FIELD"
      );
      assert.ok(urls.length >= 1);
      assert.ok(urls.every((u) => !u.includes("user_id")));
      // Fallback should retry with required-only fields.
      assert.ok(urls.some((u) => u.includes("fields=id%2Cusername") || u.includes("fields=id,username")));
    });
  });

  await check("IG-M89-6 migration 031 repairs instagram ENUM", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../migrations/031_instagram_credential_type_repair.sql"),
      "utf8"
    );
    assert.match(sql, /'instagram'/);
    assert.match(sql, /'meta_ads'/);
    assert.match(sql, /'google_ads'/);
    assert.match(sql, /schema_migrations listed 028\/030/);
    assert.equal(sql.includes("DROP TABLE"), false);
  });

  await check("IG-M89-7 pre-instagram ENUM → 031 accepts type=instagram", async () => {
    let mysql;
    try {
      mysql = require("mysql2/promise");
    } catch {
      throw new Error("mysql2 required for ENUM smoke");
    }
    require("dotenv").config({
      path: path.join(__dirname, "../.env"),
    });
    const cfg = {
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      multipleStatements: true,
    };
    const dbName = "opsai_ig_m89_enum_smoke";
    const admin = await mysql.createConnection(cfg);
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await admin.query(
        `CREATE DATABASE \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
      );
    } finally {
      await admin.end();
    }

    const conn = await mysql.createConnection({ ...cfg, database: dbName });
    try {
      // Simulate drifted live: ENUM ends at meta_ads; 028/030 already "applied".
      await conn.query(`
        CREATE TABLE workflow_credentials (
          id VARCHAR(36) PRIMARY KEY,
          workspace_id VARCHAR(36) NOT NULL,
          name VARCHAR(255) NOT NULL,
          type ENUM(
            'bearer',
            'api_key_header',
            'basic',
            'query_param',
            'google_gsc',
            'google_ga4',
            'google_gmail',
            'google_sheets',
            'oauth2',
            'google_ads',
            'meta_ads'
          ) NOT NULL,
          secret_json TEXT NOT NULL,
          config_json TEXT NULL,
          created_by VARCHAR(36) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE schema_migrations (
          name VARCHAR(255) NOT NULL PRIMARY KEY,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO schema_migrations (name) VALUES
          ('028_instagram_credential.sql'),
          ('030_instagram_credential_type_assert.sql');
      `);

      const [before] = await conn.query(
        "SHOW COLUMNS FROM workflow_credentials LIKE 'type'"
      );
      assert.equal(String(before[0].Type).includes("instagram"), false);

      const repair = fs.readFileSync(
        path.join(
          __dirname,
          "../migrations/031_instagram_credential_type_repair.sql"
        ),
        "utf8"
      );
      await conn.query(repair);
      await conn.execute(
        "INSERT INTO schema_migrations (name) VALUES (?)",
        ["031_instagram_credential_type_repair.sql"]
      );

      const [after] = await conn.query(
        "SHOW COLUMNS FROM workflow_credentials LIKE 'type'"
      );
      assert.match(String(after[0].Type), /instagram/);

      await conn.execute(
        `INSERT INTO workflow_credentials
          (id, workspace_id, name, type, secret_json, config_json)
         VALUES (?, ?, ?, 'instagram', ?, ?)`,
        [
          "cred-ig",
          "ws-1",
          "eliteeagle.dev",
          JSON.stringify({ accessToken: "[redacted]" }),
          JSON.stringify({ username: "eliteeagle.dev" }),
        ]
      );
      const [rows] = await conn.query(
        "SELECT type FROM workflow_credentials WHERE id = ?",
        ["cred-ig"]
      );
      assert.equal(rows[0].type, "instagram");
    } finally {
      await conn.end();
      const cleanup = await mysql.createConnection(cfg);
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      } finally {
        await cleanup.end();
      }
    }
  });

  await check("IG-M89-8 Meta Ads + no secret leakage", () => {
    const meta = fs.readFileSync(
      path.join(__dirname, "../config/metaGraph.js"),
      "utf8"
    );
    assert.match(meta, /ads_read/);
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagram.service.js"),
      "utf8"
    );
    assert.equal(src.includes("console.log(accessToken"), false);
    assert.equal(/PROFILE_FIELDS[^=]*=[^;]*user_id/.test(src), false);
    assert.match(src, /PROFILE_FIELDS_REQUIRED = "id,username"/);
    assert.equal(src.includes("eliteeagle.dev"), false);
  });

  await check("IG-M89-9 legacy ME_FIELDS no longer request user_id", () => {
    assert.equal(auth().ME_FIELDS.includes("user_id"), false);
    assert.equal(auth().ME_FIELDS.includes("account_type"), false);
  });

  console.log(`\nM8.9 results: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
