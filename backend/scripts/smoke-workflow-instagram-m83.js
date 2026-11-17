/**
 * Instagram M8.3 — Unified Login auth layer.
 * No live Meta calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };
const TOKEN = "SUAT-test-token-value";

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
    // Empty string clears the var for preflight; avoid delete (OS may re-expose).
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
  INSTAGRAM_APP_ID: "app-111",
  INSTAGRAM_APP_SECRET: "secret-do-not-leak",
  INSTAGRAM_OAUTH_REDIRECT_URI:
    "https://opsai.socialchamps.com/api/instagram-oauth/callback",
  INSTAGRAM_LOGIN_CONFIG_ID: "config-999",
  META_APP_ID: null,
  META_APP_SECRET: null,
};

const unifiedTransport = () => async (url) => {
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
      body: { data: [{ id: "178414123", username: "unified_client" }] },
    };
  }
  if (u.includes("/me?")) {
    return { ok: true, status: 200, body: { client_business_id: "biz-9" } };
  }
  if (u.includes("178414123")) {
    return {
      ok: true,
      status: 200,
      body: {
        id: "178414123",
        username: "unified_client",
        name: "Unified Client",
      },
    };
  }
  return { ok: false, status: 404, body: { error: { message: u } } };
};

async function main() {
  console.log("\nInstagram M8.3 Unified Login");

  const graph = () => require("../config/instagramGraph");
  const oauth = () => require("../services/instagramOAuth.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const metaGraph = () => require("../config/metaGraph");

  await check("IG-M83-1 preflight requires Unified Login config ID", async () => {
    await withEnv(
      { ...FULL, INSTAGRAM_LOGIN_CONFIG_ID: "" },
      () => {
        const status = graph().getInstagramIntegrationStatus();
        assert.equal(status.instagramIntegrationConfigured, false);
        assert.ok(status.missingConfigKeys.includes("INSTAGRAM_LOGIN_CONFIG_ID"));
        assert.equal(status.unifiedLoginConfigured, false);
      }
    );
  });

  await check("IG-M83-2 HTTPS redirect override resolves correctly", async () => {
    await withEnv(FULL, () => {
      assert.equal(
        graph().resolveRedirectUri(),
        "https://opsai.socialchamps.com/api/instagram-oauth/callback"
      );
      const status = graph().getInstagramIntegrationStatus();
      assert.equal(
        status.resolvedRedirectUri,
        "https://opsai.socialchamps.com/api/instagram-oauth/callback"
      );
      assert.equal(status.instagramIntegrationConfigured, true);
      assert.equal(status.unifiedLoginConfigured, true);
      assert.deepEqual(status.missingConfigKeys, []);
    });
  });

  await check("IG-M83-3 new-account OAuth start uses Unified Login config", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const started = await oauth().startInstagramOAuth(
        { workspaceId: "ws-1", name: "Instagram" },
        ADMIN
      );
      const url = new URL(started.url);
      assert.equal(url.hostname, "www.facebook.com");
      assert.equal(url.pathname, "/dialog/oauth");
      assert.equal(url.searchParams.get("config_id"), "config-999");
      assert.equal(url.searchParams.get("client_id"), "app-111");
      assert.equal(url.searchParams.get("response_type"), "code");
      assert.equal(started.authMode, "unified_login");
      assert.equal(started.loginConfigId, "config-999");
    });
  });

  await check("IG-M83-4 new-account OAuth does not require credentialId", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const started = await oauth().startInstagramOAuth(
        { workspaceId: "ws-1" },
        ADMIN
      );
      const parsed = oauth().verifyState(new URL(started.url).searchParams.get("state"));
      assert.equal(parsed.credentialId, null);
    });
  });

  await check("IG-M83-5 old instagram_business_* scopes not sent", async () => {
    await withEnv(FULL, async () => {
      const started = await oauth().startInstagramOAuth(
        { workspaceId: "ws-1" },
        ADMIN
      );
      assert.equal(new URL(started.url).searchParams.get("scope"), null);
      assert.equal(started.url.includes("instagram_business_"), false);
      assert.equal(
        graph().OAUTH_SCOPES.includes("instagram_business_basic"),
        false
      );
    });
  });

  await check("IG-M83-6 callback handles Unified Login result", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      let saved = null;
      const result = await oauth().withInstagramOAuthTestHooks(
        {
          transport: unifiedTransport(),
          insertCredential: async (row) => {
            saved = row;
          },
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1", name: "Client A" },
            ADMIN
          );
          const state = new URL(started.url).searchParams.get("state");
          return oauth().finishInstagramOAuth("AUTH_CODE", state);
        }
      );
      assert.ok(result.credentialId);
      assert.equal(saved.secret.accessToken, TOKEN);
      assert.equal(saved.config.username, "unified_client");
    });
  });

  await check("IG-M83-7 credential records unified_system_user token kind", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      let saved = null;
      await oauth().withInstagramOAuthTestHooks(
        {
          transport: unifiedTransport(),
          insertCredential: async (row) => {
            saved = row;
          },
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
      assert.equal(saved.secret.tokenKind, "unified_system_user");
      assert.equal(saved.config.tokenKind, "unified_system_user");
      assert.equal(saved.config.authMode, "unified_login");
    });
  });

  await check("IG-M83-8 secrets never enter workflow/node/MCP/output", () => {
    const { encryptSecret, decryptSecret } = require("../services/secretBox.service");
    const enc = encryptSecret({ accessToken: TOKEN, tokenKind: "unified_system_user" });
    assert.equal(enc.includes(TOKEN), false);
    assert.equal(decryptSecret(enc).accessToken, TOKEN);
    const html = oauth().oauthCallbackHtml({ ok: true, credentialId: "c1" });
    assert.equal(html.includes(TOKEN), false);
    assert.equal(html.includes("secret-do-not-leak"), false);
    const mcp = read("backend/services/workflowInstagramMcp.service.js");
    assert.match(mcp, /instagramSourceNodeId/);
    assert.match(mcp, /instagramUserId/);
    assert.equal(mcp.includes(TOKEN), false);
  });

  await check("IG-M83-9 first credential creation works in mocks", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const ids = [];
      await oauth().withInstagramOAuthTestHooks(
        {
          transport: unifiedTransport(),
          insertCredential: async ({ id }) => ids.push(id),
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1" },
            ADMIN
          );
          const finished = await oauth().finishInstagramOAuth(
            "C1",
            new URL(started.url).searchParams.get("state")
          );
          assert.equal(finished.credentialId, ids[0]);
        }
      );
      assert.equal(ids.length, 1);
    });
  });

  await check("IG-M83-10 second credential is additive", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const rows = new Map();
      rows.set("cred-a", { secret: { accessToken: "keep-a" } });
      await oauth().withInstagramOAuthTestHooks(
        {
          transport: unifiedTransport(),
          insertCredential: async ({ id, secret }) => {
            assert.notEqual(id, "cred-a");
            rows.set(id, { secret });
          },
          updateCredential: async () => {
            throw new Error("must not overwrite A");
          },
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1", name: "B" },
            ADMIN
          );
          // No credentialId → new credential
          assert.equal(
            oauth().verifyState(new URL(started.url).searchParams.get("state"))
              .credentialId,
            null
          );
          await oauth().finishInstagramOAuth(
            "C2",
            new URL(started.url).searchParams.get("state")
          );
        }
      );
      assert.equal(rows.get("cred-a").secret.accessToken, "keep-a");
      assert.equal(rows.size, 2);
    });
  });

  await check("IG-M83-11 reconnect remains separate", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      await oauth().withInstagramOAuthTestHooks(
        {
          loadCredential: async (id) =>
            id === "cred-reconnect"
              ? {
                  id,
                  type: "instagram",
                  workspaceId: "ws-1",
                  secret: {},
                  config: {},
                }
              : null,
        },
        async () => {
          const newConn = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1", name: "New" },
            ADMIN
          );
          assert.equal(
            oauth().verifyState(new URL(newConn.url).searchParams.get("state"))
              .credentialId,
            null
          );
          const reconnect = await oauth().startInstagramOAuth(
            {
              workspaceId: "ws-1",
              credentialId: "cred-reconnect",
            },
            ADMIN
          );
          const parsed = oauth().verifyState(
            new URL(reconnect.url).searchParams.get("state")
          );
          assert.equal(parsed.credentialId, "cred-reconnect");
        }
      );
    });
  });

  await check("IG-M83-12 native Instagram node contract unchanged", () => {
    const contract = read("frontend/src/modules/workflows/nodeContract.ts");
    assert.match(contract, /instagram:\s*\{/);
    assert.match(contract, /type: "instagram"/);
    const service = read("backend/services/workflowInstagram.service.js");
    assert.match(service, /executeInstagramNode|get_profile|list_media/);
  });

  await check("IG-M83-13 Instagram MCP inheritance unchanged", () => {
    const mcp = read("backend/services/workflowInstagramMcp.service.js");
    assert.match(mcp, /instagramSourceNodeId/);
    assert.match(mcp, /instagramUserId/);
    assert.equal(mcp.includes("publish_image"), false);
    assert.equal(mcp.includes("reply_comment"), false);
  });

  await check("IG-M83-14 Meta Ads OAuth/scopes/GET-only unchanged", () => {
    assert.deepEqual(metaGraph().OAUTH_SCOPES, ["ads_read"]);
    const ads = read("backend/services/workflowMetaAds.service.js");
    assert.match(ads, /Meta write calls are not available/);
    assert.equal(ads.includes("instagram_basic"), false);
  });

  await check("IG-M83-15 Google Ads MCP surface unchanged", () => {
    const adsMcp = read("backend/services/workflowAiResources.service.js");
    assert.match(adsMcp, /googleAdsSourceNodeId|google_ads/);
    assert.match(read("frontend/src/modules/workflows/nodeContract.ts"), /googleAdsMcpTool/);
  });

  await check("IG-M83-16 Graph host is graph.facebook.com", () => {
    assert.equal(graph().GRAPH_HOST, "https://graph.facebook.com");
    assert.equal(graph().graphBaseUrl(), "https://graph.facebook.com/v26.0");
    assert.equal(auth().API_VERSION, "v26.0");
  });

  console.log(`\n${passed} IG-M8.3 checks passed`);
  process.exit(process.exitCode || 0);
}

void main();
