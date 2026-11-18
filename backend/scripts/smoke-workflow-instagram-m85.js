/**
 * Instagram M8.5 — credential persistence failure classification + schema assert.
 * No live Meta calls; no secrets printed.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };
const TOKEN = "SUAT-m85-test-token";

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
  INSTAGRAM_APP_ID: "app-m85",
  INSTAGRAM_APP_SECRET: "secret-m85-do-not-leak",
  INSTAGRAM_OAUTH_REDIRECT_URI:
    "https://opsai.socialchamps.com/api/instagram-oauth/callback",
  INSTAGRAM_LOGIN_CONFIG_ID: "config-m85",
  META_APP_ID: null,
  META_APP_SECRET: null,
};

const okTransport = async (url) => {
  const u = String(url);
  if (u.includes("/oauth/access_token")) {
    return {
      ok: true,
      status: 200,
      body: {
        access_token: TOKEN,
        expires_in: 0,
        permissions:
          "instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights",
      },
    };
  }
  if (u.includes("assigned_instagram_accounts")) {
    return {
      ok: true,
      status: 200,
      body: { data: [{ id: "178414555", username: "persist_ig" }] },
    };
  }
  if (u.includes("/me?")) {
    return { ok: true, status: 200, body: { client_business_id: "biz-85" } };
  }
  if (u.includes("debug_token") || u.includes("me/accounts")) {
    return { ok: true, status: 200, body: { data: [] } };
  }
  if (u.includes("178414555")) {
    return {
      ok: true,
      status: 200,
      body: { id: "178414555", username: "persist_ig", account_type: "BUSINESS" },
    };
  }
  return { ok: false, status: 404, body: { error: { message: u } } };
};

async function main() {
  console.log("\nInstagram M8.5 credential persistence");

  const oauth = () => require("../services/instagramOAuth.service");

  await check("IG-M85-1 migration 030 asserts instagram ENUM", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../migrations/030_instagram_credential_type_assert.sql"),
      "utf8"
    );
    assert.match(sql, /'instagram'/);
    assert.match(sql, /'meta_ads'/);
    assert.match(sql, /'google_ads'/);
    assert.equal(sql.includes("DROP TABLE"), false);
  });

  await check("IG-M85-2 ENUM missing → INSTAGRAM_CREDENTIAL_SCHEMA", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const err = Object.assign(new Error("Data truncated for column 'type'"), {
        code: "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD",
        sqlState: "01000",
        errno: 1265,
      });
      const classified = oauth().classifyCredentialSaveError(err);
      assert.equal(classified.code, "INSTAGRAM_CREDENTIAL_SCHEMA");
      assert.match(
        oauth().sanitizeCallbackError(classified),
        /database schema/i
      );
    });
  });

  await check("IG-M85-3 FK missing → INSTAGRAM_CREDENTIAL_FK", () => {
    const err = Object.assign(
      new Error(
        "Cannot add or update a child row: a foreign key constraint fails (`opsai`.`workflow_credentials`, CONSTRAINT `fk_workflow_credentials_created_by`)"
      ),
      { code: "ER_NO_REFERENCED_ROW_2", sqlState: "23000", errno: 1452 }
    );
    const classified = oauth().classifyCredentialSaveError(err);
    assert.equal(classified.code, "INSTAGRAM_CREDENTIAL_FK");
    assert.equal(
      oauth().sanitizeCallbackError(classified),
      "Instagram credential could not be saved."
    );
  });

  await check("IG-M85-4 persist failure log is sanitized", () => {
    const logs = [];
    const err = Object.assign(
      new Error(
        "Duplicate entry 'ws-1-Instagram' for key 'uq_workflow_credentials_name'"
      ),
      { code: "ER_DUP_ENTRY", sqlState: "23000", errno: 1062 }
    );
    const prevErr = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      oauth().logCredentialPersistFailure(err, {
        operation: "insert",
        workspaceId: "ws-1",
        userId: "user-1",
        instagramUserId: "178414555",
      });
    } finally {
      console.error = prevErr;
    }
    const line = logs.join("\n");
    assert.match(line, /credential_persist_failed/);
    assert.match(line, /uq_workflow_credentials_name/);
    assert.equal(line.includes(TOKEN), false);
    assert.equal(line.includes("secret-m85"), false);
  });

  await check("IG-M85-5 successful mock persist still works", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      let saved = null;
      const result = await oauth().withInstagramOAuthTestHooks(
        {
          transport: okTransport,
          insertCredential: async (row) => {
            saved = row;
          },
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1", name: "Instagram" },
            ADMIN
          );
          return oauth().finishInstagramOAuth(
            "CODE",
            new URL(started.url).searchParams.get("state")
          );
        }
      );
      assert.ok(result.credentialId);
      assert.equal(saved.config.username, "persist_ig");
      assert.equal(saved.secret.tokenKind, "unified_system_user");
      assert.equal(saved.config.authMode, "unified_login");
    });
  });

  await check("IG-M85-6 insertCredential hook path does not require DB schema", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const ids = [];
      await oauth().withInstagramOAuthTestHooks(
        {
          transport: okTransport,
          insertCredential: async ({ id }) => ids.push(id),
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1" },
            ADMIN
          );
          await oauth().finishInstagramOAuth(
            "CODE",
            new URL(started.url).searchParams.get("state")
          );
        }
      );
      assert.equal(ids.length, 1);
    });
  });

  await check("IG-M85-7 Meta Ads / Google surfaces unchanged", () => {
    const meta = fs.readFileSync(
      path.join(__dirname, "../config/metaGraph.js"),
      "utf8"
    );
    assert.match(meta, /ads_read/);
    assert.equal(meta.includes("instagram_basic"), false);
    const ads = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    assert.match(ads, /Meta write calls are not available/);
  });

  console.log(`\nM8.5 results: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
