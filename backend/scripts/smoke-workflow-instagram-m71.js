/**
 * Instagram M7.1 — connection UX + node presentation hardening.
 * No live Instagram / Meta calls.
 */
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };

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

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "../..", rel), "utf8");

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

const UNIFIED_ENV = {
  INSTAGRAM_APP_ID: "111",
  INSTAGRAM_APP_SECRET: "sec",
  INSTAGRAM_OAUTH_REDIRECT_URI:
    "https://opsai.socialchamps.com/api/instagram-oauth/callback",
  INSTAGRAM_LOGIN_CONFIG_ID: "login-config-m71",
  META_APP_ID: null,
  META_APP_SECRET: null,
};

const transportFor = (accounts) => {
  let step = 0;
  return async (url) => {
    const u = String(url);
    if (u.includes("graph.facebook.com") && u.includes("/oauth/access_token")) {
      const idx = Math.min(step, accounts.length - 1);
      return {
        ok: true,
        status: 200,
        body: {
          access_token: `suat-${idx}-${accounts[idx].username}`,
          expires_in: 5184000,
          permissions: "instagram_basic",
        },
      };
    }
    if (u.includes("debug_token")) {
      return {
        ok: true,
        status: 200,
        body: {
          data: {
            app_id: String(process.env.INSTAGRAM_APP_ID || "ig-app"),
            is_valid: true,
            scopes: [
              "instagram_basic",
              "pages_read_engagement",
              "instagram_content_publish",
              "instagram_manage_comments",
              "instagram_manage_insights",
            ],
            granular_scopes: [],
          },
        },
      };
    }
    if (u.includes("assigned_instagram_accounts")) {
      const idx = Math.min(step, accounts.length - 1);
      const account = accounts[idx];
      return {
        ok: true,
        status: 200,
        body: {
          data: [{ id: account.id, username: account.username }],
        },
      };
    }
    if (
      u.includes("owned_instagram_assets") ||
      u.includes("client_instagram_assets") ||
      u.includes("instagram_business_accounts") ||
      u.includes("me/accounts") ||
      u.includes("me/businesses")
    ) {
      return { ok: true, status: 200, body: { data: [] } };
    }
    if (u.includes("/me?")) {
      return { ok: true, status: 200, body: { client_business_id: "biz-m71" } };
    }
    if (/graph\.facebook\.com\/v[\d.]+\/\d+/.test(u)) {
      const idx = Math.min(step, accounts.length - 1);
      const account = accounts[idx];
      step += 1;
      return {
        ok: true,
        status: 200,
        body: {
          id: account.id,
          username: account.username,
          name: account.name,
          account_type: account.accountType || "BUSINESS",
        },
      };
    }
    return { ok: false, status: 404, body: { error: { message: u } } };
  };
};

