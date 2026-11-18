/**
 * Instagram M2.1 — Unified Login contract verification (permissions + account ID).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };

const registerInstagramM21Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Instagram M2.1 Unified Login contract");

  const igGraph = () => require("../config/instagramGraph");
  const metaGraph = () => require("../config/metaGraph");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const oauth = () => require("../services/instagramOAuth.service");
  const metaOAuth = () => require("../services/metaOAuth.service");
  const metaAds = () => require("../services/workflowMetaAds.service");

  const withApp = async (fn) => {
    const prev = {
      id: process.env.INSTAGRAM_APP_ID,
      secret: process.env.INSTAGRAM_APP_SECRET,
      redirect: process.env.INSTAGRAM_OAUTH_REDIRECT_URI,
      configId: process.env.INSTAGRAM_LOGIN_CONFIG_ID,
    };
    process.env.INSTAGRAM_APP_ID = "ig-app-id";
    process.env.INSTAGRAM_APP_SECRET = "ig-secret";
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI =
      "https://opsai.socialchamps.com/api/instagram-oauth/callback";
    process.env.INSTAGRAM_LOGIN_CONFIG_ID = "login-config-m21";
    try {
      await fn();
    } finally {
      for (const [key, envKey] of [
        ["id", "INSTAGRAM_APP_ID"],
        ["secret", "INSTAGRAM_APP_SECRET"],
        ["redirect", "INSTAGRAM_OAUTH_REDIRECT_URI"],
        ["configId", "INSTAGRAM_LOGIN_CONFIG_ID"],
      ]) {
        if (prev[key] == null) delete process.env[envKey];
        else process.env[envKey] = prev[key];
      }
    }
  };

  check("IG-M2.1-1 publish permission is instagram_content_publish", () => {
    assertX.equal(igGraph().SCOPE_PUBLISH, "instagram_content_publish");
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_content_publish"),
      true
    );
  });

  check("IG-M2.1-2 OAuth start uses config_id not business scopes", async () => {
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_business_content_publishing"),
      false
    );
    await withApp(async () => {
      oauth().resetInstagramOAuthNonceStore();
      const started = await oauth().startInstagramOAuth(
        { workspaceId: "ws-1", name: "Instagram" },
        ADMIN
      );
      const url = new URL(started.url);
      assertX.equal(url.searchParams.get("config_id"), "login-config-m21");
      assertX.equal(url.searchParams.get("scope"), null);
      assertX.equal(started.url.includes("instagram_business_"), false);
    });
    assertX.equal(
      igGraph().normalizeGrantedScope("instagram_business_content_publishing"),
      "instagram_content_publish"
    );
  });

  check("IG-M2.1-3 basic permission exists", () => {
    assertX.equal(igGraph().REQUIRED_SCOPE, "instagram_basic");
    assertX.equal(igGraph().OAUTH_SCOPES[0], "instagram_basic");
  });

  check("IG-M2.1-4 messages permission absent", () => {
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_manage_messages"),
      false
    );
    assertX.equal(
      igGraph().OAUTH_SCOPES.includes("instagram_business_manage_messages"),
      false
    );
  });

  check("IG-M2.1-5 ads permissions absent", () => {
    const scopes = igGraph().OAUTH_SCOPES;
    assertX.equal(scopes.includes("ads_read"), false);
    assertX.equal(scopes.includes("ads_management"), false);
  });

  check(
    "IG-M2.1-6 account discovery maps Instagram asset id to instagramUserId",
    () => {
      const fromId = auth().presentInstagramAccount({
        id: "178414999",
        username: "brand",
        account_type: "BUSINESS",
      });
      assertX.equal(fromId.id, "178414999");
      assertX.equal(fromId.instagramUserId, "178414999");

      assertX.equal(auth().resolveInstagramUserId({ id: "B" }), "B");
      assertX.equal(
        auth().resolveInstagramUserId({ user_id: "A", id: "B" }),
        "A"
      );
    }
  );

  check(
    "IG-M2.1-7 assigned accounts discovery selects Instagram asset",
    async () => {
      const account = await auth().withInstagramAuthTestHooks(
        {
          transport: async (url) => {
            const u = String(url);
            if (u.includes("debug_token")) {
              return {
                ok: true,
                status: 200,
                body: {
                  data: {
                    app_id: "ig-app",
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
              return {
                ok: true,
                status: 200,
                body: {
                  data: [{ id: "178414777", username: "unified_brand" }],
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
              return {
                ok: true,
                status: 200,
                body: { client_business_id: "biz-77" },
              };
            }
            if (u.includes("178414777")) {
              return {
                ok: true,
                status: 200,
                body: {
                  id: "178414777",
                  username: "unified_brand",
                  name: "Brand",
                },
              };
            }
            return { ok: false, status: 404, body: { error: { message: u } } };
          },
        },
        () =>
          auth().discoverInstagramAccount({
            accessToken: "tok",
            authMode: "unified_login",
          })
      );
      assertX.equal(account.id, "178414777");
      assertX.equal(account.username, "unified_brand");
      assertX.equal(account.clientBusinessId, "biz-77");
    }
  );

  check("IG-M2.1-8 Meta Ads OAuth/scopes unchanged", async () => {
    assertX.deepEqual(metaGraph().OAUTH_SCOPES, ["ads_read"]);
    const prevMeta = {
      id: process.env.META_APP_ID,
      secret: process.env.META_APP_SECRET,
    };
    process.env.META_APP_ID = "meta-app-id";
    process.env.META_APP_SECRET = "meta-app-secret";
    try {
      const started = await metaOAuth().startMetaOAuth(
        { workspaceId: "ws-1", name: "Meta Ads" },
        ADMIN
      );
      assertX.deepEqual(started.scopes, ["ads_read"]);
    } finally {
      if (prevMeta.id == null) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = prevMeta.id;
      if (prevMeta.secret == null) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = prevMeta.secret;
    }
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
  registerInstagramM21Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} Instagram M2.1 checks passed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerInstagramM21Tests };
