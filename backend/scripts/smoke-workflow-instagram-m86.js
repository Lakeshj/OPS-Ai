/**
 * Instagram M8.6 — Unified Login business-asset discovery + permission gates.
 * No live Meta calls; no secrets printed.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };
const TOKEN = "SUAT-m86-test-token";

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
  INSTAGRAM_APP_ID: "app-m86",
  INSTAGRAM_APP_SECRET: "secret-m86-do-not-leak",
  INSTAGRAM_OAUTH_REDIRECT_URI:
    "https://opsai.socialchamps.com/api/instagram-oauth/callback",
  INSTAGRAM_LOGIN_CONFIG_ID: "config-m86",
  META_APP_ID: null,
  META_APP_SECRET: null,
};

const SCOPES_OK = [
  "instagram_basic",
  "pages_read_engagement",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "ads_read",
];

const exchangeOk = (url) => {
  if (String(url).includes("/oauth/access_token")) {
    return {
      ok: true,
      status: 200,
      body: {
        access_token: TOKEN,
        expires_in: 0,
        permissions: SCOPES_OK.join(","),
      },
    };
  }
  return null;
};

const debugOk = (url, extra = {}) => {
  if (!String(url).includes("debug_token")) return null;
  return {
    ok: true,
    status: 200,
    body: {
      data: {
        app_id: "app-m86",
        type: "SYSTEM_USER",
        is_valid: true,
        scopes: SCOPES_OK,
        granular_scopes: extra.granular_scopes || [],
      },
    },
  };
};

async function main() {
  console.log("\nInstagram M8.6 business asset discovery");

  const graph = () => require("../config/instagramGraph");
  const oauth = () => require("../services/instagramOAuth.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const discovery = () => require("../services/workflowInstagramDiscovery.service");

  await check("IG-M86-1 pages_read_engagement in required Unified permissions", () => {
    assert.ok(graph().OAUTH_SCOPES.includes("pages_read_engagement"));
    assert.ok(
      graph().REQUIRED_UNIFIED_PERMISSIONS.includes("pages_read_engagement")
    );
    assert.ok(graph().REQUIRED_UNIFIED_PERMISSIONS.includes("instagram_basic"));
    const status = graph().getInstagramIntegrationStatus();
    // env may be empty outside withEnv — just ensure field exists when configured
    assert.ok(Array.isArray(status.requiredUnifiedPermissions));
  });

  await check("IG-M86-2 missing pages_read_engagement fails specifically", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("debug_token")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: {
                app_id: "app-m86",
                is_valid: true,
                scopes: ["instagram_basic", "instagram_content_publish"],
                granular_scopes: [],
              },
            },
          };
        }
        return { ok: true, status: 200, body: { data: [] } };
      };
      await assert.rejects(
        () =>
          auth().withInstagramAuthTestHooks({ transport }, () =>
            auth().discoverInstagramAccount({
              accessToken: TOKEN,
              authMode: "unified_login",
            })
          ),
        (err) =>
          err.code === "INSTAGRAM_PERMISSION_PAGES_READ_ENGAGEMENT_REQUIRED"
      );
    });
  });

  await check("IG-M86-3 debug_token scope parsing is safe", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const d = debugOk(url, {
          granular_scopes: [
            { scope: "instagram_basic", target_ids: ["178414001"] },
          ],
        });
        if (d) {
          assert.equal(String(url).includes(TOKEN), true);
          assert.equal(String(url).includes("secret-m86-do-not-leak"), true); // app token form
          return d;
        }
        return { ok: false, status: 404, body: {} };
      };
      const info = await discovery().inspectAccessTokenDebug({
        accessToken: TOKEN,
        transport,
        logger: () => {},
      });
      assert.equal(info.hasInstagramBasic, true);
      assert.equal(info.hasPagesReadEngagement, true);
      assert.equal(info.hasAdsReadOrManagement, true);
      assert.equal(info.granularTargetIdsCount, 1);
      assert.equal(info.appIdMatchesExpected, true);
      assert.equal(JSON.stringify(info).includes(TOKEN), false);
    });
  });

  await check("IG-M86-4 owned_instagram_assets resolves ig_user_id", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      let saved = null;
      const transport = async (url) => {
        const u = String(url);
        const ex = exchangeOk(u);
        if (ex) return ex;
        const d = debugOk(u);
        if (d) return d;
        if (u.includes("assigned_instagram_accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("/me/businesses")) {
          return { ok: true, status: 200, body: { data: [{ id: "biz-86" }] } };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz-86" } };
        }
        if (u.includes("owned_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "asset-1",
                  ig_user_id: "178414777",
                  ig_username: "eliteeagle.dev",
                },
              ],
            },
          };
        }
        if (u.includes("client_instagram_assets") || u.includes("instagram_business_accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("me/accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("178414777")) {
          return {
            ok: true,
            status: 200,
            body: {
              id: "178414777",
              username: "eliteeagle.dev",
              name: "Elite Eagle",
              account_type: "BUSINESS",
              media_count: 12,
            },
          };
        }
        return { ok: false, status: 404, body: { error: { message: u } } };
      };
      const result = await oauth().withInstagramOAuthTestHooks(
        {
          transport,
          insertCredential: async (row) => {
            saved = row;
          },
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1" },
            ADMIN
          );
          return oauth().finishInstagramOAuth(
            "CODE",
            new URL(started.url).searchParams.get("state")
          );
        }
      );
      assert.ok(result.credentialId);
      assert.equal(saved.config.username, "eliteeagle.dev");
      assert.equal(saved.config.instagramUserId, "178414777");
      assert.equal(saved.secret.tokenKind, "unified_system_user");
    });
  });

  await check("IG-M86-5 client_instagram_assets edge works", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        const d = debugOk(u);
        if (d) return d;
        if (u.includes("assigned_instagram_accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz-c" } };
        }
        if (u.includes("/me/businesses")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("owned_instagram_assets")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("client_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                { id: "a2", ig_user_id: "178414888", ig_username: "client_ig" },
              ],
            },
          };
        }
        if (u.includes("instagram_business_accounts") || u.includes("me/accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("178414888")) {
          return {
            ok: true,
            status: 200,
            body: { id: "178414888", username: "client_ig", account_type: "BUSINESS" },
          };
        }
        return { ok: false, status: 404, body: {} };
      };
      const account = await auth().withInstagramAuthTestHooks({ transport }, () =>
        auth().discoverInstagramAccount({
          accessToken: TOKEN,
          authMode: "unified_login",
        })
      );
      assert.equal(account.username, "client_ig");
      assert.equal(account.id, "178414888");
    });
  });

  await check("IG-M86-6 page-linked fallback works", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        const d = debugOk(u);
        if (d) return d;
        if (
          u.includes("assigned_instagram_accounts") ||
          u.includes("owned_instagram_assets") ||
          u.includes("client_instagram_assets") ||
          u.includes("instagram_business_accounts") ||
          u.includes("/me/businesses")
        ) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz-p" } };
        }
        if (u.includes("me/accounts")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "page-1",
                  instagram_business_account: {
                    id: "178414999",
                    username: "page_ig",
                  },
                },
              ],
            },
          };
        }
        if (u.includes("178414999")) {
          return {
            ok: true,
            status: 200,
            body: { id: "178414999", username: "page_ig", account_type: "BUSINESS" },
          };
        }
        return { ok: false, status: 404, body: {} };
      };
      const account = await auth().withInstagramAuthTestHooks({ transport }, () =>
        auth().discoverInstagramAccount({
          accessToken: TOKEN,
          authMode: "unified_login",
        })
      );
      assert.equal(account.username, "page_ig");
    });
  });

  await check("IG-M86-7 dedupe across edges keeps one IG user", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        const d = debugOk(u, {
          granular_scopes: [
            { scope: "instagram_basic", target_ids: ["178414777"] },
          ],
        });
        if (d) return d;
        if (u.includes("assigned_instagram_accounts")) {
          return {
            ok: true,
            status: 200,
            body: { data: [{ id: "178414777", username: "eliteeagle.dev" }] },
          };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz-86" } };
        }
        if (u.includes("/me/businesses")) {
          return { ok: true, status: 200, body: { data: [{ id: "biz-86" }] } };
        }
        if (u.includes("owned_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "asset-1",
                  ig_user_id: "178414777",
                  ig_username: "eliteeagle.dev",
                },
              ],
            },
          };
        }
        if (u.includes("client_instagram_assets") || u.includes("instagram_business_accounts") || u.includes("me/accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("178414777") && u.includes("ig_user_id")) {
          return {
            ok: true,
            status: 200,
            body: {
              id: "asset-1",
              ig_user_id: "178414777",
              ig_username: "eliteeagle.dev",
            },
          };
        }
        if (u.includes("178414777")) {
          return {
            ok: true,
            status: 200,
            body: {
              id: "178414777",
              username: "eliteeagle.dev",
              account_type: "BUSINESS",
            },
          };
        }
        return { ok: false, status: 404, body: {} };
      };
      const account = await auth().withInstagramAuthTestHooks({ transport }, () =>
        auth().discoverInstagramAccount({
          accessToken: TOKEN,
          authMode: "unified_login",
        })
      );
      assert.equal(account.username, "eliteeagle.dev");
      assert.equal(account.id, "178414777");
    });
  });

  await check("IG-M86-8 does not fabricate from username alone", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagramDiscovery.service.js"),
      "utf8"
    );
    assert.equal(src.includes("eliteeagle.dev"), false);
    assert.match(src, /owned_instagram_assets/);
    assert.match(src, /client_instagram_assets/);
    assert.match(src, /ig_user_id/);
  });

  await check("IG-M86-9 useful missing-permission sanitize", () => {
    const err = Object.assign(new Error("pages_read_engagement is required"), {
      code: "INSTAGRAM_PERMISSION_PAGES_READ_ENGAGEMENT_REQUIRED",
    });
    assert.match(
      oauth().sanitizeCallbackError(err),
      /pages_read_engagement/
    );
  });

  await check("IG-M86-10 Meta Ads unchanged", () => {
    const meta = fs.readFileSync(
      path.join(__dirname, "../config/metaGraph.js"),
      "utf8"
    );
    assert.match(meta, /ads_read/);
    assert.equal(meta.includes("pages_read_engagement"), false);
    const ads = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    assert.match(ads, /Meta write calls are not available/);
  });

  await check("IG-M86-11 no secret leakage in discovery module", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagramDiscovery.service.js"),
      "utf8"
    );
    assert.equal(src.includes("console.log(accessToken"), false);
    assert.match(src, /never returns or logs the token|Safe debug_token/i);
  });

  await check("IG-M86-12 preflight exposes requiredUnifiedPermissions", async () => {
    await withEnv(FULL, () => {
      const status = graph().getInstagramIntegrationStatus();
      assert.deepEqual(status.requiredUnifiedPermissions, [
        "instagram_basic",
        "pages_read_engagement",
      ]);
      assert.ok(status.oauthScopesConfigured.includes("pages_read_engagement"));
    });
  });

  console.log(`\nM8.6 results: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
