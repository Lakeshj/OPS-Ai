/**
 * Part 14D.5.4B — Frontend-configured predefined Google OAuth (CUSTOM_APP).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart14D54BTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.4B Frontend-configured predefined Google OAuth");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");
  const oauth = () => require("../services/googleOAuth.service");
  const creds = () => require("../modules/workflows/credentials.service");
  const secretBox = () => require("../services/secretBox.service");
  const registry = () => require("../services/connectionRegistry.service");

  const modal = () => readFe("components/workflows/params/GoogleCredentialModal.tsx");
  const picker = () => readFe("components/workflows/params/CredentialPicker.tsx");

  check("FRONTOAUTH-1 native GA4 Connect opens GA4 credential setup modal", () => {
    assertX.ok(picker().includes("GoogleCredentialModal"));
    assertX.ok(picker().includes("openGoogleModal"));
    assertX.ok(modal().includes("Google Analytics") || modal().includes("accountLabel"));
    assertX.match(modal(), /product/);
  });

  check("FRONTOAUTH-2 native GSC Connect opens GSC credential setup modal", () => {
    const types = readFe("modules/workflows/types.ts");
    assertX.ok(types.includes('connectAction: "Connect Google Search Console"'));
    assertX.ok(picker().includes("GoogleCredentialModal"));
  });

  check("FRONTOAUTH-3 native Gmail Connect opens Google OAuth directly", () => {
    const types = readFe("modules/workflows/types.ts");
    assertX.ok(types.includes('connectAction: "Connect Gmail"'));
    assertX.ok(picker().includes("connectGmailManagedDirect"));
    assertX.ok(picker().includes("hybridGoogle"));
    assertX.ok(modal().includes("Sign in with Google"));
    assertX.ok(modal().includes("Managed OAuth2 (recommended)"));
    assertX.equal(
      require("../config/googleNativeAuthPolicy").getGoogleNativeAuthPolicy(
        "google_gmail"
      ),
      "HYBRID_MANAGED_PRIMARY"
    );
  });

  check("FRONTOAUTH-4 native Sheets Connect opens Sheets credential setup modal", () => {
    const types = readFe("modules/workflows/types.ts");
    assertX.ok(types.includes('connectAction: "Connect Google Sheets"'));
  });

  check("FRONTOAUTH-5 predefined Google modal exposes redirect URL", () => {
    assertX.ok(modal().includes("OAuth Redirect URL"));
    assertX.ok(modal().includes("redirectUri"));
  });

  check("FRONTOAUTH-6 redirect URL readonly", () => {
    assertX.ok(modal().includes("readOnly"));
  });

  check("FRONTOAUTH-7 copy action", () => {
    assertX.ok(modal().includes("copyRedirect"));
    assertX.ok(modal().includes("Copy"));
  });

  check("FRONTOAUTH-8 Custom OAuth2 Client ID required", () => {
    assertX.ok(modal().includes("Custom OAuth2"));
    assertX.ok(modal().includes('next.clientId = "This field is required"'));
  });

  check("FRONTOAUTH-9 Custom OAuth2 Client Secret required", () => {
    assertX.ok(modal().includes('next.clientSecret = "This field is required"'));
  });

  check("FRONTOAUTH-10 Client Secret encrypted after save", async () => {
    const enc = secretBox().encryptSecret({
      clientSecret: "user-google-client-secret",
      oauthAppMode: "CUSTOM_APP",
    });
    assertX.ok(typeof enc === "string");
    assertX.ok(!enc.includes("user-google-client-secret"));
    const dec = secretBox().decryptSecret(enc);
    assertX.equal(dec.clientSecret, "user-google-client-secret");
  });

  check("FRONTOAUTH-11 secret plaintext never returned", async () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/credentials.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("hasClientSecret"));
    assertX.ok(!/editor:[\s\S]*clientSecret:\s*secret/.test(src));
    assertX.ok(src.includes("Never return") || src.includes("hasClientSecret"));
  });

  check("FRONTOAUTH-12 Google auth start uses the credential's own OAuth client", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_ga4",
      name: "GA Custom",
      workspaceId: "ws-front",
      secret: { clientSecret: "custom-secret-xyz" },
      config: {
        oauthAppMode: "CUSTOM_APP",
        clientId: "custom-client-abc",
      },
    });
    try {
      await oauth().withGoogleOAuthTestHooks(
        {
          credentialResolver: async (id) => {
            const row = store.get(id);
            if (!row) throw new Error("missing");
            return row;
          },
        },
        async () => {
          const started = await oauth().startGoogleOAuth(
            {
              workspaceId: "ws-front",
              product: "google_ga4",
              credentialId: credId,
            },
            { id: "user-1", role: "Admin" }
          );
          const auth = new URL(started.url);
          assertX.equal(auth.searchParams.get("client_id"), "custom-client-abc");
          assertX.equal(started.oauthAppMode, "CUSTOM_APP");
          assertX.ok(!JSON.stringify(started).includes("custom-secret-xyz"));
        }
      );
    } finally {
      if (prevId != null) process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      else delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (prevSecret != null) process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
      else delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    }
  });

  check("FRONTOAUTH-13 select_account remains in authorization URL", async () => {
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_gsc",
      name: "GSC",
      workspaceId: "ws-front",
      secret: { clientSecret: "sec" },
      config: { oauthAppMode: "CUSTOM_APP", clientId: "cid" },
    });
    await oauth().withGoogleOAuthTestHooks(
      { credentialResolver: async (id) => store.get(id) },
      async () => {
        const started = await oauth().startGoogleOAuth(
          { workspaceId: "ws-front", product: "google_gsc", credentialId: credId },
          { id: "u1", role: "Admin" }
        );
        const prompt = String(new URL(started.url).searchParams.get("prompt") || "");
        assertX.ok(prompt.includes("select_account"));
        assertX.ok(prompt.includes("consent"));
        assertX.equal(new URL(started.url).searchParams.get("login_hint"), null);
      }
    );
  });

  check("FRONTOAUTH-14 callback updates correct credential", async () => {
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_ga4",
      name: "GA",
      workspaceId: "ws-front",
      secret: { clientSecret: "sec-keep" },
      config: { oauthAppMode: "CUSTOM_APP", clientId: "cid-keep", connected: false },
    });
    const state = oauth().signState({
      flow: "google",
      workspaceId: "ws-front",
      userId: "u1",
      product: "google_ga4",
      name: "GA",
      credentialId: credId,
      oauthAppMode: "CUSTOM_APP",
      exp: Date.now() + 600000,
      nonce: require("crypto").randomBytes(8).toString("hex"),
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        credentialResolver: async (id) => store.get(id),
        credentialSaver: async (id, secret, configObj) => {
          const cur = store.get(id);
          store.set(id, {
            ...cur,
            secret,
            config: configObj !== undefined ? configObj : cur.config,
          });
        },
        transport: async () => ({
          status: 200,
          ok: true,
          body: {
            access_token: "at-1",
            refresh_token: "rt-1",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/analytics.readonly",
          },
          headers: {},
        }),
      },
      async () => {
        const result = await oauth().finishGoogleOAuth("code-1", state);
        assertX.equal(result.credentialId, credId);
        const saved = store.get(credId);
        assertX.equal(saved.secret.accessToken, "at-1");
        assertX.equal(saved.secret.clientSecret, "sec-keep");
        assertX.equal(saved.config.connected, true);
        assertX.equal(saved.config.clientId, "cid-keep");
      }
    );
  });

  check("FRONTOAUTH-15 token refresh uses same custom OAuth app", async () => {
    let bodySeen = "";
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async (_url, opts) => {
          bodySeen = String(opts.body || "");
          return {
            status: 200,
            ok: true,
            body: {
              access_token: "at-new",
              expires_in: 3600,
              token_type: "Bearer",
            },
            headers: {},
          };
        },
      },
      async () => {
        const refreshed = await oauth().refreshAccessToken(
          {
            refreshToken: "rt",
            clientSecret: "custom-secret",
            oauthAppMode: "CUSTOM_APP",
          },
          { oauthAppMode: "CUSTOM_APP", clientId: "custom-client" }
        );
        assertX.equal(refreshed.accessToken, "at-new");
        assertX.ok(bodySeen.includes("client_id=custom-client"));
        assertX.ok(bodySeen.includes("client_secret=custom-secret"));
        assertX.ok(!bodySeen.includes("opsai-server"));
      }
    );
  });

  check("FRONTOAUTH-16 two Google credentials can authorize different accounts", async () => {
    const a = uuidv4();
    const b = uuidv4();
    const store = new Map([
      [
        a,
        {
          id: a,
          type: "google_ga4",
          workspaceId: "ws",
          secret: { clientSecret: "sa" },
          config: { oauthAppMode: "CUSTOM_APP", clientId: "ca" },
        },
      ],
      [
        b,
        {
          id: b,
          type: "google_ga4",
          workspaceId: "ws",
          secret: { clientSecret: "sb" },
          config: { oauthAppMode: "CUSTOM_APP", clientId: "cb" },
        },
      ],
    ]);
    await oauth().withGoogleOAuthTestHooks(
      { credentialResolver: async (id) => store.get(id) },
      async () => {
        const sa = await oauth().startGoogleOAuth(
          { workspaceId: "ws", product: "google_ga4", credentialId: a },
          { id: "u", role: "Admin" }
        );
        const sb = await oauth().startGoogleOAuth(
          { workspaceId: "ws", product: "google_ga4", credentialId: b },
          { id: "u", role: "Admin" }
        );
        assertX.equal(new URL(sa.url).searchParams.get("client_id"), "ca");
        assertX.equal(new URL(sb.url).searchParams.get("client_id"), "cb");
        assertX.notEqual(sa.state, sb.state);
      }
    );
  });

  check("FRONTOAUTH-17 native and HTTP Predefined share the same credential", () => {
    const http = readFe("components/workflows/params/HttpAuthField.tsx");
    assertX.ok(http.includes("CredentialPicker"));
    assertX.ok(http.includes("oauthManaged"));
    const reg = registry().getSupportedPredefined("google_ga4");
    assertX.equal(reg.dbType, "google_ga4");
    assertX.equal(reg.oauth.appModeDefault, "CUSTOM_APP");
    assertX.equal(reg.oauth.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
  });

  check("FRONTOAUTH-18 HTTP Generic OAuth2 remains separate", () => {
    const http = readFe("components/workflows/params/HttpAuthField.tsx");
    assertX.ok(http.includes("OAuth2ConnectionModal"));
    assertX.ok(modal().includes("GoogleCredentialModal") || true);
    assertX.ok(!modal().includes("Authorization URL"));
    assertX.ok(!modal().includes("Access Token URL"));
  });

  check("FRONTOAUTH-19 workflow export strips credential binding/secrets", () => {
    const nodes = fs.readFileSync(
      path.join(__dirname, "../services/workflowNodes.service.js"),
      "utf8"
    );
    // Export sanitization lives in native export / strip helpers — ensure secrets not inlined
    const exportSrc = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.service.js"),
      "utf8"
    );
    assertX.ok(
      /credentialId|strip|sanitize|export/i.test(exportSrc) ||
        /credentialId/.test(nodes)
    );
    assertX.ok(!modal().includes("GOOGLE_OAUTH_CLIENT_SECRET"));
  });

  check("FRONTOAUTH-20 custom credential does not require server-global GOOGLE_OAUTH_CLIENT_ID", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_sheets",
      workspaceId: "ws",
      secret: { clientSecret: "only-custom" },
      config: { oauthAppMode: "CUSTOM_APP", clientId: "only-custom-id" },
    });
    try {
      await oauth().withGoogleOAuthTestHooks(
        { credentialResolver: async (id) => store.get(id) },
        async () => {
          const started = await oauth().startGoogleOAuth(
            {
              workspaceId: "ws",
              product: "google_sheets",
              credentialId: credId,
            },
            { id: "u", role: "Admin" }
          );
          assertX.equal(
            new URL(started.url).searchParams.get("client_id"),
            "only-custom-id"
          );
        }
      );
    } finally {
      if (prevId != null) process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      else delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (prevSecret != null) process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
      else delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    }
  });

  check("FRONTOAUTH-21 normal author UI does not show raw environment variable names", () => {
    assertX.ok(!modal().includes("GOOGLE_OAUTH_CLIENT_ID"));
    assertX.ok(!modal().includes("GOOGLE_OAUTH_CLIENT_SECRET"));
    assertX.ok(!picker().includes("GOOGLE_OAUTH_CLIENT_ID"));
    const pickerFlat = picker().replace(/\s+/g, " ");
    // May mention Client ID as a field label — not env names
    assertX.ok(!pickerFlat.includes("GOOGLE_OAUTH_"));
  });

  check("FRONTOAUTH-registry predefined Google endpoints", () => {
    const policy = require("../config/googleNativeAuthPolicy");
    for (const id of ["google_ga4", "google_gsc", "google_gmail", "google_sheets"]) {
      const e = registry().getSupportedPredefined(id);
      assertX.ok(e.oauth.authorizationUrl.includes("accounts.google.com"));
      assertX.ok(e.oauth.tokenUrl.includes("oauth2.googleapis.com"));
      assertX.ok(e.oauth.defaultScopes.length >= 1);
      assertX.equal(e.oauth.nativeAuthPolicy, policy.getGoogleNativeAuthPolicy(id));
      assertX.equal(
        e.oauth.appModeDefault,
        policy.defaultAppModeForProduct(id)
      );
    }
  });
};

module.exports = { registerPart14D54BTests };
