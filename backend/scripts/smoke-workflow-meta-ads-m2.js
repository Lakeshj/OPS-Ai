/**
 * Meta Ads M2 — credential, OAuth, and ad-account discovery.
 * No live Meta calls.
 */
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SHORT = "EAAShortLivedTokenValue";
const LONG = "EAATestLongLivedTokenValue";
const APP_SECRET = "meta-app-secret-test";
const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };

const registerMetaAdsM2Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Meta Ads M2 credential and OAuth");

  const metaGraph = () => require("../config/metaGraph");
  const ads = () => require("../services/workflowMetaAds.service");
  const oauth = () => require("../services/metaOAuth.service");
  const credentials = () => require("../modules/workflows/credentials.service");
  const validation = () => require("../modules/workflows/workflows.validation");
  const registry = () => require("../services/connectionRegistry.service");
  const { encryptSecret } = require("../services/secretBox.service");

  const metaFiles = [
    "services/workflowMetaAds.service.js",
    "services/metaOAuth.service.js",
  ];
  const readMeta = (rel) =>
    fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

  const withApp = async (fn) => {
    const prevId = process.env.META_APP_ID;
    const prevSecret = process.env.META_APP_SECRET;
    process.env.META_APP_ID = "meta-app-id";
    process.env.META_APP_SECRET = APP_SECRET;
    try {
      await fn();
    } finally {
      if (prevId == null) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = prevId;
      if (prevSecret == null) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = prevSecret;
    }
  };

  const secretFree = (value, ...needles) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const needle of needles) {
      assertX.equal(text.includes(needle), false);
    }
  };

  check("META-M2-1 meta_ads credential type exists", () => {
    const entry = registry().getSupportedPredefined("meta_ads");
    assertX.ok(entry);
    assertX.equal(entry.dbType, "meta_ads");
    assertX.equal(credentials().META_CREDENTIAL_TYPES.has("meta_ads"), true);
    const migration = fs.readFileSync(
      path.join(__dirname, "../migrations/026_meta_ads_credential.sql"),
      "utf8"
    );
    assertX.equal(migration.includes("'meta_ads'"), true);
    const types = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/types.ts"),
      "utf8"
    );
    assertX.equal(types.includes('"meta_ads"'), true);
  });

  check("META-M2-2 only approved read-only OAuth permissions requested", async () => {
    await withApp(async () => {
      const started = await oauth().startMetaOAuth(
        { workspaceId: "ws-1", name: "Meta Ads" },
        ADMIN
      );
      assertX.deepEqual(started.scopes, ["ads_read"]);
      assertX.deepEqual(metaGraph().OAUTH_SCOPES, ["ads_read"]);
      const url = new URL(started.url);
      assertX.equal(url.searchParams.get("scope"), "ads_read");
      assertX.equal(url.searchParams.get("response_type"), "code");
      assertX.equal(started.scopes.includes("ads_read"), true);
      assertX.equal(started.scopes.length, 1);
    });
  });

  check("META-M2-3 Meta API pinned to v26.0", () => {
    assertX.equal(metaGraph().API_VERSION, "v26.0");
    assertX.equal(
      metaGraph().graphBaseUrl(),
      "https://graph.facebook.com/v26.0"
    );
    assertX.equal(
      metaGraph().dialogUrl(),
      "https://www.facebook.com/v26.0/dialog/oauth"
    );
    for (const rel of metaFiles) {
      assertX.equal(readMeta(rel).includes("v26.0"), false);
    }
    assertX.equal(readMeta("services/googleOAuth.service.js").includes("graph.facebook.com"), false);
  });

  check("META-M2-4 short/long-lived token handling follows verified official behavior", async () => {
    await withApp(async () => {
      oauth().resetMetaOAuthNonceStore();
      let saved = null;
      const calls = [];
      await oauth().withMetaOAuthTestHooks(
        {
          now: () => Date.parse("2026-10-06T00:00:00Z"),
          insertCredential: async (row) => {
            saved = row;
          },
          transport: async (url) => {
            const u = new URL(url);
            const grant = u.searchParams.get("grant_type") || "";
            calls.push({
              path: u.pathname,
              grant,
              exchangedShort:
                grant === "fb_exchange_token"
                  ? u.searchParams.get("fb_exchange_token") === SHORT
                  : false,
            });
            if (u.pathname.endsWith("/oauth/access_token") && !grant) {
              return {
                ok: true,
                status: 200,
                body: { access_token: SHORT, expires_in: 3600 },
              };
            }
            if (grant === "fb_exchange_token") {
              return {
                ok: true,
                status: 200,
                body: { access_token: LONG, expires_in: 5184000 },
              };
            }
            if (u.pathname.endsWith("/debug_token")) {
              return {
                ok: true,
                status: 200,
                body: {
                  data: {
                    is_valid: true,
                    scopes: ["ads_read"],
                    user_id: "999",
                    expires_at: 1893456000,
                  },
                },
              };
            }
            if (u.pathname.endsWith("/me") && !u.pathname.endsWith("/me/adaccounts")) {
              return { ok: true, status: 200, body: { id: "999", name: "Meta User" } };
            }
            return { ok: false, status: 400, body: { error: { code: 100, message: "unexpected" } } };
          },
        },
        async () => {
          const started = await oauth().startMetaOAuth(
            { workspaceId: "ws-1", name: "Meta Ads" },
            ADMIN
          );
          const state = new URL(started.url).searchParams.get("state");
          await oauth().finishMetaOAuth("auth-code", state);
        }
      );
      assertX.equal(calls.filter((c) => c.grant === "fb_exchange_token").length, 1);
      assertX.equal(calls.some((c) => c.exchangedShort), true);
      assertX.equal(saved.secret.accessToken === LONG, true);
      assertX.equal(saved.secret.accessToken === SHORT, false);
      assertX.equal(saved.secret.tokenKind, "user_long_lived");
    });
  });

  check("META-M2-5 no Google-style refresh token assumptions", () => {
    for (const rel of metaFiles) {
      const text = readMeta(rel);
      assertX.equal(text.includes("refresh_token"), false);
      assertX.equal(text.includes("refreshToken"), false);
    }
    const secret = {
      accessToken: LONG,
      tokenKind: "user_long_lived",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    assertX.equal(Object.prototype.hasOwnProperty.call(secret, "refreshToken"), false);
  });

  check("META-M2-6 expiry metadata stored safely", async () => {
    await withApp(async () => {
      oauth().resetMetaOAuthNonceStore();
      let saved = null;
      const run = async (debugExpiry, expiresIn) => {
        saved = null;
        await oauth().withMetaOAuthTestHooks(
          {
            now: () => Date.parse("2026-10-06T00:00:00Z"),
            insertCredential: async (row) => {
              saved = row;
            },
            transport: async (url) => {
              const u = new URL(url);
              const grant = u.searchParams.get("grant_type") || "";
              if (u.pathname.endsWith("/oauth/access_token") && !grant) {
                return { ok: true, status: 200, body: { access_token: SHORT, expires_in: 3600 } };
              }
              if (grant === "fb_exchange_token") {
                return { ok: true, status: 200, body: { access_token: LONG, expires_in: expiresIn } };
              }
              if (u.pathname.endsWith("/debug_token")) {
                return {
                  ok: true,
                  status: 200,
                  body: { data: { scopes: ["ads_read"], expires_at: debugExpiry, user_id: "999" } },
                };
              }
              if (u.pathname.endsWith("/me") && !u.pathname.endsWith("/me/adaccounts")) {
                return { ok: true, status: 200, body: { id: "999", name: "Meta User" } };
              }
              return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
            },
          },
          async () => {
            const started = await oauth().startMetaOAuth(
              { workspaceId: "ws-1", name: "Meta Ads" },
              ADMIN
            );
            await oauth().finishMetaOAuth(
              "auth-code",
              new URL(started.url).searchParams.get("state")
            );
          }
        );
      };
      await run(1893456000, 5184000);
      assertX.equal(saved.secret.expiresAt, "2030-01-01T00:00:00.000Z");
      assertX.equal(saved.config.expiresAt, "2030-01-01T00:00:00.000Z");
      secretFree(saved.config, LONG, APP_SECRET);
      oauth().resetMetaOAuthNonceStore();
      await run(0, 0);
      assertX.equal(saved.secret.expiresAt, null);
      const life = oauth().reconnectState({ expiresAt: "2026-10-01T00:00:00.000Z" });
      assertX.equal(life.reconnectRequired, true);
    });
  });

  check("META-M2-7 /me connection test", async () => {
    const calls = [];
    const cred = {
      id: "cred-1",
      type: "meta_ads",
      workspaceId: "ws-1",
      name: "Meta Ads",
      secret: {
        accessToken: LONG,
        expiresAt: "2030-01-01T00:00:00.000Z",
        metaDisplayName: "Meta User",
      },
      config: {},
    };
    await withApp(async () => {
      await oauth().withMetaOAuthTestHooks(
        {
          now: () => Date.parse("2026-10-06T00:00:00Z"),
          loadCredential: async () => cred,
          transport: async (url) => {
            const u = new URL(url);
            calls.push({
              path: u.pathname,
              fields: u.searchParams.get("fields") || "",
              limit: u.searchParams.get("limit") || "",
            });
            if (u.pathname.endsWith("/me/adaccounts")) {
              return { ok: true, status: 200, body: { data: [] } };
            }
            if (u.pathname.endsWith("/me")) {
              return { ok: true, status: 200, body: { id: "999", name: "Meta User" } };
            }
            return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
          },
        },
        async () => {
          const result = await oauth().testMetaCredential("cred-1", ADMIN);
          assertX.equal(result.ok, true);
          assertX.equal(result.metaDisplayName, "Meta User");
          assertX.equal(result.apiVersion, "v26.0");
        }
      );
    });
    assertX.equal(calls[0].path.endsWith("/me"), true);
    assertX.equal(calls[0].fields, "id,name");
    assertX.equal(calls[1].path.endsWith("/me/adaccounts"), true);
    secretFree(calls, LONG);
  });

  check("META-M2-8 /me/adaccounts discovery", async () => {
    const calls = [];
    const cred = {
      id: "cred-1",
      type: "meta_ads",
      workspaceId: "ws-1",
      secret: { accessToken: LONG, expiresAt: "2030-01-01T00:00:00.000Z" },
      config: {},
    };
    let listed;
    await withApp(async () => {
      await oauth().withMetaOAuthTestHooks(
        {
          now: () => Date.parse("2026-10-06T00:00:00Z"),
          loadCredential: async () => cred,
          transport: async (url) => {
            const u = new URL(url);
            calls.push({
              path: u.pathname,
              fields: u.searchParams.get("fields") || "",
              after: u.searchParams.get("after") || "",
              followedNext: u.searchParams.get("access_token") === "EAASHOULDNOTFOLLOW",
            });
            if (calls.length === 1) {
              return {
                ok: true,
                status: 200,
                body: {
                  data: [
                    {
                      id: "act_123456789",
                      account_id: "123456789",
                      name: "Main",
                      account_status: 1,
                      currency: "USD",
                      timezone_name: "America/Los_Angeles",
                    },
                  ],
                  paging: {
                    cursors: { after: "cursor-1" },
                    next: "https://graph.facebook.com/v26.0/me/adaccounts?access_token=EAASHOULDNOTFOLLOW",
                  },
                },
              };
            }
            return { ok: true, status: 200, body: { data: [] } };
          },
        },
        async () => {
          listed = await oauth().listMetaAdAccounts("cred-1", ADMIN);
        }
      );
    });
    assertX.equal(calls.length, 2);
    assertX.equal(
      calls[0].fields,
      "id,account_id,name,account_status,currency,timezone_name"
    );
    assertX.equal(calls[1].after, "cursor-1");
    assertX.equal(calls.some((c) => c.followedNext), false);
    assertX.equal(listed.adAccounts[0].adAccountId, "123456789");
    secretFree(listed, LONG, "EAASHOULDNOTFOLLOW");
  });

  check("META-M2-9 account ids normalize numeric to act_ safely", () => {
    assertX.equal(ads().normalizeAdAccountId("act_123456789"), "123456789");
    assertX.equal(ads().normalizeAdAccountId("123456789"), "123456789");
    assertX.equal(ads().adAccountPath("123456789"), "act_123456789");
    assertX.equal(ads().adAccountPath("act_123456789"), "act_123456789");
    assertX.throws(() => ads().normalizeAdAccountId("act_12a"), (err) => {
      assertX.equal(err.code, "META_AD_ACCOUNT_REQUIRED");
      return true;
    });
  });

  check("META-M2-10 account name/currency/timezone/status preserved", () => {
    const row = ads().presentAdAccount({
      id: "act_555",
      account_id: "555",
      name: "Paused",
      account_status: 2,
      currency: "EUR",
      timezone_name: "Europe/London",
    });
    assertX.equal(row.name, "Paused");
    assertX.equal(row.currency, "EUR");
    assertX.equal(row.timezoneName, "Europe/London");
    assertX.equal(row.accountStatus, 2);
    assertX.equal(row.accountStatusLabel, "DISABLED");
    assertX.equal(ads().accountStatusLabel(1), "ACTIVE");
    assertX.equal(ads().accountStatusLabel(55), null);
    assertX.equal(row.adAccountId, "555");
  });

  check("META-M2-11 appsecret_proof computed server-side only if applicable", async () => {
    const cred = {
      id: "cred-1",
      type: "meta_ads",
      workspaceId: "ws-1",
      secret: { accessToken: LONG, expiresAt: "2030-01-01T00:00:00.000Z" },
      config: {},
    };
    let proof = "";
    let proofTime = "";
    await withApp(async () => {
      await ads().withMetaTestHooks(
        {
          now: () => 1700000000000,
          loadCredential: async () => cred,
          transport: async (url) => {
            const u = new URL(url);
            proof = u.searchParams.get("appsecret_proof") || "";
            proofTime = u.searchParams.get("appsecret_time") || "";
            return { ok: true, status: 200, body: { id: "999", name: "Meta User" } };
          },
        },
        async () => {
          await ads().metaGraphRequest({
            credentialId: "cred-1",
            workspaceId: "ws-1",
            path: "me",
            query: { fields: "id,name" },
          });
        }
      );
    });
    const expected = crypto
      .createHmac("sha256", APP_SECRET)
      .update(`${LONG}|${proofTime}`)
      .digest("hex");
    assertX.equal(proof, expected);
    assertX.equal(proofTime, "1700000000");
    assertX.equal(proof.includes(LONG), false);
  });

  check("META-M2-12 appsecret_proof not persisted", async () => {
    await withApp(async () => {
      oauth().resetMetaOAuthNonceStore();
      let saved = null;
      await oauth().withMetaOAuthTestHooks(
        {
          now: () => 1700000000000,
          insertCredential: async (row) => {
            saved = row;
          },
          transport: async (url) => {
            const u = new URL(url);
            const grant = u.searchParams.get("grant_type") || "";
            if (u.pathname.endsWith("/oauth/access_token") && !grant) {
              return { ok: true, status: 200, body: { access_token: SHORT, expires_in: 3600 } };
            }
            if (grant === "fb_exchange_token") {
              return { ok: true, status: 200, body: { access_token: LONG, expires_in: 100 } };
            }
            if (u.pathname.endsWith("/debug_token")) {
              return { ok: true, status: 200, body: { data: { scopes: ["ads_read"], expires_at: 1893456000 } } };
            }
            return { ok: true, status: 200, body: { id: "1", name: "Meta User" } };
          },
        },
        async () => {
          const started = await oauth().startMetaOAuth(
            { workspaceId: "ws-1", name: "Meta Ads" },
            ADMIN
          );
          await oauth().finishMetaOAuth("auth-code", new URL(started.url).searchParams.get("state"));
        }
      );
      const stored = JSON.stringify({ secret: saved.secret, config: saved.config });
      assertX.equal(stored.includes("appsecret_proof"), false);
      assertX.equal(stored.includes("appsecret_time"), false);
      assertX.equal(Object.prototype.hasOwnProperty.call(saved.secret, "appsecret_proof"), false);
    });
  });

  check("META-M2-13 access token encrypted", () => {
    const box = encryptSecret({ accessToken: LONG, tokenKind: "user_long_lived" });
    assertX.equal(box.startsWith("v1."), true);
    assertX.equal(box.includes(LONG), false);
  });

  check("META-M2-14 access token absent from normal credential API response", () => {
    const box = encryptSecret({ accessToken: LONG });
    const view = credentials().formatCredential({
      id: "cred-1",
      workspace_id: "ws-1",
      name: "Meta Ads",
      type: "meta_ads",
      created_by: "user-1",
      created_at: "2026-10-06",
      updated_at: "2026-10-06",
      secret_json: box,
      config_json: JSON.stringify({
        connected: true,
        metaDisplayName: "Meta User",
        metaUserId: "999",
        expiresAt: "2030-01-01T00:00:00.000Z",
        selectedAdAccountId: "123456789",
      }),
    });
    secretFree(view, LONG, APP_SECRET, "appsecret_proof");
    assertX.equal(view.metaDisplayName, "Meta User");
    assertX.equal(view.selectedAdAccountId, "123456789");
    assertX.equal(Object.prototype.hasOwnProperty.call(view, "accessToken"), false);
    const errors = validation().validateCredential({
      body: {
        workspaceId: "ws-1",
        name: "Meta Ads",
        type: "meta_ads",
        secret: { accessToken: LONG },
      },
    });
    assertX.equal(errors[0].includes("Connect with Meta"), true);
    secretFree(errors, LONG);
  });

  check("META-M2-15 access token absent from logs/errors", async () => {
    const logs = [];
    await withApp(async () => {
      oauth().resetMetaOAuthNonceStore();
      await oauth().withMetaOAuthTestHooks(
        {
          now: () => Date.parse("2026-10-06T00:00:00Z"),
          logger: (fields) => logs.push(fields),
          insertCredential: async () => {},
          transport: async (url) => {
            const u = new URL(url);
            const grant = u.searchParams.get("grant_type") || "";
            if (u.pathname.endsWith("/oauth/access_token") && !grant) {
              return { ok: true, status: 200, body: { access_token: SHORT, expires_in: 60 } };
            }
            if (grant === "fb_exchange_token") {
              return { ok: true, status: 200, body: { access_token: LONG, expires_in: 60 } };
            }
            if (u.pathname.endsWith("/debug_token")) {
              return { ok: true, status: 200, body: { data: { scopes: ["ads_read"], expires_at: 1893456000 } } };
            }
            return { ok: true, status: 200, body: { id: "1", name: "Meta User" } };
          },
        },
        async () => {
          const started = await oauth().startMetaOAuth(
            { workspaceId: "ws-1", name: "Meta Ads" },
            ADMIN
          );
          await oauth().finishMetaOAuth("auth-code", new URL(started.url).searchParams.get("state"));
        }
      );
    });
    secretFree(logs, LONG, SHORT, APP_SECRET, "auth-code");
    const err = ads().mapMetaError(400, {
      error: { code: 190, message: `bad token ${LONG} access_token=${LONG}` },
    });
    secretFree(err.message, LONG);
    assertX.equal(err.code, "META_TOKEN_INVALID");
  });

  check("META-M2-16 safe invalid-token error", async () => {
    const calls = [];
    await withApp(async () => {
      await oauth().withMetaOAuthTestHooks(
        {
          now: () => Date.parse("2026-10-06T00:00:00Z"),
          loadCredential: async () => ({
            id: "cred-1",
            type: "meta_ads",
            workspaceId: "ws-1",
            secret: { accessToken: LONG, expiresAt: "2026-10-01T00:00:00.000Z" },
            config: {},
          }),
          transport: async () => {
            calls.push("called");
            return { ok: true, status: 200, body: {} };
          },
        },
        async () => {
          await assertX.rejects(
            () => oauth().testMetaCredential("cred-1", ADMIN),
            (err) => {
              assertX.equal(err.code, "META_TOKEN_INVALID");
              secretFree(err.message, LONG);
              return true;
            }
          );
        }
      );
    });
    assertX.equal(calls.length, 0);
    const mapped = ads().mapMetaError(401, { error: { code: 190, message: "Error validating access token" } });
    assertX.equal(mapped.code, "META_TOKEN_INVALID");
  });

  check("META-M2-17 safe permission error", () => {
    const denied = ads().mapMetaError(403, {
      error: { code: 200, message: `permission missing ${LONG}` },
    });
    assertX.equal(denied.code, "META_PERMISSION_DENIED");
    secretFree(denied.message, LONG);
    const code10 = ads().mapMetaError(403, { error: { code: 10, message: "Application does not have permission" } });
    assertX.equal(code10.code, "META_PERMISSION_DENIED");
    const param = ads().mapMetaError(400, { error: { code: 100, message: "Invalid parameter" } });
    assertX.equal(param.code, "META_GRAPH_ERROR");
  });

  check("META-M2-18 safe rate-limit error", () => {
    for (const code of [4, 17, 32, 613]) {
      const err = ads().mapMetaError(429, {
        error: { code, message: `limit ${LONG}` },
      });
      assertX.equal(err.code, "META_RATE_LIMIT");
      assertX.equal(err.statusCode, 429);
      secretFree(err.message, LONG);
    }
    const version = ads().mapMetaError(400, { error: { code: 2635, message: "deprecated" } });
    assertX.equal(version.code, "META_API_VERSION");
  });

  check("META-M2-19 no ads_management scope", () => {
    for (const rel of metaFiles) {
      assertX.equal(readMeta(rel).includes("ads_management"), false);
    }
    const picker = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/components/workflows/params/MetaCredentialPanel.tsx"),
      "utf8"
    );
    assertX.equal(picker.includes("ads_management"), false);
    assertX.equal(metaGraph().OAUTH_SCOPES.join(","), "ads_read");
  });

  check("META-M2-20 no Meta mutation endpoint exists", async () => {
    for (const rel of metaFiles) {
      const text = readMeta(rel);
      assertX.equal(text.includes("/campaigns"), false);
      assertX.equal(text.includes("/adsets"), false);
      assertX.equal(text.includes("graph.facebook.com") && text.includes("POST"), false);
    }
    await assertX.rejects(
      () => ads().metaGraphRequest({ accessToken: LONG, path: "act_1/campaigns", method: "POST" }),
      (err) => {
        assertX.equal(err.code, "META_PERMISSION_DENIED");
        secretFree(err.message, LONG);
        return true;
      }
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
        console.error(`FAIL  ${name}\n      ${err.message}`);
        process.exitCode = 1;
      }
    });
  };
  const section = (name) => queue.push(async () => console.log(`\n${name}`));
  registerMetaAdsM2Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} checks passed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerMetaAdsM2Tests };
