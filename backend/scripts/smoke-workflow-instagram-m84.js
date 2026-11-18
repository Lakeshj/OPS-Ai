/**
 * Instagram M8.4 — live callback failure fix (discovery fallbacks + errors).
 * No live Meta calls; no secrets printed.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };
const TOKEN = "SUAT-m84-test-token";

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
  INSTAGRAM_APP_ID: "app-m84",
  INSTAGRAM_APP_SECRET: "secret-m84-do-not-leak",
  INSTAGRAM_OAUTH_REDIRECT_URI:
    "https://opsai.socialchamps.com/api/instagram-oauth/callback",
  INSTAGRAM_LOGIN_CONFIG_ID: "config-m84",
  META_APP_ID: null,
  META_APP_SECRET: null,
};

const exchangeOk = (url) => {
  if (String(url).includes("/oauth/access_token")) {
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
  return null;
};

const profileOk = (url, id = "178414999", username = "social_tech") => {
  if (String(url).includes(id) && !String(url).includes("assigned")) {
    return {
      ok: true,
      status: 200,
      body: { id, username, name: "Social Tech", account_type: "BUSINESS" },
    };
  }
  return null;
};

async function main() {
  console.log("\nInstagram M8.4 discovery + callback errors");

  const oauth = () => require("../services/instagramOAuth.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const metaGraph = () => require("../config/metaGraph");

  await check("IG-M84-1 start URL includes override_default_response_type", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const started = await oauth().startInstagramOAuth(
        { workspaceId: "ws-1" },
        ADMIN
      );
      const url = new URL(started.url);
      assert.equal(url.searchParams.get("override_default_response_type"), "true");
      assert.equal(url.searchParams.get("response_type"), "code");
      assert.equal(url.searchParams.get("config_id"), "config-m84");
      assert.equal(url.searchParams.get("scope"), null);
    });
  });

  await check("IG-M84-2 empty assigned + debug_token targets succeeds", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      let saved = null;
      const transport = async (url) => {
        const u = String(url);
        const ex = exchangeOk(u);
        if (ex) return ex;
        if (u.includes("assigned_instagram_accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz-84" } };
        }
        if (u.includes("debug_token")) {
          assert.equal(u.includes(`input_token=${TOKEN}`), true);
          // App access token is appId|appSecret — never log it; URL may contain secret.
          assert.equal(u.includes("access_token="), true);
          return {
            ok: true,
            status: 200,
            body: {
              data: {
                type: "SYSTEM_USER",
                is_valid: true,
                granular_scopes: [
                  {
                    scope: "instagram_basic",
                    target_ids: ["178414999"],
                  },
                ],
              },
            },
          };
        }
        const prof = profileOk(u);
        if (prof) return prof;
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
      assert.equal(saved.config.instagramUserId, "178414999");
      assert.equal(saved.config.username, "social_tech");
      assert.equal(saved.secret.tokenKind, "unified_system_user");
    });
  });

  await check("IG-M84-3 empty assigned + business edge succeeds", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      let saved = null;
      const transport = async (url) => {
        const u = String(url);
        const ex = exchangeOk(u);
        if (ex) return ex;
        if (u.includes("assigned_instagram_accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz-84" } };
        }
        if (u.includes("debug_token")) {
          return {
            ok: true,
            status: 200,
            body: { data: { granular_scopes: [] } },
          };
        }
        if (u.includes("biz-84/owned_instagram_accounts")) {
          return {
            ok: true,
            status: 200,
            body: { data: [{ id: "178414888", username: "owned_ig" }] },
          };
        }
        if (u.includes("biz-84/")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        const prof = profileOk(u, "178414888", "owned_ig");
        if (prof) return prof;
        return { ok: false, status: 404, body: { error: { message: u } } };
      };
      await oauth().withInstagramOAuthTestHooks(
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
          await oauth().finishInstagramOAuth(
            "CODE",
            new URL(started.url).searchParams.get("state")
          );
        }
      );
      assert.equal(saved.config.username, "owned_ig");
      assert.equal(saved.config.instagramUserId, "178414888");
    });
  });

  await check("IG-M84-4 all discovery empty → sanitized discovery error", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const transport = async (url) => {
        const u = String(url);
        const ex = exchangeOk(u);
        if (ex) return ex;
        if (u.includes("assigned_instagram_accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: {} };
        }
        if (u.includes("debug_token")) {
          return {
            ok: true,
            status: 200,
            body: { data: { granular_scopes: [] } },
          };
        }
        if (u.includes("me/accounts")) {
          return { ok: true, status: 200, body: { data: [] } };
        }
        return { ok: false, status: 404, body: { error: { message: u } } };
      };
      await assert.rejects(
        () =>
          oauth().withInstagramOAuthTestHooks({ transport }, async () => {
            const started = await oauth().startInstagramOAuth(
              { workspaceId: "ws-1" },
              ADMIN
            );
            return oauth().finishInstagramOAuth(
              "CODE",
              new URL(started.url).searchParams.get("state")
            );
          }),
        (err) => {
          assert.equal(err.code, "INSTAGRAM_ACCOUNT_DISCOVERY_FAILED");
          assert.match(
            err.message,
            /authorization succeeded, but no Instagram account was available/i
          );
          const html = oauth().oauthCallbackHtml({
            ok: false,
            error: oauth().sanitizeCallbackError(err),
          });
          assert.match(
            html,
            /Instagram authorization succeeded, but no Instagram account was available/
          );
          assert.equal(html.includes(TOKEN), false);
          return true;
        }
      );
    });
  });

  await check("IG-M84-5 credential save failure is sanitized", async () => {
    await withEnv(FULL, async () => {
      oauth().resetInstagramOAuthNonceStore();
      const transport = async (url) => {
        const u = String(url);
        const ex = exchangeOk(u);
        if (ex) return ex;
        if (u.includes("assigned_instagram_accounts")) {
          return {
            ok: true,
            status: 200,
            body: { data: [{ id: "178414777", username: "ok_ig" }] },
          };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz" } };
        }
        const prof = profileOk(u, "178414777", "ok_ig");
        if (prof) return prof;
        return { ok: false, status: 404, body: { error: { message: u } } };
      };
      await assert.rejects(
        () =>
          oauth().withInstagramOAuthTestHooks(
            {
              transport,
              insertCredential: async () => {
                const err = new Error("ER_TRUNCATED_WRONG_VALUE_FOR_FIELD");
                err.code = "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD";
                throw err;
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
          ),
        (err) => {
          assert.equal(err.code, "INSTAGRAM_CREDENTIAL_SAVE_FAILED");
          assert.equal(
            oauth().sanitizeCallbackError(err),
            "Instagram credential could not be saved."
          );
          return true;
        }
      );
    });
  });

  await check("IG-M84-6 does not fabricate unread Instagram ids", async () => {
    await withEnv(FULL, async () => {
      const transport = async (url) => {
        const u = String(url);
        if (u.includes("assigned_instagram_accounts")) {
          return {
            ok: true,
            status: 200,
            body: { data: [{ id: "178414000" }] },
          };
        }
        if (u.includes("/me?")) {
          return { ok: true, status: 200, body: { client_business_id: "biz" } };
        }
        if (u.includes("178414000")) {
          return {
            ok: false,
            status: 400,
            body: { error: { message: "Unsupported get request", code: 100 } },
          };
        }
        return { ok: false, status: 404, body: { error: { message: u } } };
      };
      await assert.rejects(
        () =>
          auth().withInstagramAuthTestHooks({ transport }, () =>
            auth().discoverInstagramAccount({
              accessToken: TOKEN,
              authMode: "unified_login",
            })
          ),
        (err) => err.code === "INSTAGRAM_ACCOUNT_DISCOVERY_FAILED"
      );
    });
  });

  await check("IG-M84-7 Meta Ads graph helper unchanged (GET-only firewall)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../config/metaGraph.js"),
      "utf8"
    );
    assert.match(src, /ads_read/);
    assert.equal(src.includes("instagram_basic"), false);
    const mg = metaGraph();
    assert.ok(mg);
  });

  await check("IG-M84-8 callback HTML never includes secrets", () => {
    const AppError = require("../utils/AppError");
    const html = oauth().oauthCallbackHtml({
      ok: false,
      error: oauth().sanitizeCallbackError(
        new AppError(
          "upstream access_token=ABC leaked",
          400,
          "INSTAGRAM_OAUTH_EXCHANGE"
        )
      ),
    });
    assert.equal(html.includes("access_token=ABC"), false);
    assert.match(html, /opsai-instagram-oauth/);
    assert.match(html, /access_token=\[redacted\]/);
  });

  console.log(`\nM8.4 results: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
