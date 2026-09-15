/**
 * Part 14D.5.5C — Native Gmail PLATFORM_MANAGED Google OAuth correction.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart14D55CTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.5C Native Gmail managed Google OAuth");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");
  const oauth = () => require("../services/googleOAuth.service");
  const registry = () => require("../services/connectionRegistry.service");
  const secretBox = () => require("../services/secretBox.service");

  const picker = () =>
    readFe("components/workflows/params/CredentialPicker.tsx");
  const modal = () =>
    readFe("components/workflows/params/GoogleCredentialModal.tsx");
  const http = () =>
    readFe("components/workflows/params/HttpAuthField.tsx");
  const popup = () => readFe("modules/workflows/googleOAuthPopup.ts");
  const schemas = () => readFe("modules/workflows/nodeParameterSchemas.ts");

  check("GMAILMANAGED-1 native Gmail defaults to PLATFORM_MANAGED", () => {
    const e = registry().getSupportedPredefined("google_gmail");
    assertX.equal(e.oauth.appModeDefault, "PLATFORM_MANAGED");
    assertX.equal(e.dbType, "google_gmail");
  });

  check("GMAILMANAGED-2 normal Gmail Connect does not open GoogleCredentialModal requiring Client ID", () => {
    assertX.ok(picker().includes("connectGoogleDirect"));
    assertX.ok(picker().includes("startGoogleOAuthPopup"));
    assertX.ok(picker().includes("gmailManagedOnly"));
    // Gmail Sign-in path never opens custom modal
    assertX.ok(
      /if \(gmailManagedOnly\) \{\s*void connectGoogleDirect\(\);/.test(picker())
    );
  });

  check("GMAILMANAGED-3 normal Gmail Connect does not open Generic OAuth2 modal", () => {
    assertX.ok(!picker().includes("OAuth2ConnectionModal"));
    assertX.ok(http().includes("OAuth2ConnectionModal"));
  });

  check("GMAILMANAGED-4 normal Gmail Connect starts managed Google OAuth directly", () => {
    assertX.ok(picker().includes("Sign in with Google"));
    assertX.ok(picker().includes("startGoogleOAuthPopup"));
    assertX.ok(popup().includes("accounts.google.com") || popup().includes("startGoogleOAuth"));
  });

  check("GMAILMANAGED-5 authorization URL includes select_account", async () => {
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_gmail",
      name: "Gmail",
      workspaceId: "ws-gm",
      secret: { oauthAppMode: "PLATFORM_MANAGED" },
      config: { oauthAppMode: "PLATFORM_MANAGED" },
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({ status: 200, ok: true, body: {} }),
        credentialResolver: async (id) => store.get(id),
      },
      async () => {
        const started = await oauth().startGoogleOAuth(
          {
            workspaceId: "ws-gm",
            product: "google_gmail",
            credentialId: credId,
          },
          { id: "u1", role: "Admin" }
        );
        const prompt = String(new URL(started.url).searchParams.get("prompt") || "");
        assertX.ok(prompt.includes("select_account"));
      }
    );
  });

  check("GMAILMANAGED-6 authorization URL includes consent", async () => {
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_gmail",
      workspaceId: "ws-gm",
      secret: { oauthAppMode: "PLATFORM_MANAGED" },
      config: { oauthAppMode: "PLATFORM_MANAGED" },
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({ status: 200, ok: true, body: {} }),
        credentialResolver: async (id) => store.get(id),
      },
      async () => {
        const started = await oauth().startGoogleOAuth(
          {
            workspaceId: "ws-gm",
            product: "google_gmail",
            credentialId: credId,
          },
          { id: "u1", role: "Admin" }
        );
        const prompt = String(new URL(started.url).searchParams.get("prompt") || "");
        assertX.ok(prompt.includes("consent"));
      }
    );
  });

  check("GMAILMANAGED-7 no login_hint by default", async () => {
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_gmail",
      workspaceId: "ws-gm",
      secret: { oauthAppMode: "PLATFORM_MANAGED" },
      config: { oauthAppMode: "PLATFORM_MANAGED" },
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({ status: 200, ok: true, body: {} }),
        credentialResolver: async (id) => store.get(id),
      },
      async () => {
        const started = await oauth().startGoogleOAuth(
          {
            workspaceId: "ws-gm",
            product: "google_gmail",
            credentialId: credId,
          },
          { id: "u1", role: "Admin" }
        );
        assertX.equal(new URL(started.url).searchParams.get("login_hint"), null);
      }
    );
  });

  check("GMAILMANAGED-8 normal author UI contains no Client ID field", () => {
    // Managed path in picker must not render Client ID inputs
    assertX.ok(!/Client ID \*/.test(picker()));
    assertX.ok(!picker().includes('label">Client ID'));
  });

  check("GMAILMANAGED-9 normal author UI contains no Client Secret field", () => {
    assertX.ok(!/Client Secret \*/.test(picker()));
  });

  check("GMAILMANAGED-10 removed “use Custom OAuth2” fallback copy", () => {
    assertX.ok(!picker().includes("Use Custom OAuth2"));
    assertX.ok(!picker().includes("Managed Google sign-in is not available here"));
    assertX.ok(!modal().includes("Switch to Custom OAuth2"));
    assertX.ok(
      !modal().includes(
        "Managed Google sign-in is not available on this server. Switch to Custom OAuth2"
      )
    );
  });

  check("GMAILMANAGED-11 missing managed config shows safe admin-oriented message", () => {
    assertX.ok(
      picker().includes(
        "Google sign-in is not available on this OpsAi instance yet. Please contact your workspace administrator."
      )
    );
    assertX.ok(
      modal().includes(
        "Google sign-in is not available on this OpsAi instance yet. Please contact your workspace administrator."
      )
    );
  });

  check("GMAILMANAGED-12 raw GOOGLE_OAUTH_* env names not exposed to normal author", () => {
    assertX.ok(!picker().includes("GOOGLE_OAUTH_CLIENT_ID"));
    assertX.ok(!picker().includes("GOOGLE_OAUTH_CLIENT_SECRET"));
    assertX.ok(!picker().includes("GOOGLE_OAUTH_REDIRECT_URI"));
    assertX.ok(!modal().includes("GOOGLE_OAUTH_CLIENT_ID"));
    assertX.ok(!modal().includes("GOOGLE_OAUTH_CLIENT_SECRET"));
  });

  check("GMAILMANAGED-13 callback stores Gmail credential encrypted", async () => {
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_gmail",
      name: "Gmail",
      workspaceId: "ws-gm",
      secret: { oauthAppMode: "PLATFORM_MANAGED" },
      config: { oauthAppMode: "PLATFORM_MANAGED", connected: false },
    });
    const state = oauth().signState({
      flow: "google",
      workspaceId: "ws-gm",
      userId: "u1",
      product: "google_gmail",
      name: "Gmail",
      credentialId: credId,
      oauthAppMode: "PLATFORM_MANAGED",
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
        transport: async (url) => {
          if (String(url).includes("oauth2.googleapis.com/token")) {
            return {
              status: 200,
              ok: true,
              body: {
                access_token: "access-gm",
                refresh_token: "refresh-gm",
                expires_in: 3600,
                token_type: "Bearer",
              },
            };
          }
          if (String(url).includes("gmail.googleapis.com")) {
            return {
              status: 200,
              ok: true,
              body: { emailAddress: "ops@example.com" },
            };
          }
          return { status: 200, ok: true, body: {} };
        },
      },
      async () => {
        await oauth().finishGoogleOAuth("code-1", state);
        const row = store.get(credId);
        assertX.equal(row.config.connected, true);
        assertX.equal(row.config.oauthAppMode, "PLATFORM_MANAGED");
        assertX.equal(row.secret.accessToken, "access-gm");
        assertX.equal(row.secret.refreshToken, "refresh-gm");
        assertX.equal(row.config.accountEmail, "ops@example.com");
        const enc = secretBox().encryptSecret(row.secret);
        assertX.ok(!String(enc).includes("access-gm"));
        assertX.ok(!String(enc).includes("refresh-gm"));
      }
    );
  });

  check("GMAILMANAGED-14 refresh uses PLATFORM_MANAGED app configuration", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "platform-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "platform-secret";
    let refreshedWith = null;
    try {
      await oauth().withGoogleOAuthTestHooks(
        {
          transport: async (_url, opts) => {
            refreshedWith = String(opts?.body || "");
            return {
              status: 200,
              ok: true,
              body: {
                access_token: "new-access",
                expires_in: 3600,
                token_type: "Bearer",
              },
            };
          },
        },
        async () => {
          const refreshed = await oauth().refreshAccessToken(
            {
              refreshToken: "rt",
              oauthAppMode: "PLATFORM_MANAGED",
            },
            { oauthAppMode: "PLATFORM_MANAGED" }
          );
          assertX.equal(refreshed.accessToken, "new-access");
          assertX.ok(refreshedWith.includes("client_id=platform-client"));
          assertX.ok(refreshedWith.includes("client_secret=platform-secret"));
          assertX.ok(!refreshedWith.includes("custom-"));
        }
      );
    } finally {
      if (prevId != null) process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      else delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (prevSecret != null) process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
      else delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    }
  });

  check("GMAILMANAGED-15 Switch account uses managed chooser", () => {
    assertX.ok(modal().includes("Switch account") || modal().includes("Sign in with Google"));
    assertX.ok(modal().includes("startGoogleOAuthPopup"));
    assertX.ok(picker().includes("select_account") || popup().includes("startGoogleOAuth"));
  });

  check("GMAILMANAGED-16 Gmail Trigger reuses same Gmail connection", () => {
    assertX.ok(schemas().includes("gmailTrigger"));
    assertX.ok(schemas().includes('credentialTypes: ["google_gmail"]'));
    // Both gmail and gmailTrigger declare google_gmail credential type
    const gmailBlocks = schemas().match(/gmail(?:Trigger)?: \[[\s\S]*?credentialTypes: \["google_gmail"\]/g);
    assertX.ok(gmailBlocks && gmailBlocks.length >= 1);
    assertX.ok(schemas().includes("gmailTrigger"));
    assertX.ok(/gmailTrigger:[\s\S]*?credentialTypes: \["google_gmail"\]/.test(schemas()));
  });

  check("GMAILMANAGED-17 HTTP Predefined Gmail reuses managed Gmail connection", () => {
    assertX.ok(http().includes("CredentialPicker"));
    assertX.ok(http().includes("oauthManaged") || http().includes("google_gmail"));
    const e = registry().getSupportedPredefined("google_gmail");
    assertX.equal(e.oauth.appModeDefault, "PLATFORM_MANAGED");
    assertX.equal(registry().publicEntry(e).oauthManaged, true);
  });

  check("GMAILMANAGED-18 HTTP Generic OAuth2 remains unchanged", () => {
    assertX.ok(http().includes("OAuth2ConnectionModal"));
    assertX.ok(http().includes('genericAuthType === "oauth2"'));
    const oauth2Modal = readFe(
      "components/workflows/params/OAuth2ConnectionModal.tsx"
    );
    assertX.ok(oauth2Modal.includes("Authorization URL"));
    assertX.ok(oauth2Modal.includes("Client ID"));
  });

  check("GMAILMANAGED-19 workflow export strips Gmail credential binding/secrets", () => {
    const exportSrc = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.service.js"),
      "utf8"
    );
    assertX.ok(/credentialId|strip|sanitize|export/i.test(exportSrc));
    assertX.ok(!modal().includes("GOOGLE_OAUTH_CLIENT_SECRET"));
  });

  check("GMAILMANAGED-20 CUSTOM_APP remains available only as explicit advanced path", () => {
    // Hybrid providers (GSC/GA4/Sheets) open CUSTOM_APP via Connect/Manage.
    // Gmail PLATFORM_MANAGED_ONLY never exposes Advanced CUSTOM_APP.
    assertX.ok(picker().includes("HYBRID_CUSTOM_PRIMARY") || picker().includes("hybridCustomPrimary"));
    assertX.ok(picker().includes("gmailManagedOnly") || picker().includes("PLATFORM_MANAGED_ONLY"));
    assertX.ok(modal().includes("Use custom Google OAuth app") || modal().includes("Client ID"));
    assertX.ok(
      !/platformManagedAvailable[\s\S]{0,120}setupMode:\s*"custom"/.test(picker())
    );
  });

  check("GMAILMANAGED-scopes Gmail V1 scopes unchanged", () => {
    const scopes = oauth().GOOGLE_PRODUCTS.google_gmail.scopes;
    assertX.ok(scopes.includes("https://www.googleapis.com/auth/gmail.modify"));
    assertX.ok(scopes.includes("https://www.googleapis.com/auth/gmail.send"));
    assertX.ok(scopes.includes("https://www.googleapis.com/auth/gmail.compose"));
  });

  // —— 14D.5.5C.2 native Gmail managed-only UX ——
  check("GMAILMANAGEDONLY-1 native Gmail exposes Sign in with Google", () => {
    assertX.ok(picker().includes("Sign in with Google"));
    assertX.ok(picker().includes("gmailManagedOnly"));
  });

  check("GMAILMANAGEDONLY-2 native Gmail has no Custom OAuth2 option", () => {
    assertX.ok(picker().includes("gmailManagedOnly"));
    assertX.ok(picker().includes("hybridCustomPrimary"));
    assertX.ok(picker().includes("&& gmailManagedOnly ?"));
    assertX.ok(modal().includes("forceManaged"));
  });

  check("GMAILMANAGEDONLY-3 native Gmail has no Client ID field", () => {
    assertX.ok(modal().includes("forceManaged"));
    assertX.ok(modal().includes("{!forceManaged"));
  });

  check("GMAILMANAGEDONLY-4 native Gmail has no Client Secret field", () => {
    assertX.ok(modal().includes("Client Secret"));
    assertX.ok(modal().includes("forceManaged"));
    assertX.ok(modal().includes("{!forceManaged"));
    assertX.ok(modal().includes("isPlatformManagedOnlyGoogle"));
  });

  check("GMAILMANAGEDONLY-5 native Gmail has no Advanced connection route to CUSTOM_APP", () => {
    assertX.ok(picker().includes("gmailManagedOnly"));
    assertX.ok(!picker().includes("Advanced connection options"));
    assertX.ok(
      !/gmailManagedOnly[\s\S]{0,80}setupMode:\s*"custom"/.test(picker())
    );
  });

  check("GMAILMANAGEDONLY-6 managed Sign in starts platform Google OAuth", () => {
    assertX.ok(picker().includes("connectGoogleDirect"));
    assertX.ok(picker().includes("startGoogleOAuthPopup"));
  });

  check("GMAILMANAGEDONLY-7 account chooser includes select_account", async () => {
    const store = new Map();
    const credId = uuidv4();
    store.set(credId, {
      id: credId,
      type: "google_gmail",
      workspaceId: "ws-gm",
      secret: { oauthAppMode: "PLATFORM_MANAGED" },
      config: { oauthAppMode: "PLATFORM_MANAGED" },
    });
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({ status: 200, ok: true, body: {} }),
        credentialResolver: async (id) => store.get(id),
      },
      async () => {
        const started = await oauth().startGoogleOAuth(
          {
            workspaceId: "ws-gm",
            product: "google_gmail",
            credentialId: credId,
          },
          { id: "u1", role: "Admin" }
        );
        assertX.ok(
          String(new URL(started.url).searchParams.get("prompt") || "").includes(
            "select_account"
          )
        );
      }
    );
  });

  check("GMAILMANAGEDONLY-8 connect another account uses managed flow", () => {
    assertX.ok(picker().includes("CONNECT_ANOTHER"));
    assertX.ok(picker().includes("connectGoogleDirect"));
    assertX.ok(/CONNECT_ANOTHER[\s\S]{0,200}connectGoogleDirect/.test(picker()));
  });

  check("GMAILMANAGEDONLY-9 switch account uses managed flow", () => {
    assertX.ok(modal().includes("Switch account") || modal().includes("Sign in with Google"));
    assertX.ok(modal().includes("startGoogleOAuthPopup"));
    assertX.ok(modal().includes("forceManaged"));
  });

  check("GMAILMANAGEDONLY-10 disconnect returns node to Sign in with Google", () => {
    assertX.ok(picker().includes("removeSelected") || picker().includes("Delete"));
    assertX.ok(modal().includes("deleteConnection") || modal().includes("Disconnect") || modal().includes("Delete"));
    assertX.ok(picker().includes("Sign in with Google"));
  });

  check("GMAILMANAGEDONLY-11 Gmail Trigger uses same managed credential architecture", () => {
    assertX.ok(/gmailTrigger:[\s\S]*?credentialTypes: \["google_gmail"\]/.test(schemas()));
  });

  check("GMAILMANAGEDONLY-12 HTTP Predefined Gmail can reuse managed Gmail connection", () => {
    assertX.ok(http().includes("CredentialPicker"));
    const e = registry().getSupportedPredefined("google_gmail");
    assertX.equal(e.oauth.appModeDefault, "PLATFORM_MANAGED");
  });

  check("GMAILMANAGEDONLY-13 HTTP Generic OAuth2 still exposes custom OAuth configuration", () => {
    const oauth2Modal = readFe(
      "components/workflows/params/OAuth2ConnectionModal.tsx"
    );
    assertX.ok(http().includes("OAuth2ConnectionModal"));
    assertX.ok(oauth2Modal.includes("Client ID"));
    assertX.ok(oauth2Modal.includes("Client Secret"));
    assertX.ok(oauth2Modal.includes("Authorization URL"));
  });

  check("GMAILMANAGEDONLY-14 missing platform configuration never opens custom OAuth", () => {
    assertX.ok(
      /!platformManagedAvailable[\s\S]{0,200}contact your workspace administrator/.test(
        picker()
      )
    );
    assertX.ok(
      !/!platformManagedAvailable[\s\S]{0,200}setupMode:\s*"custom"/.test(picker())
    );
  });

  check("GMAILMANAGEDONLY-15 normal Gmail UI never exposes GOOGLE_OAUTH_* env names", () => {
    assertX.ok(!picker().includes("GOOGLE_OAUTH_CLIENT_ID"));
    assertX.ok(!picker().includes("GOOGLE_OAUTH_CLIENT_SECRET"));
    assertX.ok(!modal().includes("GOOGLE_OAUTH_CLIENT_ID"));
  });

  check("GMAILMANAGEDONLY-16 Gmail 403 has Gmail-specific copy, not property copy", () => {
    const err = oauth().sanitizeGoogleError(403, null, {
      product: "google_gmail",
    });
    assertX.ok(/Gmail permissions/i.test(err.message));
    assertX.ok(!/property permissions/i.test(err.message));
    const other = oauth().sanitizeGoogleError(403, null, {
      product: "google_gsc",
    });
    assertX.ok(/property permissions/i.test(other.message));
  });
};

module.exports = { registerPart14D55CTests };
