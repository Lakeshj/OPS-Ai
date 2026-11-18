/**
 * Instagram M8.7 — business-edge empty vs Graph error + multi-business trace.
 * No live Meta calls; no secrets printed.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };
const TOKEN = "SUAT-m87-test-token";

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
  INSTAGRAM_APP_ID: "app-m87",
  INSTAGRAM_APP_SECRET: "secret-m87-do-not-leak",
  INSTAGRAM_OAUTH_REDIRECT_URI:
    "https://opsai.socialchamps.com/api/instagram-oauth/callback",
  INSTAGRAM_LOGIN_CONFIG_ID: "config-m87",
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

const debugOk = (url, extra = {}) => {
  if (!String(url).includes("debug_token")) return null;
  return {
    ok: true,
    status: 200,
    body: {
      data: {
        app_id: "app-m87",
        type: "SYSTEM_USER",
        is_valid: true,
        scopes: extra.scopes || SCOPES_OK,
        granular_scopes: extra.granular_scopes || [],
      },
    },
  };
};

async function main() {
  console.log("\nInstagram M8.7 empty-vs-error business discovery");

  const discovery = () =>
    require("../services/workflowInstagramDiscovery.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const oauth = () => require("../services/instagramOAuth.service");

  await check("IG-M87-1 classify empty vs permission denied", () => {
    const { EDGE_STATUS, classifyGraphFailure } = discovery();
    const denied = classifyGraphFailure({
      code: "INSTAGRAM_PERMISSION_DENIED",
      message: "(#200) Permissions error",
      graphCode: 200,
    });
    assert.equal(denied.status, EDGE_STATUS.PERMISSION_DENIED);
    const missing = classifyGraphFailure({
      message: "Unsupported get request. Object does not exist",
      graphCode: 100,
    });
    assert.equal(missing.status, EDGE_STATUS.OBJECT_NOT_FOUND);
  });

  await check("IG-M87-2 Graph error is not count=0 success", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("owned_instagram_assets") || u.includes("client_instagram_assets")) {
          return {
            ok: false,
            status: 403,
            body: {
              error: {
                message: "(#200) Requires business_management",
                code: 200,
                error_subcode: 0,
              },
            },
          };
        }
        return { ok: false, status: 404, body: {} };
      };
      const result = await discovery().collectFromBusinessEdges({
        transport,
        accessToken: TOKEN,
        businessCandidates: [
          { businessId: "biz-a", source: "client_business_id" },
        ],
        logger: () => {},
      });
      assert.equal(result.count, 0);
      assert.equal(
        result.perBusiness[0].owned_instagram_assets.status,
        discovery().EDGE_STATUS.PERMISSION_DENIED
      );
      assert.equal(result.perBusiness[0].owned_instagram_assets.count, null);
      assert.equal(
        result.perBusiness[0].owned_instagram_assets.graph_error_code,
        200
      );
    });
  });

  await check("IG-M87-3 empty 200 data[] is BUSINESS_EDGE_EMPTY", async () => {
    await withEnv(FULL, async () => {
      const transport = async () => ({
        ok: true,
        status: 200,
        body: { data: [] },
      });
      const result = await discovery().collectFromBusinessEdges({
        transport,
        accessToken: TOKEN,
        businessCandidates: [{ businessId: "biz-empty", source: "me/businesses" }],
        logger: () => {},
      });
      assert.equal(
        result.perBusiness[0].owned_instagram_assets.status,
        discovery().EDGE_STATUS.EMPTY
      );
      assert.equal(result.perBusiness[0].owned_instagram_assets.count, 0);
    });
  });

  await check("IG-M87-4 multiple business IDs tracked by source", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        const d = debugOk(u);
        if (d) return d;
        if (u.includes("/me?") && u.includes("client_business_id")) {
          return {
            ok: true,
            status: 200,
            body: { id: "sys", client_business_id: "biz-client" },
          };
        }
        if (u.includes("me/businesses")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                { id: "biz-social-tech", name: "Social Tech" },
                { id: "biz-other", name: "Other Co" },
              ],
            },
          };
        }
        return { ok: true, status: 200, body: { data: [] } };
      };
      const list = await discovery().collectBusinessIds({
        graphGet: async ({ path, query }) => {
          const params = new URLSearchParams(query || {});
          params.set("access_token", TOKEN);
          const url = `https://graph.facebook.com/v26.0/${path}?${params}`;
          return (await transport(url)).body;
        },
        transport,
        accessToken: TOKEN,
        credentialId: null,
        workspaceId: null,
        granularCategories: [],
        logger: () => {},
      });
      assert.ok(list.length >= 2);
      const sources = list.map((b) => b.source);
      assert.ok(sources.includes("client_business_id"));
      assert.ok(sources.includes("me/businesses"));
      assert.ok(list.some((b) => b.businessId === "biz-social-tech"));
    });
  });

  await check("IG-M87-5 owned assets parse ig_user_id/ig_username", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("owned_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "asset-9",
                  ig_user_id: "178414777",
                  ig_username: "eliteeagle.dev",
                },
              ],
            },
          };
        }
        if (u.includes("client_instagram_assets")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        return { ok: false, status: 404, body: {} };
      };
      const result = await discovery().collectFromBusinessEdges({
        transport,
        accessToken: TOKEN,
        businessCandidates: [
          { businessId: "biz-social-tech", source: "me/businesses" },
        ],
        logger: () => {},
      });
      assert.equal(result.count, 1);
      assert.equal(result.accounts[0].id, "178414777");
      assert.equal(result.accounts[0].username, "eliteeagle.dev");
      assert.equal(
        result.perBusiness[0].owned_instagram_assets.assets[0].ig_username,
        "eliteeagle.dev"
      );
    });
  });

  await check("IG-M87-6 client assets edge works", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("owned_instagram_assets")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("client_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "asset-c",
                  ig_user_id: "178414888",
                  ig_username: "client_ig",
                },
              ],
            },
          };
        }
        return { ok: false, status: 404, body: {} };
      };
      const result = await discovery().collectFromBusinessEdges({
        transport,
        accessToken: TOKEN,
        businessCandidates: [{ businessId: "biz-c", source: "client_business_id" }],
        logger: () => {},
      });
      assert.equal(result.accounts[0].username, "client_ig");
    });
  });

  await check("IG-M87-7 direct asset lookup fills ig_user_id", () => {
    const row = discovery().normalizeAssetRow(
      { id: "asset-1", ig_user_id: "178414001", ig_username: "brand" },
      "owned_instagram_assets"
    );
    assert.equal(row.id, "178414001");
    assert.equal(row.assetId, "asset-1");
    assert.equal(row.username, "brand");
  });

  await check("IG-M87-8 granular target type resolution", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("debug_token")) {
          return debugOk(u, {
            granular_scopes: [
              { scope: "instagram_basic", target_ids: ["asset-g"] },
              { scope: "ads_read", target_ids: ["act_123"] },
            ],
          });
        }
        if (u.includes("asset-g") && u.includes("ig_user_id")) {
          return {
            ok: true,
            status: 200,
            body: {
              id: "asset-g",
              ig_user_id: "178414777",
              ig_username: "eliteeagle.dev",
            },
          };
        }
        return { ok: false, status: 400, body: { error: { code: 100 } } };
      };
      const debugInfo = await discovery().inspectAccessTokenDebug({
        accessToken: TOKEN,
        transport,
        logger: () => {},
      });
      const resolved = await discovery().resolveGranularTargetCandidates({
        debugInfo,
        transport,
        accessToken: TOKEN,
        logger: () => {},
      });
      assert.ok(resolved.instagramAssetTargets >= 1);
      assert.ok(
        resolved.categories.some((c) => c.category === "instagram_business_asset")
      );
      assert.ok(resolved.categories.some((c) => c.category === "ad_account"));
      assert.equal(resolved.accounts[0].username, "eliteeagle.dev");
    });
  });

  await check("IG-M87-9 full discovery prefers owned assets path", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      let saved = null;
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("/oauth/access_token")) {
          return {
            ok: true,
            status: 200,
            body: { access_token: TOKEN, expires_in: 0, permissions: SCOPES_OK.join(",") },
          };
        }
        const d = debugOk(u);
        if (d) return d;
        if (u.includes("/me?")) {
          return {
            ok: true,
            status: 200,
            body: { client_business_id: "biz-social-tech" },
          };
        }
        if (u.includes("me/businesses")) {
          return {
            ok: true,
            status: 200,
            body: { data: [{ id: "biz-social-tech", name: "Social Tech" }] },
          };
        }
        if (u.includes("assigned_instagram_accounts") || u.includes("me/accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("owned_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "asset-ee",
                  ig_user_id: "178414777",
                  ig_username: "eliteeagle.dev",
                },
              ],
            },
          };
        }
        if (u.includes("client_instagram_assets")) {
          return { ok: true, status: 200, body: { data: [] } };
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

  await check("IG-M87-10 permission-denied edges do not look like empty success", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        const d = debugOk(u, {
          scopes: SCOPES_OK.filter((s) => s !== "ads_read"),
        });
        if (d) return d;
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz-x" } };
        }
        if (u.includes("me/businesses") || u.includes("assigned") || u.includes("me/accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("owned_instagram_assets") || u.includes("client_instagram_assets")) {
          return {
            ok: false,
            status: 403,
            body: { error: { message: "(#200) Permissions error", code: 200 } },
          };
        }
        return { ok: false, status: 404, body: {} };
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
          err.code === "INSTAGRAM_SELECTED_ASSET_NOT_RESOLVABLE" ||
          err.code === "INSTAGRAM_REQUIRED_PERMISSION_MISSING" ||
          err.code === "INSTAGRAM_NO_ACCESSIBLE_ACCOUNT"
      );
    });
  });

  await check("IG-M87-11 Meta Ads unchanged + no secret leakage", () => {
    const meta = fs.readFileSync(
      path.join(__dirname, "../config/metaGraph.js"),
      "utf8"
    );
    assert.match(meta, /ads_read/);
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagramDiscovery.service.js"),
      "utf8"
    );
    assert.equal(src.includes("console.log(accessToken"), false);
    assert.match(src, /BUSINESS_EDGE_EMPTY/);
    assert.match(src, /BUSINESS_EDGE_PERMISSION_DENIED/);
    assert.equal(src.includes("eliteeagle.dev"), false);
  });

  await check("IG-M87-12 dedupe across businesses", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("owned_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "a1",
                  ig_user_id: "178414777",
                  ig_username: "eliteeagle.dev",
                },
              ],
            },
          };
        }
        if (u.includes("client_instagram_assets")) {
          return {
            ok: true,
            status: 200,
            body: {
              data: [
                {
                  id: "a2",
                  ig_user_id: "178414777",
                  ig_username: "eliteeagle.dev",
                },
              ],
            },
          };
        }
        return { ok: false, status: 404, body: {} };
      };
      const result = await discovery().collectFromBusinessEdges({
        transport,
        accessToken: TOKEN,
        businessCandidates: [
          { businessId: "biz-1", source: "me/businesses" },
          { businessId: "biz-2", source: "client_business_id" },
        ],
        logger: () => {},
      });
      assert.equal(result.count, 1);
      assert.equal(result.accounts[0].id, "178414777");
    });
  });

  console.log(`\nM8.7 results: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
