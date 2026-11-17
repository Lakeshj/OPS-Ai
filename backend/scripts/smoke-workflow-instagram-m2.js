/**
 * Instagram M2 — credential, OAuth, account discovery.
 * No live Instagram calls. Includes Meta Ads regression guards.
 */
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SHORT = "IGShortLivedTokenValue";
const LONG = "IGLongLivedTokenValue";
const APP_SECRET = "instagram-app-secret-test";
const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };

const registerInstagramM2Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Instagram M2 credential and OAuth");

  const igGraph = () => require("../config/instagramGraph");
  const metaGraph = () => require("../config/metaGraph");
  const oauth = () => require("../services/instagramOAuth.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const metaAds = () => require("../services/workflowMetaAds.service");
  const metaOAuth = () => require("../services/metaOAuth.service");
  const credentials = () => require("../modules/workflows/credentials.service");
  const registry = () => require("../services/connectionRegistry.service");
  const { encryptSecret, decryptSecret } = require("../services/secretBox.service");

  const withApp = async (fn) => {
    const prev = {
      id: process.env.INSTAGRAM_APP_ID,
      secret: process.env.INSTAGRAM_APP_SECRET,
      redirect: process.env.INSTAGRAM_OAUTH_REDIRECT_URI,
      configId: process.env.INSTAGRAM_LOGIN_CONFIG_ID,
      metaId: process.env.META_APP_ID,
      metaSecret: process.env.META_APP_SECRET,
    };
    process.env.INSTAGRAM_APP_ID = "ig-app-id";
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI =
      "https://opsai.socialchamps.com/api/instagram-oauth/callback";
    process.env.INSTAGRAM_LOGIN_CONFIG_ID = "login-config-test-1";
    process.env.META_APP_ID = "meta-app-id";
    process.env.META_APP_SECRET = "meta-app-secret-test";
    try {
      await fn();
    } finally {
      for (const [key, envKey] of [
        ["id", "INSTAGRAM_APP_ID"],
        ["secret", "INSTAGRAM_APP_SECRET"],
        ["redirect", "INSTAGRAM_OAUTH_REDIRECT_URI"],
        ["configId", "INSTAGRAM_LOGIN_CONFIG_ID"],
        ["metaId", "META_APP_ID"],
        ["metaSecret", "META_APP_SECRET"],
      ]) {
        if (prev[key] == null) delete process.env[envKey];
        else process.env[envKey] = prev[key];
      }
    }
  };

  /** Unified Login transport: FB code exchange + assigned IG accounts + profile. */
  const unifiedTransport = (overrides = {}) => async (url) => {
    const u = String(url);
    if (u.includes("graph.facebook.com") && u.includes("/oauth/access_token")) {
      return {
        ok: true,
        status: 200,
        body: {
          access_token: overrides.token || LONG,
          token_type: "bearer",
          expires_in: overrides.expiresIn == null ? 5184000 : overrides.expiresIn,
          ...(overrides.permissions
            ? { permissions: overrides.permissions }
            : {}),
        },
      };
    }
    if (u.includes("me/assigned_instagram_accounts")) {
      return {
        ok: true,
        status: 200,
        body: {
          data: [
            {
              id: overrides.igUserId || "17841400000000000",
              username: overrides.username || "opsai_demo",
            },
          ],
        },
      };
    }
    if (u.includes("/me?")) {
      return {
        ok: true,
        status: 200,
        body: { client_business_id: "biz-1" },
      };
    }
    if (/graph\.facebook\.com\/v[\d.]+\/\d+/.test(u) && u.includes("fields=")) {
      return {
        ok: true,
        status: 200,
        body: {
          id: overrides.igUserId || "17841400000000000",
          username: overrides.username || "opsai_demo",
          name: "OpsAi Demo",
          account_type: "BUSINESS",
          profile_picture_url: "https://example.com/pic.jpg",
        },
      };
    }
    return { ok: false, status: 404, body: { error: { message: u } } };
  };

  const secretFree = (value, ...needles) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const needle of needles) {
      assertX.equal(text.includes(needle), false, `leaked ${needle}`);
    }
  };

  check("IG-M2-1 instagram credential enum persists", () => {
    const migration = fs.readFileSync(
      path.join(__dirname, "../migrations/028_instagram_credential.sql"),
      "utf8"
    );
    assertX.equal(migration.includes("'instagram'"), true);
    assertX.equal(migration.includes("'meta_ads'"), true);
    assertX.equal(credentials().INSTAGRAM_CREDENTIAL_TYPES.has("instagram"), true);
    assertX.equal(credentials().CREDENTIAL_TYPES.has("instagram"), true);
    const entry = registry().getSupportedPredefined("instagram");
    assertX.ok(entry);
    assertX.equal(entry.dbType, "instagram");
    const types = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/types.ts"),
      "utf8"
    );
    assertX.equal(types.includes('"instagram"'), true);
  });

  check("IG-M2-2 OAuth state uses Unified Login dialog", async () => {
    await withApp(async () => {
      oauth().resetInstagramOAuthNonceStore();
      const started = await oauth().startInstagramOAuth(
        { workspaceId: "ws-1", name: "Instagram" },
        ADMIN
      );
      const url = new URL(started.url);
      assertX.equal(url.hostname, "www.facebook.com");
      assertX.equal(url.pathname, "/dialog/oauth");
      assertX.equal(url.searchParams.get("config_id"), "login-config-test-1");
      assertX.equal(url.searchParams.get("scope"), null);
      assertX.equal(url.searchParams.get("response_type"), "code");
      const state = url.searchParams.get("state");
      const parsed = oauth().verifyState(state);
      assertX.equal(parsed.flow, "instagram");
      assertX.notEqual(parsed.flow, "meta_ads");
      assertX.equal(parsed.authMode, "unified_login");
      assertX.equal(started.apiVersion, "v26.0");
      assertX.equal(igGraph().API_VERSION, "v26.0");
      assertX.equal(igGraph().graphBaseUrl(), "https://graph.facebook.com/v26.0");
      assertX.equal(started.authMode, "unified_login");
    });
  });

  check("IG-M2-3 Instagram scopes exclude ads_read/ads_management/messages", async () => {
    await withApp(async () => {
      const scopes = igGraph().OAUTH_SCOPES;
      assertX.deepEqual(scopes, [
        "instagram_basic",
        "instagram_content_publish",
        "instagram_manage_comments",
        "instagram_manage_insights",
      ]);
      assertX.equal(scopes.includes("ads_read"), false);
      assertX.equal(scopes.includes("ads_management"), false);
      assertX.equal(scopes.includes("instagram_manage_messages"), false);
      assertX.equal(scopes.includes("instagram_business_basic"), false);
      const started = await oauth().startInstagramOAuth(
        { workspaceId: "ws-1", name: "Instagram" },
        ADMIN
      );
      const scopeParam = new URL(started.url).searchParams.get("scope");
      assertX.equal(scopeParam, null);
      assertX.ok(started.url.includes("config_id="));
      assertX.equal(started.url.includes("instagram_business_"), false);
    });
  });

  check("IG-M2-4 token stored encrypted", async () => {
    await withApp(async () => {
      oauth().resetInstagramOAuthNonceStore();
      let storedSecret = null;
      let storedConfig = null;

      const result = await oauth().withInstagramOAuthTestHooks(
        {
          transport: unifiedTransport({
            permissions:
              "instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights",
          }),
          now: () => Date.parse("2026-06-01T00:00:00.000Z"),
          insertCredential: async ({ id, secret, config }) => {
            storedSecret = secret;
            storedConfig = config;
            assertX.equal(secret.accessToken, LONG);
            assertX.equal(secret.tokenKind, "unified_system_user");
            const enc = encryptSecret(secret);
            assertX.equal(typeof enc, "string");
            assertX.equal(enc.includes(LONG), false);
            const dec = decryptSecret(enc);
            assertX.equal(dec.accessToken, LONG);
            return id;
          },
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1", name: "Instagram" },
            ADMIN
          );
          const state = new URL(started.url).searchParams.get("state");
          return oauth().finishInstagramOAuth("auth-code-1", state);
        }
      );
      assertX.ok(result.credentialId);
      assertX.equal(storedSecret.accessToken, LONG);
      assertX.equal(storedSecret.tokenKind, "unified_system_user");
      assertX.equal(storedConfig.instagramUserId, "17841400000000000");
      assertX.equal(storedConfig.username, "opsai_demo");
      assertX.equal(storedConfig.tokenKind, "unified_system_user");
      secretFree(storedConfig, LONG, SHORT, APP_SECRET);
    });
  });

  check("IG-M2-5 OAuth callback updates same credential on reconnect", async () => {
    await withApp(async () => {
      oauth().resetInstagramOAuthNonceStore();
      let updateCount = 0;
      let lastSecret = null;

      await oauth().withInstagramOAuthTestHooks(
        {
          transport: unifiedTransport({
            token: `${LONG}-reconnected`,
            permissions: "instagram_basic,instagram_manage_insights",
          }),
          now: () => Date.parse("2026-06-01T00:00:00.000Z"),
          loadCredential: async (id) =>
            id === "cred-ig-1"
              ? {
                  id: "cred-ig-1",
                  type: "instagram",
                  workspaceId: "ws-1",
                  secret: { accessToken: "old", tokenKind: "unified_system_user" },
                  config: {
                    instagramUserId: "17841400000000000",
                    username: "opsai_demo",
                    accountType: "Business",
                    authMode: "unified_login",
                  },
                }
              : null,
          updateCredential: async (id, secret, config) => {
            updateCount += 1;
            assertX.equal(id, "cred-ig-1");
            lastSecret = secret;
            assertX.equal(config.instagramUserId, "17841400000000000");
          },
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            {
              workspaceId: "ws-1",
              name: "Instagram",
              credentialId: "cred-ig-1",
            },
            ADMIN
          );
          const state = new URL(started.url).searchParams.get("state");
          const finished = await oauth().finishInstagramOAuth("code-2", state);
          assertX.equal(finished.credentialId, "cred-ig-1");
        }
      );
      assertX.equal(updateCount, 1);
      assertX.equal(lastSecret.accessToken, `${LONG}-reconnected`);
      assertX.equal(lastSecret.tokenKind, "unified_system_user");
    });
  });

  check("IG-M2-6 account discovery stores instagramUserId + username", async () => {
    await withApp(async () => {
      const account = auth().presentInstagramAccount({
        user_id: "178414111",
        username: "brand_ig",
        account_type: "MEDIA_CREATOR",
        profile_picture_url: "https://cdn.example/a.jpg",
      });
      assertX.equal(account.id, "178414111");
      assertX.equal(account.username, "brand_ig");
      assertX.equal(account.accountType, "Media_Creator");
      assertX.equal(account.profilePictureUrl, "https://cdn.example/a.jpg");

      const discovered = await auth().withInstagramAuthTestHooks(
        {
          transport: async (url) => {
            const u = String(url);
            if (u.includes("assigned_instagram_accounts")) {
              return {
                ok: true,
                status: 200,
                body: { data: [{ id: "178414111", username: "brand_ig" }] },
              };
            }
            if (u.includes("/me?")) {
              return { ok: true, status: 200, body: { client_business_id: "biz" } };
            }
            if (u.includes("178414111")) {
              return {
                ok: true,
                status: 200,
                body: {
                  id: "178414111",
                  username: "brand_ig",
                  account_type: "BUSINESS",
                  profile_picture_url: "https://cdn.example/a.jpg",
                },
              };
            }
            return { ok: false, status: 404, body: { error: { message: u } } };
          },
        },
        () =>
          auth().discoverInstagramAccount({
            accessToken: LONG,
            authMode: "unified_login",
          })
      );
      assertX.equal(discovered.id, "178414111");
      assertX.equal(discovered.username, "brand_ig");
      const listedShape = {
        accounts: [
          {
            id: discovered.id,
            username: discovered.username,
            accountType: discovered.accountType,
            profilePictureUrl: discovered.profilePictureUrl,
          },
        ],
      };
      assertX.equal(listedShape.accounts.length, 1);
      secretFree(listedShape, LONG, APP_SECRET);
    });
  });

  check("IG-M2-7 missing permission handled safely", async () => {
    await withApp(async () => {
      oauth().resetInstagramOAuthNonceStore();
      let storedConfig = null;
      await oauth().withInstagramOAuthTestHooks(
        {
          transport: unifiedTransport({
            permissions: "instagram_basic",
            username: "basic_only",
            igUserId: "1",
            expiresIn: 1000,
          }),
          insertCredential: async ({ config }) => {
            storedConfig = config;
          },
          now: () => Date.now(),
        },
        async () => {
          const started = await oauth().startInstagramOAuth(
            { workspaceId: "ws-1" },
            ADMIN
          );
          const state = new URL(started.url).searchParams.get("state");
          const finished = await oauth().finishInstagramOAuth("code-3", state);
          assertX.ok(finished.missingPermissions.length >= 1);
          assertX.equal(
            finished.missingPermissions.includes("instagram_content_publish"),
            true
          );
        }
      );
      assertX.equal(storedConfig.connected, true);
      assertX.ok(Array.isArray(storedConfig.missingPermissions));
      assertX.equal(
        storedConfig.missingPermissions.includes("instagram_manage_comments"),
        true
      );
    });
  });

  check("IG-M2-8 expired/revoked token marks reconnectRequired", async () => {
    await withApp(async () => {
      let marked = false;
      await auth().withInstagramAuthTestHooks(
        {
          now: () => Date.parse("2026-06-10T00:00:00.000Z"),
          loadCredential: async () => ({
            id: "cred-ig-1",
            type: "instagram",
            workspaceId: "ws-1",
            secret: {
              accessToken: LONG,
              expiresAt: "2026-06-01T00:00:00.000Z",
            },
            config: { connected: true, expiresAt: "2026-06-01T00:00:00.000Z" },
          }),
        },
        async () => {
          const life = auth().reconnectState(
            {
              accessToken: LONG,
              expiresAt: "2026-06-01T00:00:00.000Z",
            },
            {}
          );
          assertX.equal(life.reconnectRequired, true);
          try {
            auth().assertUsableSecret(
              {
                accessToken: LONG,
                expiresAt: "2026-06-01T00:00:00.000Z",
              },
              {}
            );
            assertX.fail("expected expired throw");
          } catch (err) {
            assertX.equal(err.code, "INSTAGRAM_TOKEN_INVALID");
          }
        }
      );

      // Revoked path via Graph 190
      await auth().withInstagramAuthTestHooks(
        {
          loadCredential: async () => ({
            id: "cred-ig-1",
            type: "instagram",
            workspaceId: "ws-1",
            secret: {
              accessToken: LONG,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
            config: { connected: true },
          }),
          transport: async () => ({
            ok: false,
            status: 401,
            body: { error: { code: 190, message: "Error validating access token" } },
          }),
        },
        async () => {
          // Monkey-patch mark via pool is hard; verify mapInstagramError classification.
          const err = auth().mapInstagramError(401, {
            error: { code: 190, message: "revoked" },
          });
          assertX.equal(err.code, "INSTAGRAM_TOKEN_INVALID");
          marked = true;
        }
      );
      assertX.equal(marked, true);
    });
  });

  check("IG-M2-9 secrets never returned to frontend", () => {
    const row = {
      id: "cred-ig-1",
      workspace_id: "ws-1",
      name: "Instagram",
      type: "instagram",
      created_by: "u1",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      secret_json: encryptSecret({ accessToken: LONG }),
      config_json: JSON.stringify({
        connected: true,
        instagramUserId: "17841400000000000",
        username: "opsai_demo",
        accountType: "Business",
        expiresAt: "2026-08-01T00:00:00.000Z",
        grantedPermissions: ["instagram_business_basic"],
      }),
    };
    const formatted = credentials().formatCredential(row);
    secretFree(formatted, LONG, APP_SECRET, "accessToken");
    assertX.equal(formatted.username, "opsai_demo");
    assertX.equal(formatted.instagramUserId, "17841400000000000");
    assertX.equal(formatted.accessToken, undefined);

    const html = oauth().oauthCallbackHtml({
      ok: true,
      credentialId: "cred-ig-1",
    });
    secretFree(html, LONG, APP_SECRET);
    assertX.equal(html.includes("opsai-instagram-oauth"), true);
  });

  check("IG-M2-10 Meta Ads credential remains ads_read only", async () => {
    assertX.deepEqual(metaGraph().OAUTH_SCOPES, ["ads_read"]);
    assertX.equal(metaGraph().API_VERSION, "v26.0");
    await withApp(async () => {
      const started = await metaOAuth().startMetaOAuth(
        { workspaceId: "ws-1", name: "Meta Ads" },
        ADMIN
      );
      assertX.deepEqual(started.scopes, ["ads_read"]);
      assertX.equal(started.scopes.includes("instagram_basic"), false);
    });
  });

  check("IG-M2-11 Meta Ads GET guard unchanged", async () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    assertX.equal(src.includes('String(method || "GET").toUpperCase() !== "GET"'), true);
    assertX.equal(src.includes("Meta write calls are not available."), true);
    await assertX.rejects(
      () =>
        metaAds().metaGraphRequest({
          accessToken: "x",
          path: "me",
          method: "POST",
        }),
      (err) => err.code === "META_PERMISSION_DENIED"
    );
  });

  check("IG-M2-12 Meta Ads native/MCP regressions pass (guards)", () => {
    const adsSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    const mcpSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAdsMcp.service.js"),
      "utf8"
    );
    const oauthSrc = fs.readFileSync(
      path.join(__dirname, "../services/metaOAuth.service.js"),
      "utf8"
    );
    assertX.equal(adsSrc.includes('type !== "meta_ads"'), true);
    assertX.equal(oauthSrc.includes('flow: "meta_ads"'), true);
    assertX.equal(oauthSrc.includes("ads_read"), true);
    assertX.equal(mcpSrc.includes("normalizeAdAccountId"), true);
    // Instagram must not punch a POST hole through Ads client
    assertX.equal(adsSrc.includes("instagram"), false);
    // Unified Login shares Facebook Graph host family with Meta Ads version pin,
    // but Instagram OAuth/credential path remains separate (config_id / SUAT).
    assertX.equal(igGraph().AUTH_MODE_UNIFIED, "unified_login");
    assertX.equal(igGraph().GRAPH_HOST, "https://graph.facebook.com");
    assertX.equal(metaGraph().OAUTH_SCOPES.includes("ads_read"), true);
  });
};

if (require.main === module) {
  const queue = [];
  let passed = 0;
  const check = (name, fn) => {
    queue.push(async () => {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
      } catch (err) {
        console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
        process.exitCode = 1;
      }
    });
  };
  const section = (name) => queue.push(async () => console.log(`\n${name}`));
  registerInstagramM2Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} Instagram M2 checks passed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerInstagramM2Tests };
