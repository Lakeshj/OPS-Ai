/**
 * Part 14D.5.4A — Managed Google OAuth vs Generic OAuth2 separation.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D54ATests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.4A Managed Google OAuth vs Generic OAuth2");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");
  const registry = () => require("../services/connectionRegistry.service");
  const oauth = () => require("../services/googleOAuth.service");
  const oauth2 = () => require("../services/genericOAuth2.service");
  const secretBox = () => require("../services/secretBox.service");

  const googleManagedForbiddenUi =
    /OAuth Redirect URL|Authorization URL|Access Token URL|Token Expired Status|Allowed HTTP Request Domains/;

  const assertNativeNoClientSecrets = (nodeKey, accountLabel, connectLabel) => {
    const schema = readFe("modules/workflows/nodeParameterSchemas.ts");
    const idx = schema.indexOf(`${nodeKey}:`);
    assertX.ok(idx > 0, nodeKey);
    const slice = schema.slice(idx, idx + 900);
    assertX.ok(slice.includes(`displayName: "${accountLabel}"`));
    assertX.ok(slice.includes('customRenderer: "credential"'));
    assertX.ok(!slice.includes('customRenderer: "httpAuth"'));
    assertX.ok(!/Client ID|Client Secret/.test(slice));
    assertX.ok(!googleManagedForbiddenUi.test(slice));
    const types = readFe("modules/workflows/types.ts");
    assertX.ok(types.includes(`connectAction: "${connectLabel}"`));
    assertX.ok(types.includes(`accountLabel: "${accountLabel}"`));
    const picker = readFe("components/workflows/params/CredentialPicker.tsx");
    assertX.ok(picker.includes("connectAction"));
    assertX.ok(picker.includes("CREDENTIAL_TYPE_FIELDS"));
    assertX.ok(!picker.includes("OAuth Redirect URL"));
    // Managed Google path never renders secret field keys for google_* types
    assertX.ok(picker.includes("isGoogleType(type)"));
    assertX.ok(picker.includes("GoogleCredentialModal"));
    assertX.ok(!picker.includes("OAuth2ConnectionModal"));
  };

  check("MANAGEDOAUTH-1 native GA4 connect does not request user Client ID/Secret", () => {
    assertNativeNoClientSecrets(
      "googleAnalytics",
      "Google Analytics Account",
      "Connect Google Analytics"
    );
  });

  check("MANAGEDOAUTH-2 native GSC connect does not request user Client ID/Secret", () => {
    assertNativeNoClientSecrets(
      "googleSearchConsole",
      "Google Search Console Account",
      "Connect Google Search Console"
    );
  });

  check("MANAGEDOAUTH-3 native Gmail connect does not request user Client ID/Secret", () => {
    assertNativeNoClientSecrets("gmail", "Gmail Account", "Connect Gmail");
    assertNativeNoClientSecrets("gmailTrigger", "Gmail Account", "Connect Gmail");
  });

  check("MANAGEDOAUTH-4 native Sheets connect does not request user Client ID/Secret", () => {
    assertNativeNoClientSecrets(
      "googleSheets",
      "Google Sheets Account",
      "Connect Google Sheets"
    );
  });

  check("MANAGEDOAUTH-5 managed Google start uses server GOOGLE_OAUTH_CLIENT_ID", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "opsai-server-google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "opsai-server-google-secret";
    try {
      const started = await oauth().startGoogleOAuth(
        { workspaceId: "ws-a", product: "google_ga4" },
        { id: "user-a", userId: "user-a", role: "Admin" }
      );
      const auth = new URL(started.url);
      assertX.equal(
        auth.searchParams.get("client_id"),
        "opsai-server-google-client"
      );
      assertX.ok(!JSON.stringify(started).includes("opsai-server-google-secret"));
      const src = fs.readFileSync(
        path.join(__dirname, "../services/googleOAuth.service.js"),
        "utf8"
      );
      assertX.ok(src.includes("GOOGLE_OAUTH_CLIENT_ID"));
      assertX.ok(src.includes("config.googleOAuth"));
      // Per-user secret payload must not include app client secret
      assertX.ok(
        /accessToken: json\.access_token[\s\S]*refreshToken:/.test(src)
      );
      assertX.ok(!/encryptSecret\(\{[\s\S]*clientSecret/.test(src));
    } finally {
      if (prevId == null) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret == null) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  check("MANAGEDOAUTH-6 managed Google account chooser includes select_account", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "opsai-server-google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "opsai-server-google-secret";
    try {
      for (const product of [
        "google_ga4",
        "google_gsc",
        "google_gmail",
        "google_sheets",
      ]) {
        const started = await oauth().startGoogleOAuth(
          { workspaceId: "ws-a", product },
          { id: "user-a", userId: "user-a", role: "Admin" }
        );
        const auth = new URL(started.url);
        const prompt = String(auth.searchParams.get("prompt") || "");
        assertX.ok(prompt.split(/[\s+]+/).includes("select_account"), product);
        assertX.ok(prompt.split(/[\s+]+/).includes("consent"), product);
        assertX.equal(auth.searchParams.get("login_hint"), null);
      }
    } finally {
      if (prevId == null) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret == null) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  check("MANAGEDOAUTH-7 per-user Google account connection stored separately", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/googleOAuth.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("INSERT INTO workflow_credentials"));
    assertX.ok(src.includes("parsed.userId"));
    assertX.ok(src.includes("parsed.workspaceId"));
    assertX.ok(src.includes("parsed.product"));
    // Each finish creates a new credential id
    assertX.ok(src.includes("const id = uuidv4()"));
  });

  check("MANAGEDOAUTH-8 two users can authorize different Google accounts under the same OpsAi OAuth app", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "shared-opsai-google-app";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "shared-opsai-google-secret";
    try {
      const a = await oauth().startGoogleOAuth(
        { workspaceId: "ws-1", product: "google_ga4", name: "User A GA" },
        { id: "user-a", userId: "user-a", role: "Admin" }
      );
      const b = await oauth().startGoogleOAuth(
        { workspaceId: "ws-2", product: "google_ga4", name: "User B GA" },
        { id: "user-b", userId: "user-b", role: "Admin" }
      );
      const ua = new URL(a.url);
      const ub = new URL(b.url);
      assertX.equal(ua.searchParams.get("client_id"), "shared-opsai-google-app");
      assertX.equal(ub.searchParams.get("client_id"), "shared-opsai-google-app");
      assertX.notEqual(ua.searchParams.get("state"), ub.searchParams.get("state"));
      // Same OpsAi app; distinct signed states bind different users/workspaces
      const parsedA = oauth().verifyState(ua.searchParams.get("state"));
      const parsedB = oauth().verifyState(ub.searchParams.get("state"));
      assertX.equal(parsedA.userId, "user-a");
      assertX.equal(parsedB.userId, "user-b");
      assertX.equal(parsedA.workspaceId, "ws-1");
      assertX.equal(parsedB.workspaceId, "ws-2");
    } finally {
      if (prevId == null) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret == null) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  const assertPredefinedUsesManaged = (typeId, connectLabel) => {
    const entry = registry().getSupportedPredefined(typeId);
    assertX.ok(entry);
    assertX.equal(entry.oauth.appModeDefault, "PLATFORM_MANAGED");
    assertX.ok(entry.oauth.product);
    assertX.equal(registry().publicEntry(entry).oauthMode, "predefined_custom_app");
    assertX.equal(registry().publicEntry(entry).oauthManaged, true);
    const http = readFe("components/workflows/params/HttpAuthField.tsx");
    assertX.ok(http.includes("oauthManaged"));
    assertX.ok(http.includes("CredentialPicker"));
    // Predefined managed path must not open generic OAuth2 modal
    const oauthModalOpen = http.indexOf("setOauthOpen(true)");
    const genericOauth2Block = http.indexOf('genericAuthType === "oauth2"');
    assertX.ok(oauthModalOpen > genericOauth2Block);
    assertX.ok(http.includes(connectLabel) || readFe("modules/workflows/types.ts").includes(connectLabel));
  };

  check("PREDEFINEDOAUTH-1 HTTP Predefined Google Analytics reuses managed connection", () => {
    assertPredefinedUsesManaged("google_ga4", "Connect Google Analytics");
  });

  check("PREDEFINEDOAUTH-2 HTTP Predefined GSC reuses managed connection", () => {
    assertPredefinedUsesManaged("google_gsc", "Connect Google Search Console");
  });

  check("PREDEFINEDOAUTH-3 HTTP Predefined Gmail reuses managed connection", () => {
    assertPredefinedUsesManaged("google_gmail", "Connect Gmail");
  });

  check("PREDEFINEDOAUTH-4 HTTP Predefined Sheets reuses managed connection", () => {
    assertPredefinedUsesManaged("google_sheets", "Connect Google Sheets");
  });

  check("GENERICOAUTH-1 HTTP Generic OAuth2 still opens advanced OAuth2 editor", () => {
    const http = readFe("components/workflows/params/HttpAuthField.tsx");
    assertX.ok(http.includes('genericAuthType === "oauth2"'));
    assertX.ok(http.includes("OAuth2ConnectionModal"));
    assertX.ok(http.includes("setOauthOpen(true)"));
    const modal = readFe("components/workflows/params/OAuth2ConnectionModal.tsx");
    assertX.ok(modal.includes("OAuth Redirect URL"));
    assertX.ok(modal.includes("Client ID"));
    assertX.ok(modal.includes("Client Secret"));
    assertX.ok(modal.includes("Authorization URL"));
    assertX.ok(modal.includes("Access Token URL"));
  });

  check("GENERICOAUTH-2 generic OAuth2 requires its own client ID/secret", () => {
    const checked = oauth2().validateOAuth2Config(
      {
        authorizationUrl: "https://auth.example/authorize",
        accessTokenUrl: "https://auth.example/token",
        allowedDomains: ["api.example.com"],
      },
      { requireSecret: true }
    );
    assertX.ok(checked.errors.some((e) => /Client ID/i.test(e)));
    assertX.ok(checked.errors.some((e) => /Client Secret/i.test(e)));
    // Distinct from Google managed redirect
    assertX.ok(oauth2().redirectUri().includes("/oauth2/callback"));
    assertX.ok(!oauth2().redirectUri().includes("google-oauth"));
  });

  check("GENERICOAUTH-3 generic OAuth2 secrets remain encrypted", () => {
    const cipher = secretBox().encryptSecret({
      clientSecret: "generic-client-secret",
      accessToken: "generic-access",
      refreshToken: "generic-refresh",
    });
    assertX.ok(!String(cipher).includes("generic-client-secret"));
    assertX.ok(!String(cipher).includes("generic-access"));
    const plain = secretBox().decryptSecret(cipher);
    assertX.equal(plain.clientSecret, "generic-client-secret");
  });

  check("MANAGEDOAUTH-ui-path-audit no managed Google opens generic OAuth modal", () => {
    const picker = readFe("components/workflows/params/CredentialPicker.tsx");
    assertX.ok(!picker.includes("OAuth2ConnectionModal"));
    assertX.ok(!picker.includes("Authorization URL"));
    assertX.ok(picker.includes("startGoogleOAuthPopup"));
    assertX.ok(picker.includes("Sign in with Google"));
    assertX.ok(picker.includes("GoogleCredentialModal"));
    assertX.ok(picker.includes("openGoogleModal"));
    const renderer = readFe(
      "components/workflows/params/NodeParameterRenderer.tsx"
    );
    // Google native nodes use credential renderer; httpAuth is separate
    assertX.ok(renderer.includes('case "credential"'));
    assertX.ok(renderer.includes('case "httpAuth"'));
  });
};

module.exports = { registerPart14D54ATests };
