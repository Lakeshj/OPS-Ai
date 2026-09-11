/**
 * Part 14D.5.4 — HTTP Authentication + connection registry + generic OAuth2.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const registerPart14D54Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.4 HTTP Authentication + Connection Registry");

  const registry = () => require("../services/connectionRegistry.service");
  const domain = () => require("../services/connectionDomainPolicy.service");
  const oauth2 = () => require("../services/genericOAuth2.service");
  const secretBox = () => require("../services/secretBox.service");
  const nodes = () => require("../services/workflowNodes.service");
  const port = () => require("../services/opsaiWorkflowPortability.service");
  const httpSec = () => require("../services/workflowHttpSecurity.service");
  const creds = () => require("../modules/workflows/credentials.service");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");

  check("HTTPAUTH-1 None", () => {
    const src = readFe("modules/workflows/nodeParameterSchemas.ts");
    assertX.ok(src.includes('customRenderer: "httpAuth"'));
    assertX.ok(src.includes('name: "httpAuthMode"'));
    const httpField = readFe("components/workflows/params/HttpAuthField.tsx");
    assertX.ok(httpField.includes('value="none"'));
    assertX.ok(httpField.includes("No connection is attached"));
  });

  check("HTTPAUTH-2 Predefined mode validation", () => {
    const list = registry().listPredefined();
    assertX.ok(list.some((e) => e.id === "google_gsc" && e.status === "SUPPORTED"));
    assertX.ok(list.some((e) => e.status === "COMING_SOON"));
    assertX.equal(registry().getSupportedPredefined("openai_api"), null);
    assertX.ok(registry().getSupportedPredefined("google_gsc"));
  });

  check("HTTPAUTH-3 Generic mode validation", () => {
    const methods = registry().listGenericMethods();
    const supported = methods.filter((m) => m.status === "SUPPORTED").map((m) => m.id);
    assertX.deepEqual(
      supported.sort(),
      ["basic", "bearer", "header", "oauth2", "query"].sort()
    );
    assertX.ok(methods.some((m) => m.id === "digest" && m.status === "COMING_SOON"));
    assertX.ok(methods.some((m) => m.id === "oauth1" && m.status === "COMING_SOON"));
    assertX.ok(methods.some((m) => m.id === "custom" && m.status === "COMING_SOON"));
  });

  check("HTTPAUTH-4 Basic", async () => {
    const headers = {};
    const query = {};
    const store = new Map();
    const id = "cred-basic";
    store.set(id, {
      id,
      type: "basic",
      workspaceId: "ws-1",
      secret: { username: "u", password: "p" },
      config: {},
    });
    // Patch getSecret via applyCredential using real credentials module is heavy;
    // call applyCredential with a stub by temporarily monkey-patching.
    const original = creds().getSecretForWorkspace;
    creds().getSecretForWorkspace = async (cid, ws) => {
      const row = store.get(cid);
      if (!row || (ws && row.workspaceId !== ws)) throw new Error("missing");
      return row;
    };
    try {
      await nodes().applyCredential(id, { workspaceId: "ws-1" }, headers, query, {
        destinationUrl: "https://api.example.com/x",
      });
      assertX.equal(headers.Authorization, `Basic ${Buffer.from("u:p").toString("base64")}`);
    } finally {
      creds().getSecretForWorkspace = original;
    }
  });

  check("HTTPAUTH-5 Bearer", async () => {
    const headers = {};
    const query = {};
    const original = creds().getSecretForWorkspace;
    creds().getSecretForWorkspace = async () => ({
      type: "bearer",
      secret: { token: "tok-123" },
      config: {},
    });
    try {
      await nodes().applyCredential("c", { workspaceId: "ws-1" }, headers, query, {
        destinationUrl: "https://api.example.com/x",
      });
      assertX.equal(headers.Authorization, "Bearer tok-123");
    } finally {
      creds().getSecretForWorkspace = original;
    }
  });

  check("HTTPAUTH-6 Header", async () => {
    const headers = {};
    const query = {};
    const original = creds().getSecretForWorkspace;
    creds().getSecretForWorkspace = async () => ({
      type: "api_key_header",
      secret: { headerName: "X-Api-Key", value: "k" },
      config: {},
    });
    try {
      const policy = await nodes().applyCredential(
        "c",
        { workspaceId: "ws-1" },
        headers,
        query,
        { destinationUrl: "https://api.example.com/x" }
      );
      assertX.equal(headers["X-Api-Key"], "k");
      assertX.ok(policy.extraSensitiveHeaders.includes("X-Api-Key"));
    } finally {
      creds().getSecretForWorkspace = original;
    }
  });

  check("HTTPAUTH-7 Query", async () => {
    const headers = {};
    const query = {};
    const original = creds().getSecretForWorkspace;
    creds().getSecretForWorkspace = async () => ({
      type: "query_param",
      secret: { paramName: "key", value: "v" },
      config: {},
    });
    try {
      await nodes().applyCredential("c", { workspaceId: "ws-1" }, headers, query, {
        destinationUrl: "https://api.example.com/x",
      });
      assertX.equal(query.key, "v");
    } finally {
      creds().getSecretForWorkspace = original;
    }
  });

  check("HTTPAUTH-8 OAuth2 definition", () => {
    const checked = oauth2().validateOAuth2Config(
      {
        authorizationUrl: "https://auth.example/authorize",
        accessTokenUrl: "https://auth.example/token",
        clientId: "cid",
        clientSecret: "sec",
        allowedDomains: ["api.example.com"],
      },
      { requireSecret: true }
    );
    assertX.equal(checked.errors.length, 0);
    assertX.equal(checked.config.tokenExpiredStatusCode, 401);
    assertX.equal(oauth2().redirectUri().includes("/oauth2/callback"), true);
  });

  check("HTTPAUTH-9 secrets not stored on node", () => {
    const httpSchema = readFe("modules/workflows/nodeParameterSchemas.ts");
    const httpBlock = httpSchema.split("http: [")[1].split("condition: [")[0];
    assertX.ok(!/clientSecret|accessToken|refreshToken/.test(httpBlock));
    assertX.ok(httpBlock.includes('name: "credentialId"'));
    assertX.ok(httpBlock.includes('name: "httpAuthMode"'));
  });

  check("HTTPAUTH-10 encrypted connection storage", () => {
    const cipher = secretBox().encryptSecret({
      clientSecret: "SECRET-VALUE",
      accessToken: "tok",
    });
    assertX.ok(!String(cipher).includes("SECRET-VALUE"));
    assertX.ok(!String(cipher).includes("tok"));
    const plain = secretBox().decryptSecret(cipher);
    assertX.equal(plain.clientSecret, "SECRET-VALUE");
  });

  check("HTTPAUTH-11 allowed domain pass", () => {
    domain().assertUrlAllowed("https://api.example.com/v1", ["api.example.com"]);
    domain().assertUrlAllowed("https://sub.api.example.com/v1", ["api.example.com"]);
  });

  check("HTTPAUTH-12 disallowed domain reject", () => {
    assertX.throws(
      () => domain().assertUrlAllowed("https://evil.example/x", ["api.example.com"]),
      /cannot be used|not allowed/i
    );
  });

  check("HTTPAUTH-13 redirect domain reject/strip", async () => {
    await httpSec().withHttpSecurityTestPolicy(
      {
        allowLoopback: true,
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      },
      async () => {
        let hop = 0;
        const prevFetch = global.fetch;
        global.fetch = async (url) => {
          hop += 1;
          if (hop === 1) {
            return {
              status: 302,
              ok: false,
              headers: {
                get: (n) =>
                  String(n).toLowerCase() === "location"
                    ? "https://evil.example/leak"
                    : null,
              },
            };
          }
          return {
            status: 200,
            ok: true,
            headers: { get: () => "application/json" },
            json: async () => ({ ok: true }),
            text: async () => "{}",
          };
        };
        try {
          await assertX.rejects(
            () =>
              httpSec().secureHttpFetch(
                "https://api.example.com/start",
                {
                  method: "GET",
                  headers: { Authorization: "Bearer secret" },
                },
                {
                  authPolicy: {
                    allowedHosts: ["api.example.com"],
                    extraSensitiveHeaders: [],
                  },
                }
              ),
            /not allowed for this connection|redirect host/i
          );
        } finally {
          global.fetch = prevFetch;
        }
      }
    );
  });

  check("HTTPAUTH-14 native Google node unchanged", () => {
    const schemas = readFe("modules/workflows/nodeParameterSchemas.ts");
    for (const blockName of [
      "googleSearchConsole:",
      "googleAnalytics:",
      "googleSheets:",
      "gmail:",
      "gmailTrigger:",
    ]) {
      const idx = schemas.indexOf(blockName);
      assertX.ok(idx > 0, blockName);
      const slice = schemas.slice(idx, idx + 800);
      assertX.ok(!slice.includes('customRenderer: "httpAuth"'));
      assertX.ok(/displayName: "Google .+ Account"|displayName: "Gmail Account"/.test(slice));
      assertX.ok(!/Client ID|Client Secret|OAuth Redirect URL/.test(slice));
    }
  });

  check("HTTPAUTH-15 export strips connection", () => {
    const pkg = port().buildNativeExport({
      name: "http-auth",
      definition: {
        version: 1,
        nodes: [
          {
            id: "h1",
            type: "http",
            data: {
              url: "https://api.example.com",
              httpAuthMode: "generic",
              genericAuthType: "bearer",
              credentialId: "cred-live",
            },
          },
        ],
        edges: [],
      },
    });
    const data = pkg.workflow.definition.nodes[0].data;
    assertX.equal(data.credentialId, undefined);
    assertX.equal(data.credentialRequirement.configuredAtSource, true);
    assertX.equal(data.credentialRequirement.httpAuthMode, "generic");
    assertX.equal(data.credentialRequirement.genericAuthType, "bearer");
  });

  check("HTTPAUTH-16 imported HTTP node requires reconnection", () => {
    const pkg = port().buildNativeExport({
      name: "http-auth",
      definition: {
        version: 1,
        nodes: [
          {
            id: "h1",
            type: "http",
            data: {
              url: "https://api.example.com",
              httpAuthMode: "predefined",
              predefinedConnectionType: "google_gsc",
              credentialId: uuidv4(),
            },
          },
        ],
        edges: [],
      },
    });
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.ok, true);
    const node = preview.definition.nodes[0];
    assertX.equal(node.data.credentialId, undefined);
    assertX.equal(node.data.credentialRequirement.portable, false);
    assertX.equal(node.data.credentialRequirement.configuredAtSource, true);
  });

  check("HTTPAUTH-17 predefined connection reused by HTTP Request", async () => {
    const headers = {};
    const query = {};
    const original = creds().getSecretForWorkspace;
    const google = require("../services/googleOAuth.service");
    const prev = google.getValidAccessToken;
    google.getValidAccessToken = async () => ({ accessToken: "g-tok" });
    creds().getSecretForWorkspace = async () => ({
      type: "google_gsc",
      secret: { accessToken: "g-tok", expiryMs: Date.now() + 60_000 },
      config: {},
    });
    try {
      await nodes().applyCredential(
        "g1",
        { workspaceId: "ws-1" },
        headers,
        query,
        { destinationUrl: "https://searchconsole.googleapis.com/webmasters/v3/sites" }
      );
      assertX.equal(headers.Authorization, "Bearer g-tok");
      await assertX.rejects(
        () =>
          nodes().applyCredential(
            "g1",
            { workspaceId: "ws-1" },
            {},
            {},
            { destinationUrl: "https://evil.example/x" }
          ),
        /cannot be used|not allowed/i
      );
    } finally {
      creds().getSecretForWorkspace = original;
      google.getValidAccessToken = prev;
    }
  });

  check("OAUTHMODAL-1 required field validation", () => {
    const checked = oauth2().validateOAuth2Config({}, { requireSecret: true });
    assertX.ok(checked.errors.some((e) => /Authorization URL/i.test(e)));
    assertX.ok(checked.errors.some((e) => /Access Token URL/i.test(e)));
    assertX.ok(checked.errors.some((e) => /Client ID/i.test(e)));
    assertX.ok(checked.errors.some((e) => /Client Secret/i.test(e)));
    assertX.ok(checked.errors.some((e) => /Allowed HTTP Request Domains/i.test(e)));
  });

  check("OAUTHMODAL-2 redirect URL readonly", () => {
    const modal = readFe("components/workflows/params/OAuth2ConnectionModal.tsx");
    assertX.ok(modal.includes("OAuth Redirect URL"));
    assertX.ok(modal.includes("readOnly"));
    assertX.ok(!/onChange=.*redirectUri/.test(modal));
  });

  check("OAUTHMODAL-3 copy control", () => {
    const modal = readFe("components/workflows/params/OAuth2ConnectionModal.tsx");
    assertX.ok(modal.includes("copyRedirect"));
    assertX.ok(modal.includes("navigator.clipboard.writeText"));
  });

  check("OAUTHMODAL-4 insecure SSL warning", () => {
    const modal = readFe("components/workflows/params/OAuth2ConnectionModal.tsx");
    assertX.ok(modal.includes("Ignore SSL Issues (Insecure)"));
    assertX.ok(modal.includes("skipping TLS verification is insecure"));
  });

  check("OAUTHMODAL-5 token code default 401", () => {
    const checked = oauth2().validateOAuth2Config(
      {
        authorizationUrl: "https://a",
        accessTokenUrl: "https://b",
        clientId: "c",
        clientSecret: "s",
        allowedDomains: ["api.example.com"],
      },
      { requireSecret: true }
    );
    assertX.equal(checked.config.tokenExpiredStatusCode, 401);
    const modal = readFe("components/workflows/params/OAuth2ConnectionModal.tsx");
    assertX.ok(modal.includes("tokenExpiredStatusCode: 401"));
  });

  check("OAUTHMODAL-6 secrets not exposed", () => {
    const safe = oauth2().editorSafeConfig({
      clientId: "cid",
      authorizationUrl: "https://a",
      accessTokenUrl: "https://b",
      allowedDomains: ["api.example.com"],
      connected: true,
    });
    assertX.equal(safe.clientSecret, undefined);
    assertX.equal(safe.accessToken, undefined);
    assertX.equal(safe.refreshToken, undefined);
    const modal = readFe("components/workflows/params/OAuth2ConnectionModal.tsx");
    assertX.ok(modal.includes("Secrets and tokens are never shown here"));
  });

  check("OAUTHMODAL-7 success/error states", () => {
    const modal = readFe("components/workflows/params/OAuth2ConnectionModal.tsx");
    assertX.ok(modal.includes("Please check the errors below"));
    assertX.ok(modal.includes("This field is required"));
    assertX.ok(modal.includes("Connect your account to use this connection"));
    assertX.ok(modal.includes("Account connected"));
    assertX.ok(modal.includes("Connection tested successfully"));
  });

  check("HTTPAUTH-registry catalog readiness", () => {
    const list = registry().listPredefined();
    assertX.ok(list.every((e) => e.searchText && e.displayName));
    const supported = list.filter((e) => e.status === "SUPPORTED");
    const soon = list.filter((e) => e.status === "COMING_SOON");
    assertX.equal(supported.length, 4);
    assertX.ok(soon.length >= 4);
  });

  check("HTTPAUTH-routes oauth2 callback registered", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "../routes/index.js"),
      "utf8"
    );
    assertX.ok(routes.includes('router.get("/oauth2/callback"'));
    assertX.ok(routes.includes('router.get("/api/oauth2/callback"'));
  });
};

module.exports = { registerPart14D54Tests };
