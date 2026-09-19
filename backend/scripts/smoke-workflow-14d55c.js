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
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_MANAGED_PRIMARY");
    assertX.equal(e.dbType, "google_gmail");
  });

  check("GMAILMANAGED-2 normal Gmail Connect opens Google OAuth directly", () => {
    assertX.ok(picker().includes("connectGmailManagedDirect"));
    assertX.ok(picker().includes("startGoogleOAuthPopup"));
    assertX.ok(modal().includes("Managed OAuth2 (recommended)"));
  });

  check("GMAILMANAGED-3 normal Gmail Connect does not open Generic OAuth2 modal", () => {
    assertX.ok(!picker().includes("OAuth2ConnectionModal"));
    assertX.ok(http().includes("OAuth2ConnectionModal"));
  });

  check("GMAILMANAGED-4 normal Gmail Connect starts managed Google OAuth directly", () => {
    assertX.ok(picker().includes("connectGmailManagedDirect"));
    assertX.ok(picker().includes("startGoogleOAuthPopup"));
    assertX.ok(popup().includes("accounts.google.com") || popup().includes("startGoogleOAuth"));
    // Fresh connect must not reuse an old credential id
    assertX.ok(
      /connectGmailManagedDirect[\s\S]*?omit credentialId|Important: omit credentialId/.test(
        picker()
      )
    );
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
    assertX.ok(!/Client ID \*/.test(picker()));
    assertX.ok(modal().includes("forceManaged"));
    assertX.ok(modal().includes("{!forceManaged"));
  });

  check("GMAILMANAGED-9 normal author UI contains no Client Secret field", () => {
    assertX.ok(!/Client Secret \*/.test(picker()));
    assertX.ok(modal().includes("{!forceManaged"));
  });

  check("GMAILMANAGED-10 removed “use Custom OAuth2” fallback copy", () => {
    assertX.ok(!picker().includes("Use Custom OAuth2"));
    assertX.ok(!picker().includes("Managed Google sign-in is not available here"));
    assertX.ok(!modal().includes("Switch to Custom OAuth2"));
  });

  check("GMAILMANAGED-11 missing managed config warns inside Manage modal", () => {
    assertX.ok(
      modal().includes(
        "Google sign-in is not available on this OpsAi instance yet. Please contact your workspace administrator."
      )
    );
    assertX.ok(modal().includes("platformManagedAvailable"));
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
          assertX.ok(/client_id=/.test(refreshedWith));
          assertX.ok(/client_secret=/.test(refreshedWith));
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
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_MANAGED_PRIMARY");
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

  check("GMAILMANAGED-20 Gmail Manage offers Managed and Custom OAuth2", () => {
    assertX.ok(picker().includes("hybridGoogle"));
    assertX.equal(
      require("../config/googleNativeAuthPolicy").getGoogleNativeAuthPolicy(
        "google_gmail"
      ),
      "HYBRID_MANAGED_PRIMARY"
    );
    assertX.ok(modal().includes("Managed OAuth2 (recommended)"));
    assertX.ok(modal().includes("Custom OAuth2"));
    assertX.ok(modal().includes("Service Account"));
  });

  check("GMAILMANAGED-scopes Gmail V1 scopes unchanged", () => {
    const scopes = oauth().GOOGLE_PRODUCTS.google_gmail.scopes;
    assertX.ok(scopes.includes("https://www.googleapis.com/auth/gmail.modify"));
    assertX.ok(scopes.includes("https://www.googleapis.com/auth/gmail.send"));
    assertX.ok(scopes.includes("https://www.googleapis.com/auth/gmail.compose"));
  });

  check("GMAILMANAGED-permissions stay on Google consent (no in-node toggles)", () => {
    assertX.ok(!picker().includes("GmailPermissionsPanel"));
    assertX.ok(!modal().includes("GmailPermissionsPanel"));
    assertX.ok(
      !fs.existsSync(
        path.join(
          __dirname,
          "../../frontend/src/components/workflows/params/GmailPermissionsPanel.tsx"
        )
      )
    );
  });

  check("GMAILMANAGED-permissions 403 explains Gmail API disabled", () => {
    const err = oauth().sanitizeGoogleError(
      403,
      {
        error: {
          status: "PERMISSION_DENIED",
          message: "Gmail API has not been used in project 123 before or it is disabled.",
          details: [{ reason: "SERVICE_DISABLED" }],
        },
      },
      { product: "google_gmail" }
    );
    assertX.equal(err.code, "GOOGLE_FORBIDDEN");
    assertX.ok(/Gmail API is not enabled/i.test(err.message));
  });

  // —— 14D.5.5C.2 native Gmail hybrid managed-primary UX ——
  check("GMAILMANAGEDONLY-1 native Gmail Connect opens Google OAuth directly", () => {
    assertX.ok(picker().includes("connectGmailManagedDirect"));
    assertX.ok(picker().includes("hybridGoogle"));
    assertX.ok(modal().includes("Sign in with Google"));
  });

  check("GMAILMANAGEDONLY-2 native Gmail exposes Custom OAuth2 in Manage", () => {
    assertX.ok(modal().includes("Custom OAuth2"));
    assertX.ok(modal().includes("Managed OAuth2 (recommended)"));
    assertX.ok(!picker().includes("&& gmailManagedOnly ?"));
  });

  check("GMAILMANAGEDONLY-3 native Gmail Custom path exposes Client ID", () => {
    assertX.ok(modal().includes("Client ID"));
    assertX.ok(modal().includes("{!forceManaged"));
  });

  check("GMAILMANAGEDONLY-4 native Gmail Custom path exposes Client Secret", () => {
    assertX.ok(modal().includes("Client Secret"));
    assertX.ok(modal().includes("isPlatformManagedOnlyGoogle"));
  });

  check("GMAILMANAGEDONLY-5 native Gmail lists Service Account as unavailable", () => {
    assertX.ok(modal().includes("Service Account"));
    assertX.ok(modal().includes('value="service_account"'));
    assertX.ok(modal().includes("disabled"));
  });

  check("GMAILMANAGEDONLY-6 managed Sign in starts platform Google OAuth", () => {
    assertX.ok(picker().includes("startGoogleOAuthPopup"));
    assertX.ok(picker().includes("connectGmailManagedDirect"));
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

  check("GMAILMANAGEDONLY-8 connect another account starts a fresh OAuth (no old credentialId)", () => {
    assertX.ok(picker().includes("Use a different Gmail account"));
    assertX.ok(picker().includes("connectGmailManagedDirect"));
    assertX.ok(picker().includes("omit credentialId"));
    assertX.ok(
      picker().includes("shared across every workflow in this workspace")
    );
  });

  check("GMAILMANAGEDONLY-8b fresh Gmail OAuth uses Google AccountChooser", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "opsai-test-google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "opsai-test-google-secret";
    try {
      const started = await oauth().startGoogleOAuth(
        { workspaceId: "ws-oauth", product: "google_gmail" },
        { userId: "u-chooser", role: "Admin" }
      );
      assertX.ok(
        String(started.url).startsWith(
          "https://accounts.google.com/AccountChooser?continue="
        )
      );
      const continueUrl = decodeURIComponent(
        String(started.url).split("continue=")[1] || ""
      );
      assertX.ok(continueUrl.includes("accounts.google.com/o/oauth2/v2/auth"));
      assertX.ok(continueUrl.includes("select_account"));
      assertX.ok(!continueUrl.includes("login_hint"));
    } finally {
      if (prevId == null) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret == null) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  check("GMAILMANAGEDONLY-9 switch account uses Google OAuth popup", () => {
    assertX.ok(modal().includes("Switch account") || modal().includes("Sign in with Google"));
    assertX.ok(modal().includes("startGoogleOAuthPopup"));
  });

  check("GMAILMANAGEDONLY-10 disconnect returns node to Connect Gmail", () => {
    assertX.ok(picker().includes("removeSelected") || picker().includes("Delete"));
    assertX.ok(picker().includes("connectPrimary") || picker().includes("Connect"));
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
    assertX.ok(oauth2Modal.includes("Authorization URL"));
  });

  check("GMAILMANAGEDONLY-14 Custom OAuth2 remains available when platform is down", () => {
    assertX.ok(modal().includes("Custom OAuth2"));
    assertX.ok(modal().includes("Managed OAuth2 (recommended)"));
    assertX.ok(
      modal().includes(
        "Google sign-in is not available on this OpsAi instance yet"
      )
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
    assertX.ok(/Gmail/i.test(err.message));
    assertX.ok(!/property permissions/i.test(err.message));
    const other = oauth().sanitizeGoogleError(403, null, {
      product: "google_gsc",
    });
    assertX.ok(/property permissions/i.test(other.message));
  });
};

module.exports = { registerPart14D55CTests };
