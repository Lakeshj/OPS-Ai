/**
 * M9.1.1 — Facebook Page registration + OAuth callback diagnostics.
 * No live Meta calls. Does not modify Instagram / Meta Ads behavior.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const crypto = require("node:crypto");

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

const withApp = async (fn) => {
  const keys = [
    "FACEBOOK_PAGE_APP_ID",
    "FACEBOOK_PAGE_APP_SECRET",
    "FACEBOOK_PAGE_OAUTH_REDIRECT_URI",
    "META_APP_ID",
    "META_APP_SECRET",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
  ];
  const snap = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.FACEBOOK_PAGE_APP_ID = "fb-page-app-id";
  process.env.FACEBOOK_PAGE_APP_SECRET = "fb-page-app-secret";
  process.env.FACEBOOK_PAGE_OAUTH_REDIRECT_URI =
    "http://localhost:5013/api/facebook-page-oauth/callback";
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
  delete process.env.INSTAGRAM_APP_ID;
  delete process.env.INSTAGRAM_APP_SECRET;
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (snap[k] == null) delete process.env[k];
      else process.env[k] = snap[k];
    }
  }
};

const signState = (payload, secret) => {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
};

(async () => {
  console.log("\nM9.1.1 Facebook Page registration + OAuth diagnostics");

  const root = path.join(__dirname, "..", "..");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

  await check("M911-1 ALLOWED_NODE_TYPES includes facebookPage", () => {
    const workflows = require("../modules/workflows/workflows.service");
    assert.equal(workflows.ALLOWED_NODE_TYPES.has("facebookPage"), true);
    assert.equal(workflows.ALLOWED_NODE_TYPES.has("instagram"), true);
    assert.equal(workflows.ALLOWED_NODE_TYPES.has("metaAds"), true);
  });

  await check("M911-2 validateDefinition accepts facebookPage node", () => {
    const workflows = require("../modules/workflows/workflows.service");
    const definition = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { label: "Start", nodeType: "trigger" },
        },
        {
          id: "facebookPage-1",
          type: "facebookPage",
          position: { x: 240, y: 0 },
          data: {
            label: "Facebook Page",
            nodeType: "facebookPage",
            resource: "page",
            operation: "get",
            credentialId: "",
            pageId: "",
          },
        },
        {
          id: "result-1",
          type: "result",
          position: { x: 480, y: 0 },
          data: { label: "Result", nodeType: "result" },
        },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "facebookPage-1" },
        { id: "e2", source: "facebookPage-1", target: "result-1" },
      ],
    };
    assert.doesNotThrow(() => workflows.validateDefinition(definition));
  });

  await check("M911-3 validateDefinition still rejects unknown types", () => {
    const workflows = require("../modules/workflows/workflows.service");
    assert.throws(
      () =>
        workflows.validateDefinition({
          version: 1,
          nodes: [
            {
              id: "x",
              type: "notARealNode",
              position: { x: 0, y: 0 },
              data: {},
            },
          ],
          edges: [],
        }),
      /Unsupported node type: notARealNode/
    );
  });

  await check("M911-4 Execution handler registered for facebookPage", () => {
    const nodesSrc = read("backend/services/workflowNodes.service.js");
    assert.match(nodesSrc, /facebookPage:\s*async\s*\(/);
    assert.match(
      nodesSrc,
      /require\(["']\.\/workflowFacebookPage\.service["']\)/
    );
  });

  await withApp(async () => {
    const oauth = () => require("../services/facebookPageOAuth.service");
    const config = require("../config");
    const stateSecret = String(
      config.workflows.credentialsKey || config.jwt.secret || "dev"
    );

    await check("M911-5 OAuth success path persists via hook", async () => {
      oauth().resetFacebookPageOAuthNonceStore();
      const saved = [];
      const state = signState(
        {
          flow: "facebook_page",
          workspaceId: "ws-1",
          name: "Facebook Page",
          credentialId: null,
          userId: "user-1",
          nonce: crypto.randomBytes(8).toString("hex"),
          exp: Date.now() + 60_000,
        },
        stateSecret
      );
      const result = await oauth().withFacebookPageOAuthTestHooks(
        {
          now: () => Date.now(),
          insertCredential: async (row) => {
            saved.push(row);
          },
          transport: async (url) => {
            const u = String(url);
            if (u.includes("/oauth/access_token")) {
              if (u.includes("fb_exchange_token")) {
                return {
                  ok: true,
                  status: 200,
                  body: {
                    access_token: "EAALongLivedUserToken",
                    expires_in: 5184000,
                  },
                };
              }
              return {
                ok: true,
                status: 200,
                body: { access_token: "EAAShortLivedUserToken", expires_in: 3600 },
              };
            }
            if (u.includes("/debug_token")) {
              return {
                ok: true,
                status: 200,
                body: {
                  data: {
                    user_id: "99",
                    scopes: [
                      "pages_show_list",
                      "pages_read_engagement",
                      "read_insights",
                      "pages_manage_posts",
                    ],
                  },
                },
              };
            }
            if (u.includes("/me?") && !u.includes("/me/accounts")) {
              return {
                ok: true,
                status: 200,
                body: { id: "99", name: "Test User" },
              };
            }
            if (u.includes("/me/accounts")) {
              return {
                ok: true,
                status: 200,
                body: {
                  data: [
                    {
                      id: "111",
                      name: "SocialChamps",
                      access_token: "EAAPageToken",
                      tasks: ["ANALYZE", "CREATE_CONTENT"],
                      category: "Business",
                    },
                  ],
                },
              };
            }
            return { ok: false, status: 400, body: { error: { message: u } } };
          },
        },
        () => oauth().finishFacebookPageOAuth("test-code", state)
      );
      assert.ok(result.credentialId);
      assert.equal(result.pageCount, 1);
      assert.equal(saved.length, 1);
      assert.equal(saved[0].type, "facebook_page");
      assert.equal(saved[0].secret.pages["111"].accessToken, "EAAPageToken");
    });

    await check("M911-6 OAuth empty pages returns meaningful error", async () => {
      oauth().resetFacebookPageOAuthNonceStore();
      const state = signState(
        {
          flow: "facebook_page",
          workspaceId: "ws-1",
          name: "Facebook Page",
          credentialId: null,
          userId: "user-1",
          nonce: crypto.randomBytes(8).toString("hex"),
          exp: Date.now() + 60_000,
        },
        stateSecret
      );
      await assert.rejects(
        () =>
          oauth().withFacebookPageOAuthTestHooks(
            {
              now: () => Date.now(),
              insertCredential: async () => {},
              transport: async (url) => {
                const u = String(url);
                if (u.includes("/oauth/access_token")) {
                  return {
                    ok: true,
                    status: 200,
                    body: { access_token: "EAATok", expires_in: 3600 },
                  };
                }
                if (u.includes("/debug_token")) {
                  return {
                    ok: true,
                    status: 200,
                    body: { data: { scopes: ["pages_show_list"] } },
                  };
                }
                if (u.includes("/me?") && !u.includes("/me/accounts")) {
                  return { ok: true, status: 200, body: { id: "1", name: "U" } };
                }
                if (u.includes("/me/accounts")) {
                  return { ok: true, status: 200, body: { data: [] } };
                }
                return { ok: false, status: 400, body: { error: { message: u } } };
              },
            },
            () => oauth().finishFacebookPageOAuth("code", state)
          ),
        (err) => {
          assert.equal(err.code, "FACEBOOK_PAGE_NONE_FOUND");
          assert.equal(err.stage, "page_discovery");
          const sanitized = oauth().sanitizeCallbackError(err);
          assert.match(sanitized, /Page discovery/i);
          assert.doesNotMatch(
            sanitized,
            /^Facebook Page connect failed: Facebook Page connect failed$/
          );
          return true;
        }
      );
    });

    await check("M911-7 Callback HTML avoids doubled generic error", async () => {
      const html = await oauth().handleFacebookPageOAuthCallback({
        error: "access_denied",
        error_description: "User denied",
      });
      assert.match(html, /Meta authorization denied/i);
      assert.doesNotMatch(
        html,
        /Facebook Page connect failed: Facebook Page connect failed/
      );
    });
  });

  await check("M911-8 Isolation: IG/Meta Ads OAuth files untouched by this fix", () => {
    // Guard only that we did not rewrite those services in this smoke session.
    const ig = read("backend/services/instagramOAuth.service.js");
    const meta = read("backend/services/metaOAuth.service.js");
    assert.match(ig, /sanitizeCallbackError/);
    assert.match(meta, /finishMetaOAuth|oauthCallbackHtml/);
  });

  console.log(`\n${passed} M9.1.1 checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {
    // ignore
  }
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