async function main() {
  console.log("\nInstagram M7.1 connection UX + presentation");

  const graph = () => require("../config/instagramGraph");
  const oauth = () => require("../services/instagramOAuth.service");

  await check("IG-UX-1 platform config detects missing App ID", async () => {
    await withEnv(
      {
        INSTAGRAM_APP_ID: "",
        INSTAGRAM_APP_SECRET: "secret-value-do-not-leak",
        INSTAGRAM_OAUTH_REDIRECT_URI:
          "https://opsai.socialchamps.com/api/instagram-oauth/callback",
        INSTAGRAM_LOGIN_CONFIG_ID: "cfg",
        META_APP_ID: "",
        META_APP_SECRET: "",
      },
      () => {
        const status = graph().getInstagramIntegrationStatus();
        assert.equal(status.instagramIntegrationConfigured, false);
        assert.ok(status.missingConfigKeys.includes("INSTAGRAM_APP_ID"));
      }
    );
  });

  await check("IG-UX-2 platform config detects missing App Secret", async () => {
    await withEnv(
      {
        INSTAGRAM_APP_ID: "123456789012345",
        INSTAGRAM_APP_SECRET: null,
        INSTAGRAM_OAUTH_REDIRECT_URI:
          "https://opsai.socialchamps.com/api/instagram-oauth/callback",
        INSTAGRAM_LOGIN_CONFIG_ID: "cfg",
        META_APP_ID: null,
        META_APP_SECRET: null,
      },
      () => {
        const status = graph().getInstagramIntegrationStatus();
        assert.equal(status.instagramIntegrationConfigured, false);
        assert.ok(status.missingConfigKeys.includes("INSTAGRAM_APP_SECRET"));
      }
    );
  });

  await check("IG-UX-3 config diagnostics expose names only, never values", async () => {
    const secret = "super-secret-instagram-app-secret-xyz";
    await withEnv(
      {
        INSTAGRAM_APP_ID: null,
        INSTAGRAM_APP_SECRET: secret,
        INSTAGRAM_OAUTH_REDIRECT_URI: null,
        INSTAGRAM_LOGIN_CONFIG_ID: null,
        META_APP_ID: null,
        META_APP_SECRET: null,
      },
      () => {
        const status = graph().getInstagramIntegrationStatus();
        const blob = JSON.stringify(status);
        assert.equal(blob.includes(secret), false);
        assert.equal(blob.includes("super-secret"), false);
        for (const key of status.missingConfigKeys) {
          assert.match(key, /^[A-Z0-9_]+$/);
        }
      }
    );
  });

  await check("IG-UX-4 Connect Instagram available when platform configured", async () => {
    await withEnv(
      {
        INSTAGRAM_APP_ID: "111222333444555",
        INSTAGRAM_APP_SECRET: "configured-secret",
        INSTAGRAM_OAUTH_REDIRECT_URI:
          "https://opsai.socialchamps.com/api/instagram-oauth/callback",
        INSTAGRAM_LOGIN_CONFIG_ID: "login-config-live",
        META_APP_ID: null,
        META_APP_SECRET: null,
      },
      async () => {
        const status = graph().getInstagramIntegrationStatus();
        assert.equal(status.instagramIntegrationConfigured, true);
        assert.equal(status.unifiedLoginConfigured, true);
        assert.deepEqual(status.missingConfigKeys, []);
        oauth().resetInstagramOAuthNonceStore();
        const started = await oauth().startInstagramOAuth(
          { workspaceId: "ws-1", name: "Pride World City" },
          ADMIN
        );
        assert.ok(String(started.url).includes("facebook.com/dialog/oauth"));
        assert.ok(String(started.url).includes("client_id=111222333444555"));
        assert.ok(String(started.url).includes("config_id=login-config-live"));
        assert.equal(String(started.url).includes("scope="), false);
      }
    );
  });

  await check("IG-UX-5 Connect disabled/safe error when platform not configured", async () => {
    await withEnv(
      {
        INSTAGRAM_APP_ID: null,
        INSTAGRAM_APP_SECRET: null,
        INSTAGRAM_OAUTH_REDIRECT_URI: null,
        INSTAGRAM_LOGIN_CONFIG_ID: null,
        META_APP_ID: null,
        META_APP_SECRET: null,
      },
      async () => {
        await assert.rejects(
          () =>
            oauth().startInstagramOAuth(
              { workspaceId: "ws-1", name: "IG" },
              ADMIN
            ),
          (err) => {
            assert.equal(err.code, "INSTAGRAM_APP_NOT_CONFIGURED");
            assert.match(
              err.message,
              /Instagram integration is not configured on this OpsAi server/
            );
            assert.equal(/App Secret|access token/i.test(err.message), false);
            return true;
          }
        );
      }
    );
  });

  await check("IG-UX-6 multiple Instagram credentials can coexist", async () => {
    const accounts = [
      { id: "17841400000000001", username: "prideworldcity", name: "Pride World City" },
      { id: "17841400000000002", username: "ksbindia", name: "KSB India" },
      { id: "17841400000000003", username: "govisibleai", name: "GoVISIBLE" },
    ];
    const created = [];
    await withEnv(
      UNIFIED_ENV,
      async () => {
        oauth().resetInstagramOAuthNonceStore();
        await oauth().withInstagramOAuthTestHooks(
          {
            transport: transportFor(accounts),
            insertCredential: async ({ id, name, secret, config }) => {
              created.push({
                id,
                name,
                instagramUserId: secret.instagramUserId,
                username: config.username,
                token: secret.accessToken,
              });
            },
          },
          async () => {
            for (const account of accounts) {
              const started = await oauth().startInstagramOAuth(
                { workspaceId: "ws-1", name: account.name },
                ADMIN
              );
              const state = new URL(started.url).searchParams.get("state");
              await oauth().finishInstagramOAuth(`code-${account.username}`, state);
            }
          }
        );
      }
    );
    assert.equal(created.length, 3);
    assert.equal(new Set(created.map((c) => c.id)).size, 3);
    assert.equal(new Set(created.map((c) => c.instagramUserId)).size, 3);
    assert.equal(new Set(created.map((c) => c.token)).size, 3);
    assert.deepEqual(
      created.map((c) => c.username),
      ["prideworldcity", "ksbindia", "govisibleai"]
    );
  });

  await check("IG-UX-7 new OAuth connection does not overwrite existing credential", async () => {
    const rows = new Map();
    const existingId = "cred-existing-1";
    rows.set(existingId, {
      secret: { accessToken: "old-token", instagramUserId: "1" },
      config: { username: "existing" },
    });
    await withEnv(
      UNIFIED_ENV,
      async () => {
        oauth().resetInstagramOAuthNonceStore();
        await oauth().withInstagramOAuthTestHooks(
          {
            transport: transportFor([
              {
                id: "17841499999999999",
                username: "newclient",
                name: "New Client",
                accountType: "CREATOR",
              },
            ]),
            insertCredential: async ({ id, secret, config }) => {
              assert.notEqual(id, existingId);
              rows.set(id, { secret, config });
            },
            updateCredential: async () => {
              throw new Error("updateCredential must not run for a new connect");
            },
          },
          async () => {
            const started = await oauth().startInstagramOAuth(
              { workspaceId: "ws-1", name: "New Client" },
              ADMIN
            );
            const state = new URL(started.url).searchParams.get("state");
            const result = await oauth().finishInstagramOAuth("CODE2", state);
            assert.notEqual(result.credentialId, existingId);
            assert.equal(rows.get(existingId).secret.accessToken, "old-token");
            assert.ok(rows.has(result.credentialId));
          }
        );
      }
    );
  });

  await check("IG-UX-8 instagramUserId remains OAuth discovered", async () => {
    let saved = null;
    await withEnv(
      UNIFIED_ENV,
      async () => {
        oauth().resetInstagramOAuthNonceStore();
        await oauth().withInstagramOAuthTestHooks(
          {
            transport: transportFor([
              {
                id: "17841412345678901",
                username: "discovered_brand",
                name: "Discovered",
              },
            ]),
            insertCredential: async (row) => {
              saved = row;
            },
          },
          async () => {
            const started = await oauth().startInstagramOAuth(
              { workspaceId: "ws-1", name: "Discovered" },
              ADMIN
            );
            const state = new URL(started.url).searchParams.get("state");
            await oauth().finishInstagramOAuth("CODE3", state);
          }
        );
      }
    );
    assert.equal(saved.secret.instagramUserId, "17841412345678901");
    assert.equal(saved.config.instagramUserId, "17841412345678901");
    assert.equal(saved.config.username, "discovered_brand");
  });

  await check("IG-UI-1 Instagram native node has explicit presentation", () => {
    const src = read("frontend/src/modules/workflows/nodeCardPresentation.ts");
    assert.match(src, /MARKETING/);
    assert.match(src, /const MARKETING = new Set/);
    assert.match(src, /"instagram"/);
    assert.match(src, /instagram:\s*Camera/);
    assert.match(src, /border-rose-500/);
    const canvas = read("frontend/src/components/workflows/WorkflowCanvas.tsx");
    assert.match(
      canvas,
      /instagram:\s*WorkflowNode/,
      "native Instagram must register in React Flow nodeTypes (not RF default)"
    );
  });

  await check("IG-UI-2 Instagram title contrast/readability verified", () => {
    const src = read("frontend/src/modules/workflows/nodeCardPresentation.ts");
    assert.match(src, /tagClass:\s*"text-rose-300"/);
    assert.match(src, /iconWrapClass:\s*"bg-rose-500\/25 text-rose-200"/);
    assert.match(src, /label:\s*"MARKETING"/);
    const panel = read(
      "frontend/src/components/workflows/params/InstagramCredentialPanel.tsx"
    );
    assert.match(panel, /Connect Instagram/);
    assert.equal(panel.includes("App Secret"), false);
    assert.equal(panel.includes("Access Token"), false);
    assert.equal(/Instagram User ID/.test(panel), false);
  });

  await check("IG-UI-3 instagramMcpTool retains MCP visual treatment", () => {
    const src = read("frontend/src/modules/workflows/nodeCardPresentation.ts");
    assert.match(src, /instagramMcpTool:\s*BarChart3/);
    assert.match(src, /social_mcp/);
    assert.match(src, /SOCIAL \/ MCP/);
    const social = src.slice(
      src.indexOf("const SOCIAL_MCP"),
      src.indexOf("const MARKETING")
    );
    assert.match(social, /instagramMcpTool/);
    const files = src.slice(
      src.indexOf("const FILES_GOOGLE_EMAIL"),
      src.indexOf("const SOCIAL_MCP")
    );
    assert.match(files, /googleAdsMcpTool/);
    assert.equal(/instagramMcpTool/.test(files), false);
    assert.equal(/"instagram"/.test(files), false);
  });

  await check("IG-REG-1 M7 MCP regression green", () => {
    const registry = require("../services/mcpDynamicRegistry.service");
    assert.ok(registry.listProviders().some((p) => p.id === "instagram"));
    const tools = registry.listTools({ provider: "instagram" });
    assert.ok(tools.some((t) => t.id === "account_summary"));
    assert.equal(tools.some((t) => t.id === "publish_image"), false);
    assert.equal(tools.some((t) => t.id === "reply_comment"), false);
    assert.equal(typeof registry.executeInstagramMcpNode, "function");
  });

  await check("IG-REG-2 Meta Ads regression green", () => {
    const registry = require("../services/mcpDynamicRegistry.service");
    assert.ok(registry.listProviders().some((p) => p.id === "meta_ads"));
    const meta = require("../services/workflowMetaAds.service");
    assert.equal(typeof meta.executeMetaAdsNode, "function");
    const oauthSrc = read("backend/services/instagramOAuth.service.js");
    assert.equal(oauthSrc.includes("ads_read"), false);
    assert.equal(oauthSrc.includes("meta_ads"), false);
    const panel = read(
      "frontend/src/components/workflows/params/InstagramCredentialPanel.tsx"
    );
    assert.equal(panel.includes("meta_ads"), false);
    assert.equal(panel.includes("Meta Ads"), false);
  });

  await check("IG-UX docs platform setup present", () => {
    const docs = read("docs/instagram-platform-setup.md");
    assert.match(docs, /INSTAGRAM_APP_ID/);
    assert.match(docs, /INSTAGRAM_APP_SECRET/);
    assert.match(docs, /INSTAGRAM_LOGIN_CONFIG_ID/);
    assert.match(docs, /Unified Login/i);
    assert.match(docs, /ONE platform app/i);
    assert.match(docs, /MANY client/i);
    assert.match(docs, /Meta Ads node/);
    assert.match(docs, /ads_read/);
  });

  console.log(`\n${passed} IG-M7.1 checks passed`);
  process.exit(process.exitCode || 0);
}

void main();
