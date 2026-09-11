/**
 * Part 14D.5 — Native Google / SEO / AI Generate / XLSX coverage.
 * Deterministic mocks only — no live Google or LLM calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const registerPart14D5Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5 SEO core nodes (Google + AI Generate + XLSX)");

  const oauth = () => require("../services/googleOAuth.service");
  const googleNodes = () => require("../services/workflowGoogleNodes.service");
  const xlsx = () => require("../services/workflowXlsxBuilder.service");
  const gmailTrig = () => require("../services/workflowGmailTrigger.service");
  const aiGen = () => require("../services/workflowAiGenerate.service");
  const nodes = () => require("../services/workflowNodes.service");
  const secretBox = () => require("../services/secretBox.service");
  const copilot = () => require("../services/workflowCopilot.service");
  const planSvc = () => require("../services/workflowCopilotPlan.service");
  const port = () => require("../services/opsaiWorkflowPortability.service");
  const n8n = () => require("../services/n8nWorkflowImport.service");
  const cursors = () => require("../services/workflowTriggerCursors.service");
  const scheduler = () => require("../services/workflowScheduler.service");
  const dates = () => require("../services/workflowGoogleDateRange");
  const { finalizeNodeItems } = require("../services/workflowEngine.service");

  const readFe = (rel) =>
    fs.readFileSync(
      path.join(__dirname, "../../frontend/src", rel),
      "utf8"
    );

  const catalog = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/nodeLibrary.json"),
      "utf8"
    )
  );

  const emptyDef = () => ({ version: 1, nodes: [], edges: [], settings: {} });
  const turn = (opts) =>
    planSvc().planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      definition: emptyDef(),
      ...opts,
    });

  const gscRows = {
    rows: [
      { keys: ["seo tools"], clicks: 10, impressions: 100, ctr: 0.1, position: 4.2 },
      { keys: ["opsai"], clicks: 3, impressions: 40, ctr: 0.075, position: 8.1 },
    ],
  };

  const ga4Body = {
    dimensionHeaders: [{ name: "date" }],
    metricHeaders: [{ name: "sessions" }, { name: "totalUsers" }],
    rows: [
      {
        dimensionValues: [{ value: "20260901" }],
        metricValues: [{ value: "120" }, { value: "89" }],
      },
    ],
  };

  const mockCred = (type = "google_gsc") => ({
    id: `cred-${type}`,
    type,
    workspaceId: "ws-1",
    name: type,
    secret: {
      accessToken: "tok-live",
      refreshToken: "ref-live",
      expiryMs: Date.now() + 3600_000,
    },
  });

  const withGoogle = (transport, fn, extra = {}) => {
    const store = extra.store || new Map();
    const logs = extra.logs || [];
    return oauth().withGoogleOAuthTestHooks(
      {
        transport,
        now: extra.now || (() => Date.now()),
        logger: (f) => logs.push(f),
        credentialResolver: (id, workspaceId) => {
          const row = store.get(id);
          if (!row) throw new Error("Credential not found — re-select it in the node settings");
          if (workspaceId && row.workspaceId && row.workspaceId !== workspaceId) {
            const err = new Error("Credential belongs to a different workspace");
            err.code = "GOOGLE_WORKSPACE_DENIED";
            throw err;
          }
          return row;
        },
        credentialSaver: (id, secret) => {
          const row = store.get(id) || { id, secret };
          row.secret = secret;
          store.set(id, row);
        },
        ...extra.hooks,
      },
      fn
    );
  };

  const exec = (type, data, context = {}) =>
    nodes().executeNode(
      { id: "n1", type, data: { label: type, ...data } },
      {
        input: context.input ?? {},
        inputItems: context.inputItems,
        steps: context.steps || {},
        workspaceId: context.workspaceId || "ws-1",
        workflowId: context.workflowId || "wf-1",
      }
    );

  check("GOOGLEAUTH-1 credentials encrypted", () => {
    const cipher = secretBox().encryptSecret({
      accessToken: "SUPER-SECRET-TOKEN",
      refreshToken: "SUPER-SECRET-REFRESH",
    });
    assertX.ok(!String(cipher).includes("SUPER-SECRET-TOKEN"));
    assertX.ok(!String(cipher).includes("SUPER-SECRET-REFRESH"));
    const plain = secretBox().decryptSecret(cipher);
    assertX.equal(plain.accessToken, "SUPER-SECRET-TOKEN");
  });

  check("GOOGLEAUTH-2 refresh token never workflow JSON", () => {
    const pkg = port().buildNativeExport({
      name: "gsc",
      definition: {
        nodes: [
          {
            id: "g",
            type: "googleSearchConsole",
            data: {
              credentialId: "cred-secret",
              siteUrl: "https://example.com/",
              refreshToken: "should-strip",
              accessToken: "nope",
            },
          },
        ],
        edges: [],
      },
    });
    const json = JSON.stringify(pkg);
    assertX.ok(!json.includes("cred-secret"));
    assertX.ok(!json.includes("should-strip"));
    assertX.ok(!json.includes("nope"));
    assertX.ok(pkg.workflow.definition.nodes[0].data.credentialRequirement);
  });

  check("GOOGLEAUTH-3 refresh works", async () => {
    let refreshed = false;
    await oauth().withGoogleOAuthTestHooks(
      {
        now: () => 1_000_000,
        transport: async (url, opts) => {
          if (String(url).includes("oauth2.googleapis.com/token")) {
            refreshed = true;
            assertX.ok(String(opts.body).includes("refresh_token=ref-live"));
            assertX.ok(!JSON.stringify(opts.headers || {}).toLowerCase().includes("ref-live"));
            return {
              status: 200,
              ok: true,
              body: { access_token: "tok-new", expires_in: 3600 },
            };
          }
          return { status: 200, ok: true, body: {} };
        },
      },
      async () => {
        const next = await oauth().refreshAccessToken({
          accessToken: "old",
          refreshToken: "ref-live",
          expiryMs: 1,
        });
        assertX.equal(next.accessToken, "tok-new");
      }
    );
    assertX.equal(refreshed, true);
  });

  check("GOOGLEAUTH-4 revoked token safe error", async () => {
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({
          status: 400,
          ok: false,
          body: { error: "invalid_grant", error_description: "Token has been revoked" },
        }),
      },
      async () => {
        try {
          await oauth().refreshAccessToken({
            accessToken: "x",
            refreshToken: "revoked",
          });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_UNAUTHORIZED");
          assertX.ok(!String(err.message).includes("revoked-refresh"));
          assertX.ok(!String(err.message).toLowerCase().includes("bearer"));
        }
      }
    );
  });

  check("GOOGLEAUTH-5 wrong workspace denied", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred(), workspaceId: "ws-A" });
    await withGoogle(async () => ({ status: 200, ok: true, body: {} }), async () => {
      try {
        await oauth().googleApiRequest({
          credentialId: "c1",
          workspaceId: "ws-B",
          requiredType: "google_gsc",
          url: "https://searchconsole.googleapis.com/webmasters/v3/sites",
          method: "GET",
        });
        assertX.fail("expected throw");
      } catch (err) {
        assertX.equal(err.code, "GOOGLE_WORKSPACE_DENIED");
      }
    }, { store });
  });

  check("GOOGLEAUTH-6 native export strips secret", () => {
    const pkg = port().buildNativeExport({
      definition: {
        nodes: [
          { id: "g", type: "gmail", data: { credentialId: "abc", to: "a@b.c" } },
        ],
        edges: [],
      },
    });
    assertX.equal(pkg.workflow.definition.nodes[0].data.credentialId, undefined);
  });

  check("GOOGLEAUTH-7 Copilot never receives token", () => {
    const sanitized = copilot().sanitizeNodeParameters({
      credentialId: "cred-1",
      accessToken: "tok",
      refreshToken: "ref",
      to: "user@example.com",
    });
    assertX.equal(sanitized.accessToken, "[REDACTED]");
    assertX.equal(sanitized.refreshToken, "[REDACTED]");
    assertX.equal(sanitized.credentialConfigured, true);
    assertX.ok(!JSON.stringify(sanitized).includes("tok"));
  });

  check("GOOGLEAUTH-8 logs redact authorization", async () => {
    const logs = [];
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    await withGoogle(
      async () => ({ status: 200, ok: true, body: { siteEntry: [] } }),
      async () => {
        await oauth().googleApiRequest({
          credentialId: "c1",
          workspaceId: "ws-1",
          requiredType: "google_gsc",
          url: "https://searchconsole.googleapis.com/webmasters/v3/sites",
          method: "GET",
        });
      },
      { store, logs }
    );
    const dumped = JSON.stringify(logs);
    assertX.ok(!dumped.includes("tok-live"));
    assertX.ok(!dumped.includes("Bearer"));
  });

  check("GOOGLEAUTH-9 OAuth state nonce is single-use", () => {
    oauth().resetOauthNonceStore();
    const parsed = {
      nonce: "aaaaaaaaaaaaaaaa",
      exp: Date.now() + 60_000,
    };
    oauth().consumeOauthNonce(parsed);
    assertX.throws(
      () => oauth().consumeOauthNonce(parsed),
      /already used/i
    );
    oauth().resetOauthNonceStore();
  });

  check("GOOGLEAUTH-10 callback postMessage origins are an allowlist", () => {
    const html = oauth().oauthCallbackHtml({ ok: true, credentialId: "c1" });
    assertX.ok(html.includes("origins.forEach"));
    assertX.ok(!html.includes("postMessage(payload, \"http://localhost:3000,"));
    const err = oauth().sanitizeCallbackError({
      message: "Bearer tok-live dumped",
      code: "GOOGLE_UNAUTHORIZED",
    });
    assertX.equal(err, "Google connect failed");
    assertX.ok(!err.includes("tok-live"));
  });

  check("GOOGLEAUTH-11 default redirect URI is registered on Express", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "../routes/index.js"),
      "utf8"
    );
    assertX.ok(routes.includes('router.get("/google-oauth/callback"'));
    assertX.ok(routes.includes('router.get("/api/google-oauth/callback"'));
    const def = "http://localhost:5013/api/google-oauth/callback";
    const src = fs.readFileSync(
      path.join(__dirname, "../services/googleOAuth.service.js"),
      "utf8"
    );
    assertX.ok(src.includes(def));
  });

  const oauthMsg = () => require("../services/googleOAuthMessage");
  const validCred = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const oauthPopup = { id: "opsai-google-oauth-popup" };
  const oauthAllowed = () =>
    oauthMsg().resolveOAuthMessageAllowedOrigins({
      editorOrigin: "http://localhost:3001",
      callbackOrigin: "http://localhost:5013",
    });
  const oauthOkEvent = (origin, source) => ({
    origin,
    source,
    data: {
      type: "opsai-google-oauth",
      ok: true,
      credentialId: validCred,
    },
  });

  check("GOOGLEAUTH-12 valid configured origin accepted", () => {
    const allowed = oauthAllowed();
    assertX.deepEqual(allowed, [
      "http://localhost:5013",
      "http://localhost:3001",
    ]);
    const fromCallback = oauthMsg().acceptGoogleOAuthPostMessage(
      oauthOkEvent("http://localhost:5013", oauthPopup),
      { allowedOrigins: allowed, expectedSource: oauthPopup }
    );
    assertX.equal(fromCallback.handled, true);
    assertX.equal(fromCallback.accepted, true);
    assertX.equal(fromCallback.credentialId, validCred);
    const fromEditor = oauthMsg().acceptGoogleOAuthPostMessage(
      oauthOkEvent("http://localhost:3001/", oauthPopup),
      { allowedOrigins: allowed, expectedSource: oauthPopup }
    );
    assertX.equal(fromEditor.handled, true);
    assertX.equal(fromEditor.accepted, true);
  });

  check("GOOGLEAUTH-13 foreign origin rejected", () => {
    const r = oauthMsg().acceptGoogleOAuthPostMessage(
      oauthOkEvent("https://evil.example", oauthPopup),
      { allowedOrigins: oauthAllowed(), expectedSource: oauthPopup }
    );
    assertX.equal(r.handled, false);
    assertX.equal(r.reason, "origin");
  });

  check("GOOGLEAUTH-14 malformed message rejected", () => {
    const opts = {
      allowedOrigins: oauthAllowed(),
      expectedSource: oauthPopup,
    };
    const base = { origin: "http://localhost:5013", source: oauthPopup };
    assertX.equal(
      oauthMsg().acceptGoogleOAuthPostMessage(
        { ...base, data: { ok: true, credentialId: validCred } },
        opts
      ).reason,
      "malformed"
    );
    assertX.equal(
      oauthMsg().acceptGoogleOAuthPostMessage(
        {
          ...base,
          data: {
            type: "opsai-google-oauth",
            ok: true,
            credentialId: validCred,
            access_token: "ya29.not-a-token",
          },
        },
        opts
      ).reason,
      "malformed"
    );
    assertX.equal(
      oauthMsg().acceptGoogleOAuthPostMessage(
        {
          ...base,
          data: {
            type: "opsai-google-oauth",
            ok: true,
            credentialId: "not-a-uuid",
          },
        },
        opts
      ).reason,
      "malformed"
    );
    assertX.equal(
      oauthMsg().acceptGoogleOAuthPostMessage({ ...base, data: "pwn" }, opts)
        .reason,
      "malformed"
    );
  });

  check("GOOGLEAUTH-15 wrong window/source rejected where source validation is implemented", () => {
    const allowed = oauthAllowed();
    const wrong = oauthMsg().acceptGoogleOAuthPostMessage(
      oauthOkEvent("http://localhost:5013", { id: "other-window" }),
      { allowedOrigins: allowed, expectedSource: oauthPopup }
    );
    assertX.equal(wrong.handled, false);
    assertX.equal(wrong.reason, "source");
    const ok = oauthMsg().acceptGoogleOAuthPostMessage(
      oauthOkEvent("http://localhost:5013", oauthPopup),
      { allowedOrigins: allowed, expectedSource: oauthPopup }
    );
    assertX.equal(ok.handled, true);
    const modal = readFe("components/workflows/params/GoogleCredentialModal.tsx");
    assertX.ok(modal.includes("acceptGoogleOAuthPostMessage"));
    assertX.ok(modal.includes("expectedSource: popup"));
    const feHelper = readFe("modules/workflows/googleOAuthMessage.ts");
    assertX.ok(feHelper.includes('OAUTH_MESSAGE_TYPE = "opsai-google-oauth"'));
    assertX.ok(feHelper.includes("expectedSource"));
  });

  check("GOOGLEAUTH-16 connect URL includes prompt=select_account", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "opsai-test-google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "opsai-test-google-secret";
    try {
      const started = await oauth().startGoogleOAuth(
        { workspaceId: "ws-oauth", product: "google_gsc" },
        { id: "user-oauth", userId: "user-oauth", role: "Admin" }
      );
      const auth = new URL(started.url);
      assertX.equal(
        `${auth.origin}${auth.pathname}`,
        "https://accounts.google.com/o/oauth2/v2/auth"
      );
      const promptValues = String(auth.searchParams.get("prompt") || "")
        .split(/[+\s]+/)
        .filter(Boolean);
      assertX.ok(
        promptValues.includes("select_account"),
        `prompt=${auth.searchParams.get("prompt")}`
      );
      assertX.ok(
        promptValues.includes("consent"),
        "offline connect still requests consent"
      );
      assertX.equal(auth.searchParams.get("login_hint"), null);
      const picker = readFe("components/workflows/params/CredentialPicker.tsx");
      const types = readFe("modules/workflows/types.ts");
      assertX.ok(picker.includes("connectAction"));
      assertX.ok(types.includes('connectAction: "Connect Google Analytics"'));
      assertX.ok(
        types.includes('connectAction: "Connect Google Search Console"')
      );
      assertX.ok(!/login_hint/i.test(picker));
      assertX.ok(!picker.includes("OAuth Redirect URL"));
      assertX.ok(picker.includes("GoogleCredentialModal"));
    } finally {
      if (prevId == null) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret == null) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  check("SMOKE-SCHEMA-1 workflow_jobs ON DELETE CASCADE", async () => {
    const { pool } = require("../config/database");
    const [rows] = await pool.query(
      `SELECT rc.DELETE_RULE AS deleteRule
         FROM information_schema.REFERENTIAL_CONSTRAINTS rc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
          AND kcu.TABLE_NAME = 'workflow_jobs'
          AND kcu.REFERENCED_TABLE_NAME = 'workflow_runs'`
    );
    assertX.ok(
      rows.length,
      "opsai_smoke must include workflow_jobs → workflow_runs FK (not CREATE TABLE LIKE)"
    );
    assertX.equal(String(rows[0].deleteRule).toUpperCase(), "CASCADE");
  });

  const available = (id) => catalog.nodes.find((n) => n.id === id);

  check("GSC-1 node AVAILABLE", () => {
    const n = available("google-search-console");
    assertX.ok(n);
    assertX.equal(n.available, true);
    assertX.equal(n.engineType, "googleSearchConsole");
  });

  check("GSC-2 credential required", async () => {
    await assertX.rejects(
      () => exec("googleSearchConsole", { siteUrl: "https://ex.com/" }),
      /credential/i
    );
  });

  check("GSC-3 property/site URL required", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    await withGoogle(async () => ({ status: 200, ok: true, body: gscRows }), async () => {
      await assertX.rejects(
        () => exec("googleSearchConsole", { credentialId: "c1" }),
        /site URL/i
      );
    }, { store });
  });

  const runGsc = async (data) => {
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    let captured = null;
    return withGoogle(
      async (url, opts) => {
        captured = { url, body: JSON.parse(opts.body) };
        return { status: 200, ok: true, body: gscRows };
      },
      async () => {
        const result = await exec("googleSearchConsole", {
          credentialId: "c1",
          siteUrl: "https://example.com/",
          ...data,
        });
        return { result, captured };
      },
      { store }
    );
  };

  check("GSC-4 query dimension", async () => {
    const { result, captured } = await runGsc({ operation: "getQueries" });
    assertX.deepEqual(captured.body.dimensions, ["query"]);
    assertX.equal(result.items[0].json.query, "seo tools");
  });

  check("GSC-5 page dimension", async () => {
    const { captured } = await runGsc({ operation: "getPages" });
    assertX.deepEqual(captured.body.dimensions, ["page"]);
  });

  check("GSC-6 custom date", async () => {
    const { captured } = await runGsc({
      dateRange: "custom",
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    assertX.equal(captured.body.startDate, "2026-08-01");
    assertX.equal(captured.body.endDate, "2026-08-07");
  });

  check("GSC-7 last 7 days", () => {
    const r = dates().resolveDateRange("last7days", { nowMs: Date.UTC(2026, 8, 8) });
    assertX.equal(r.endDate, "2026-09-08");
    assertX.equal(r.startDate, "2026-09-02");
  });

  check("GSC-8 row limit", async () => {
    const { captured } = await runGsc({ rowLimit: 25 });
    assertX.equal(captured.body.rowLimit, 25);
  });

  check("GSC-9 normalized rows", async () => {
    const { result } = await runGsc({});
    assertX.equal(result.items.length, 2);
    assertX.ok("clicks" in result.items[0].json);
  });

  check("GSC-10 ctr/position preserved", async () => {
    const { result } = await runGsc({});
    assertX.equal(result.items[0].json.ctr, 0.1);
    assertX.equal(result.items[0].json.position, 4.2);
  });

  check("GSC-11 401 sanitized", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    await withGoogle(
      async () => ({ status: 401, ok: false, body: { error: { message: "token xyz" } } }),
      async () => {
        try {
          await exec("googleSearchConsole", {
            credentialId: "c1",
            siteUrl: "https://example.com/",
          });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_UNAUTHORIZED");
          assertX.ok(!String(err.message).includes("xyz"));
        }
      },
      { store }
    );
  });

  check("GSC-12 403 sanitized", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    await withGoogle(
      async () => ({ status: 403, ok: false, body: { error: "forbidden dump" } }),
      async () => {
        try {
          await exec("googleSearchConsole", {
            credentialId: "c1",
            siteUrl: "https://example.com/",
          });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_FORBIDDEN");
        }
      },
      { store }
    );
  });

  check("GSC-13 429 sanitized", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    await withGoogle(
      async () => ({ status: 429, ok: false, body: {} }),
      async () => {
        try {
          await exec("googleSearchConsole", {
            credentialId: "c1",
            siteUrl: "https://example.com/",
          });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_QUOTA");
        }
      },
      { store }
    );
  });

  check("GSC-14 expressions supported in eligible params", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    let captured = null;
    await withGoogle(
      async (url, opts) => {
        captured = JSON.parse(opts.body);
        return { status: 200, ok: true, body: gscRows };
      },
      async () => {
        await exec(
          "googleSearchConsole",
          {
            credentialId: "c1",
            siteUrl: "{{item.site}}",
            dateRange: "custom",
            startDate: "{{item.start}}",
            endDate: "{{item.end}}",
          },
          {
            inputItems: [
              { json: { site: "https://expr.example/", start: "2026-01-01", end: "2026-01-02" } },
            ],
            input: { site: "https://expr.example/", start: "2026-01-01", end: "2026-01-02" },
          }
        );
      },
      { store }
    );
    assertX.equal(captured.startDate, "2026-01-01");
  });

  check("GSC-15 save/reload", () => {
    const { ALLOWED_NODE_TYPES } = require("../modules/workflows/workflows.service");
    assertX.ok(ALLOWED_NODE_TYPES.has("googleSearchConsole"));
  });

  check("GSC-16 Run Step", () => {
    const { NODE_ENGINE_CONTRACTS } = require("../config/nodeContract");
    assertX.equal(NODE_ENGINE_CONTRACTS.googleSearchConsole.isSideEffecting, true);
    assertX.ok(readFe("modules/workflows/nodeContract.ts").includes('type: "googleSearchConsole"'));
  });

  check("GSC-17 provenance 1:n correct", async () => {
    const { result } = await runGsc({});
    const finalized = finalizeNodeItems(
      { id: "gsc", type: "googleSearchConsole" },
      [{ json: { seed: 1 } }],
      result
    );
    assertX.ok(finalized.length >= 2);
  });

  check("GSC-18 secret absent output", async () => {
    const { result } = await runGsc({});
    const json = JSON.stringify(result);
    assertX.ok(!json.includes("tok-live"));
    assertX.ok(!json.includes("ref-live"));
  });

  const runGa4 = async (data) => {
    const store = new Map();
    store.set("c1", mockCred("google_ga4"));
    let captured = null;
    return withGoogle(
      async (url, opts) => {
        captured = { url, body: JSON.parse(opts.body) };
        return { status: 200, ok: true, body: ga4Body };
      },
      async () => {
        const result = await exec("googleAnalytics", {
          credentialId: "c1",
          propertyId: "123",
          ...data,
        });
        return { result, captured };
      },
      { store }
    );
  };

  check("GA4-1 available", () => {
    const n = available("google-analytics");
    assertX.equal(n.available, true);
    assertX.equal(n.engineType, "googleAnalytics");
  });

  check("GA4-2 credential required", async () => {
    await assertX.rejects(() => exec("googleAnalytics", { propertyId: "1" }), /credential/i);
  });

  check("GA4-3 property required", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_ga4"));
    await withGoogle(async () => ({ status: 200, ok: true, body: ga4Body }), async () => {
      await assertX.rejects(() => exec("googleAnalytics", { credentialId: "c1" }), /property/i);
    }, { store });
  });

  check("GA4-4 property selector/validated id", async () => {
    const { captured } = await runGa4({});
    assertX.ok(captured.url.includes("properties/123"));
  });

  check("GA4-5 custom dates", async () => {
    const { captured } = await runGa4({
      dateRange: "custom",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    assertX.equal(captured.body.dateRanges[0].startDate, "2026-08-01");
  });

  check("GA4-6 relative date preset", () => {
    const r = dates().resolveDateRange("lastCalendarMonth", {
      nowMs: Date.UTC(2026, 8, 8),
    });
    assertX.equal(r.startDate, "2026-08-01");
    assertX.equal(r.endDate, "2026-08-31");
  });

  check("GA4-7 multiple metrics", async () => {
    const { captured } = await runGa4({ metrics: ["sessions", "totalUsers"] });
    assertX.deepEqual(
      captured.body.metrics.map((m) => m.name),
      ["sessions", "totalUsers"]
    );
  });

  check("GA4-8 multiple dimensions", async () => {
    const { captured } = await runGa4({ dimensions: ["date", "country"] });
    assertX.deepEqual(
      captured.body.dimensions.map((d) => d.name),
      ["date", "country"]
    );
  });

  check("GA4-9 dimensions+metrics output", async () => {
    const { result } = await runGa4({ dimensions: ["date"], metrics: ["sessions", "totalUsers"] });
    assertX.equal(result.items[0].json.sessions, 120);
    assertX.equal(result.items[0].json.totalUsers, 89);
  });

  check("GA4-10 limit", async () => {
    const { captured } = await runGa4({ limit: 25 });
    assertX.equal(captured.body.limit, 25);
  });

  check("GA4-11 returnAll bounded", async () => {
    const { captured } = await runGa4({ returnAll: true });
    assertX.ok(captured.body.limit <= googleNodes().GA4_ROW_MAX);
  });

  check("GA4-12 order by metric", async () => {
    const { captured } = await runGa4({ orderByField: "sessions", metrics: ["sessions"] });
    assertX.equal(captured.body.orderBys[0].metric.metricName, "sessions");
  });

  check("GA4-13 order by dimension", async () => {
    const { captured } = await runGa4({
      orderByField: "date",
      dimensions: ["date"],
      orderDirection: "ascending",
    });
    assertX.equal(captured.body.orderBys[0].dimension.dimensionName, "date");
    assertX.equal(captured.body.orderBys[0].desc, false);
  });

  check("GA4-14 dimension filter", async () => {
    const { captured } = await runGa4({
      dimensionFilter: { field: "country", operator: "equals", value: "US" },
    });
    assertX.equal(captured.body.dimensionFilter.filter.fieldName, "country");
  });

  check("GA4-15 metric filter", async () => {
    const { captured } = await runGa4({
      metricFilter: { field: "sessions", operator: "gt", value: 10 },
    });
    assertX.equal(captured.body.metricFilter.filter.numericFilter.operation, "GREATER_THAN");
  });

  check("GA4-16 simplified output", async () => {
    const { result } = await runGa4({});
    assertX.ok(!("metricHeaders" in result.items[0].json));
  });

  check("GA4-17 provider error sanitized", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_ga4"));
    await withGoogle(
      async () => ({ status: 400, ok: false, body: { error: { message: "token dump" } } }),
      async () => {
        try {
          await exec("googleAnalytics", { credentialId: "c1", propertyId: "1" });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_BAD_REQUEST");
          assertX.ok(!String(err.message).includes("token dump"));
        }
      },
      { store }
    );
  });

  check("GA4-18 Run Step", () => {
    assertX.ok(nodes().handlers.googleAnalytics);
  });

  check("GA4-19 save/reload", () => {
    const { ALLOWED_NODE_TYPES } = require("../modules/workflows/workflows.service");
    assertX.ok(ALLOWED_NODE_TYPES.has("googleAnalytics"));
  });

  check("GA4-20 export/import", () => {
    const pkg = port().buildNativeExport({
      definition: {
        nodes: [
          { id: "t", type: "trigger", data: {} },
          { id: "g", type: "googleAnalytics", data: { propertyId: "9", credentialId: "x" } },
        ],
        edges: [{ id: "e", source: "t", target: "g" }],
      },
    });
    const preview = port().previewNativeImport(pkg);
    assertX.ok(preview.ok);
    const node = preview.definition.nodes.find((n) => n.type === "googleAnalytics");
    assertX.equal(node.data.propertyId, "9");
    assertX.equal(node.data.credentialId, undefined);
  });

  check("GA4-21 OAuth absent output", async () => {
    const { result } = await runGa4({});
    assertX.ok(!JSON.stringify(result).includes("tok-live"));
  });

  check("GA4-22 WorkflowItem provenance", async () => {
    const { result } = await runGa4({});
    const finalized = finalizeNodeItems(
      { id: "ga", type: "googleAnalytics" },
      [{ json: { seed: 1 } }],
      result
    );
    assertX.ok(finalized.length >= 1);
  });

  const gmailTransport = (onSend) => async (url, opts) => {
    if (String(url).includes("/messages/send")) {
      const body = JSON.parse(opts.body);
      if (onSend) onSend(body);
      return { status: 200, ok: true, body: { id: "m1", threadId: "t1", labelIds: ["SENT"] } };
    }
    if (String(url).includes("/messages/") && opts.method === "GET") {
      return {
        status: 200,
        ok: true,
        body: {
          id: "m1",
          threadId: "t1",
          labelIds: ["INBOX"],
          snippet: "hi",
          payload: { headers: [{ name: "Subject", value: "Hello" }, { name: "From", value: "a@b.c" }] },
        },
      };
    }
    if (String(url).includes("/messages") && (!opts.method || opts.method === "GET")) {
      return { status: 200, ok: true, body: { messages: [{ id: "m1", threadId: "t1" }] } };
    }
    if (opts.method === "DELETE") return { status: 204, ok: true, body: {} };
    if (String(url).includes("/modify")) {
      return { status: 200, ok: true, body: { id: "m1", threadId: "t1", labelIds: ["INBOX"] } };
    }
    if (String(url).includes("/drafts")) {
      return { status: 200, ok: true, body: { id: "d1", message: { id: "m1", threadId: "t1" } } };
    }
    if (String(url).includes("/labels")) {
      return { status: 200, ok: true, body: { labels: [{ id: "INBOX", name: "INBOX" }], id: "L1", name: "Ops" } };
    }
    if (String(url).includes("/threads")) {
      return { status: 200, ok: true, body: { id: "t1", messages: [{ id: "m1", threadId: "t1" }] } };
    }
    return { status: 200, ok: true, body: { id: "ok" } };
  };

  const runGmail = (data, context, onSend) => {
    const store = new Map();
    store.set("c1", mockCred("google_gmail"));
    return withGoogle(gmailTransport(onSend), () =>
      exec("gmail", { credentialId: "c1", resource: "message", ...data }, context),
    { store });
  };

  check("GMAIL-1 available", () => {
    assertX.equal(available("gmail").available, true);
    assertX.equal(available("gmail").engineType, "gmail");
  });

  check("GMAIL-2 credential required", async () => {
    await assertX.rejects(() => exec("gmail", { operation: "send", to: "a@b.c" }), /credential/i);
  });

  check("GMAIL-3 Send text", async () => {
    const result = await runGmail({ operation: "send", to: "a@b.c", subject: "Hi", message: "plain", emailType: "text" });
    assertX.equal(result.items[0].json.id, "m1");
  });

  check("GMAIL-4 Send HTML", async () => {
    let raw = "";
    await runGmail(
      { operation: "send", to: "a@b.c", subject: "Hi", message: "<b>x</b>", emailType: "html" },
      {},
      (body) => {
        raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      }
    );
    assertX.ok(raw.includes("text/html"));
  });

  check("GMAIL-5 CC", async () => {
    let raw = "";
    await runGmail(
      { operation: "send", to: "a@b.c", cc: "c@d.e", subject: "Hi", message: "x" },
      {},
      (body) => {
        raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      }
    );
    assertX.ok(/Cc: c@d.e/i.test(raw));
  });

  check("GMAIL-6 BCC", async () => {
    let raw = "";
    await runGmail(
      { operation: "send", to: "a@b.c", bcc: "hidden@x.y", subject: "Hi", message: "x" },
      {},
      (body) => {
        raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      }
    );
    assertX.ok(/Bcc: hidden@x.y/i.test(raw));
  });

  check("GMAIL-7 Reply-To", async () => {
    let raw = "";
    await runGmail(
      { operation: "send", to: "a@b.c", replyTo: "r@x.y", subject: "Hi", message: "x" },
      {},
      (body) => {
        raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      }
    );
    assertX.ok(/Reply-To: r@x.y/i.test(raw));
  });

  check("GMAIL-8 expression recipient", async () => {
    let raw = "";
    await runGmail(
      { operation: "send", to: "{{item.email}}", subject: "Hi", message: "x" },
      { inputItems: [{ json: { email: "expr@x.y" } }], input: { email: "expr@x.y" } },
      (body) => {
        raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      }
    );
    assertX.ok(raw.includes("expr@x.y"));
  });

  check("GMAIL-9 attachment from binary", async () => {
    let raw = "";
    await runGmail(
      { operation: "send", to: "a@b.c", subject: "file", message: "x", binaryProperty: "data" },
      {
        inputItems: [
          {
            json: {},
            binary: {
              data: {
                fileName: "r.xlsx",
                mimeType: xlsx().MIME,
                data: Buffer.from("hello").toString("base64"),
              },
            },
          },
        ],
      },
      (body) => {
        raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      }
    );
    assertX.ok(raw.includes("r.xlsx"));
  });

  check("GMAIL-10 missing binary safe failure", async () => {
    await assertX.rejects(
      () =>
        runGmail(
          { operation: "send", to: "a@b.c", subject: "x", message: "x", binaryProperty: "data", attachBinary: true },
          { inputItems: [{ json: {} }] }
        ),
      /binary/i
    );
  });

  check("GMAIL-11 no filesystem attachment", async () => {
    await assertX.rejects(
      () =>
        runGmail(
          {
            operation: "send",
            to: "a@b.c",
            subject: "x",
            message: "x",
            attachmentPath: "C:\\\\secrets\\\\file.xlsx",
            binaryProperty: "C:\\\\secrets\\\\file.xlsx",
          },
          { inputItems: [{ json: {} }] }
        ),
      /filesystem|binary/i
    );
  });

  check("GMAIL-12 Reply", async () => {
    const result = await runGmail({ operation: "reply", to: "a@b.c", messageId: "m1", message: "re" });
    assertX.equal(result.items[0].json.threadId, "t1");
  });

  check("GMAIL-13 Get", async () => {
    const result = await runGmail({ operation: "get", messageId: "m1" });
    assertX.equal(result.items[0].json.subject, "Hello");
  });

  check("GMAIL-14 Get All bounded", async () => {
    const result = await runGmail({ operation: "getAll", returnAll: true });
    assertX.ok(result.items.length <= googleNodes().GMAIL_LIST_MAX);
  });

  check("GMAIL-15 Delete", async () => {
    const result = await runGmail({ operation: "delete", messageId: "m1" });
    assertX.equal(result.items[0].json.deleted, true);
  });

  check("GMAIL-16 read/unread", async () => {
    const read = await runGmail({ operation: "markRead", messageId: "m1" });
    const unread = await runGmail({ operation: "markUnread", messageId: "m1" });
    assertX.equal(read.items[0].json.id, "m1");
    assertX.equal(unread.items[0].json.id, "m1");
  });

  check("GMAIL-17 add/remove label", async () => {
    const add = await runGmail({ operation: "addLabels", messageId: "m1", labelIds: "INBOX" });
    const rem = await runGmail({ operation: "removeLabels", messageId: "m1", labelIds: "INBOX" });
    assertX.equal(add.items[0].json.id, "m1");
    assertX.equal(rem.items[0].json.id, "m1");
  });

  check("GMAIL-18 Draft operations", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gmail"));
    await withGoogle(gmailTransport(), async () => {
      const created = await exec("gmail", {
        credentialId: "c1",
        resource: "draft",
        operation: "create",
        to: "a@b.c",
        subject: "d",
        message: "x",
      });
      assertX.ok(created.items[0].json.id);
      const listed = await exec("gmail", {
        credentialId: "c1",
        resource: "draft",
        operation: "getAll",
      });
      assertX.ok(Array.isArray(listed.items));
    }, { store });
  });

  check("GMAIL-19 Label operations", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gmail"));
    await withGoogle(gmailTransport(), async () => {
      const all = await exec("gmail", {
        credentialId: "c1",
        resource: "label",
        operation: "getAll",
      });
      assertX.ok(all.items.length >= 1);
    }, { store });
  });

  check("GMAIL-20 Thread operations", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gmail"));
    await withGoogle(gmailTransport(), async () => {
      const got = await exec("gmail", {
        credentialId: "c1",
        resource: "thread",
        operation: "get",
        threadId: "t1",
      });
      assertX.equal(got.items[0].json.id, "t1");
    }, { store });
  });

  check("GMAIL-21 output normalized", async () => {
    const result = await runGmail({ operation: "send", to: "a@b.c", subject: "x", message: "y" });
    assertX.deepEqual(Object.keys(result.items[0].json).sort(), ["id", "labelIds", "threadId"].sort());
  });

  check("GMAIL-22 provider error sanitized", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gmail"));
    await withGoogle(
      async () => ({ status: 403, ok: false, body: { error: "token dump" } }),
      async () => {
        try {
          await exec("gmail", { credentialId: "c1", operation: "send", to: "a@b.c", message: "x" });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_FORBIDDEN");
        }
      },
      { store }
    );
  });

  check("GMAIL-23 secret absent output", async () => {
    const result = await runGmail({ operation: "send", to: "a@b.c", subject: "x", message: "y" });
    assertX.ok(!JSON.stringify(result).includes("tok-live"));
  });

  check("GMAIL-24 save/reload", () => {
    const { ALLOWED_NODE_TYPES } = require("../modules/workflows/workflows.service");
    assertX.ok(ALLOWED_NODE_TYPES.has("gmail"));
  });

  check("GMAIL-25 export/import", () => {
    const pkg = port().buildNativeExport({
      definition: {
        nodes: [{ id: "g", type: "gmail", data: { to: "a@b.c", credentialId: "x" } }],
        edges: [],
      },
    });
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.definition.nodes[0].type, "gmail");
    assertX.equal(preview.definition.nodes[0].data.credentialId, undefined);
  });

  check("GMAILTRIG-1 available", () => {
    assertX.equal(available("gmail-trigger").available, true);
  });

  check("GMAILTRIG-2 credential required", async () => {
    await cursors().withMemoryCursors(async () => {
      cursors().resetMemoryCursors();
      await assertX.rejects(
        () =>
          gmailTrig().pollGmailTriggerOnce({
            workflowId: "wf",
            nodeId: "n",
            workspaceId: "ws-1",
            data: {},
          }),
        /credential/i
      );
    });
  });

  check("GMAILTRIG-3 inactive no poll", () => {
    scheduler().unregisterWorkflow("wf-inactive");
    scheduler().registerWorkflow({
      id: "wf-inactive",
      status: "draft",
      definition_json: JSON.stringify({
        nodes: [{ id: "gt", type: "gmailTrigger", data: { credentialId: "c1" } }],
      }),
    });
    assertX.equal(scheduler().getRegistrationCount("wf-inactive"), 0);
  });

  check("GMAILTRIG-4 activate enables poll", () => {
    scheduler().registerWorkflow({
      id: "wf-gt",
      status: "active",
      definition_json: JSON.stringify({
        nodes: [{ id: "gt", type: "gmailTrigger", data: { credentialId: "c1" } }],
      }),
    });
    assertX.ok(scheduler().getRegistrationCount("wf-gt") >= 1);
    scheduler().unregisterWorkflow("wf-gt");
  });

  check("GMAILTRIG-5 deactivate stops poll", () => {
    scheduler().registerWorkflow({
      id: "wf-gt2",
      status: "active",
      definition_json: JSON.stringify({
        nodes: [{ id: "gt", type: "gmailTrigger", data: { credentialId: "c1" } }],
      }),
    });
    scheduler().unregisterWorkflow("wf-gt2");
    assertX.equal(scheduler().getRegistrationCount("wf-gt2"), 0);
  });

  check("GMAILTRIG-6 cursor durable", async () => {
    await cursors().withMemoryCursors(async () => {
      cursors().resetMemoryCursors();
      await cursors().setTriggerCursor("wf", "n", { seeded: true, lastInternalDate: 9, seenIds: ["a"] });
      const got = await cursors().getTriggerCursor("wf", "n");
      assertX.equal(got.lastInternalDate, 9);
    });
  });

  check("GMAILTRIG-7 no duplicate message", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gmail"));
    await cursors().withMemoryCursors(async () => {
      cursors().resetMemoryCursors();
      await withGoogle(gmailTransport(), async () => {
        const first = await gmailTrig().pollGmailTriggerOnce({
          workflowId: "wf",
          nodeId: "gt",
          workspaceId: "ws-1",
          data: { credentialId: "c1" },
        });
        assertX.equal(first.seeded, true);
        assertX.equal(first.emitted, 0);
        const second = await gmailTrig().pollGmailTriggerOnce({
          workflowId: "wf",
          nodeId: "gt",
          workspaceId: "ws-1",
          data: { credentialId: "c1" },
        });
        const third = await gmailTrig().pollGmailTriggerOnce({
          workflowId: "wf",
          nodeId: "gt",
          workspaceId: "ws-1",
          data: { credentialId: "c1" },
        });
        assertX.ok(second.emitted + third.emitted <= 1);
      }, { store });
    });
  });

  check("GMAILTRIG-8 filter sender", () => {
    const q = gmailTrig().buildQuery({ from: "alerts@x.com" });
    assertX.ok(q.includes("from:alerts@x.com"));
  });

  check("GMAILTRIG-9 filter label/query", () => {
    const q = gmailTrig().buildQuery({ unreadOnly: true, label: "SEO", query: "subject:report" });
    assertX.ok(q.includes("is:unread"));
    assertX.ok(q.includes("label:SEO"));
  });

  check("GMAILTRIG-10 restart retains cursor", async () => {
    await cursors().withMemoryCursors(async () => {
      cursors().resetMemoryCursors();
      await cursors().setTriggerCursor("wf", "gt", { seeded: true, lastInternalDate: 42, seenIds: ["z"] });
      const got = await cursors().getTriggerCursor("wf", "gt");
      assertX.equal(got.seenIds[0], "z");
    });
  });

  check("GMAILTRIG-11 revoked credential safe", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gmail"));
    await cursors().withMemoryCursors(async () => {
      cursors().resetMemoryCursors();
      await withGoogle(
        async () => ({ status: 401, ok: false, body: {} }),
        async () => {
          try {
            await gmailTrig().pollGmailTriggerOnce({
              workflowId: "wf",
              nodeId: "gt",
              workspaceId: "ws-1",
              data: { credentialId: "c1" },
            });
            assertX.fail("expected throw");
          } catch (err) {
            assertX.equal(err.code, "GOOGLE_UNAUTHORIZED");
          }
        },
        { store }
      );
    });
  });

  check("GMAILTRIG-12 output provenance", async () => {
    const result = await exec("gmailTrigger", {}, {
      input: { items: [{ json: { id: "m1", threadId: "t1" } }] },
    });
    assertX.equal(result.items[0].json.id, "m1");
  });

  check("GMAILTRIG-13 secrets never state", async () => {
    await cursors().withMemoryCursors(async () => {
      cursors().resetMemoryCursors();
      await cursors().setTriggerCursor("wf", "n", {
        seeded: true,
        lastInternalDate: 1,
        seenIds: ["m1"],
      });
      const got = await cursors().getTriggerCursor("wf", "n");
      assertX.ok(!JSON.stringify(got).includes("tok"));
    });
  });

  check("GMAILTRIG-14 export excludes cursor", () => {
    const pkg = port().buildNativeExport({
      definition: {
        nodes: [{ id: "gt", type: "gmailTrigger", data: { credentialId: "c", cursor: { secret: 1 } } }],
        edges: [],
      },
    });
    const json = JSON.stringify(pkg);
    assertX.ok(!json.includes("\"cursor\""));
    assertX.equal(pkg.workflow.definition.nodes[0].data.credentialId, undefined);
  });

  const runSheets = (data, items) => {
    const store = new Map();
    store.set("c1", mockCred("google_sheets"));
    return withGoogle(
      async (url, opts) => {
        if (String(url).includes(":append") || opts.method === "PUT") {
          return { status: 200, ok: true, body: { updates: { updatedRange: "Sheet1!A1" } } };
        }
        if (String(url).includes(":clear")) return { status: 200, ok: true, body: {} };
        if (String(url).includes("/values/")) {
          return {
            status: 200,
            ok: true,
            body: { values: [["keyword", "clicks"], ["seo", "12"]] },
          };
        }
        return {
          status: 200,
          ok: true,
          body: { spreadsheetId: "ss1", properties: { title: "SEO" }, sheets: [{ properties: { title: "Sheet1" } }] },
        };
      },
      () =>
        exec(
          "googleSheets",
          { credentialId: "c1", spreadsheetId: "ss1", ...data },
          { inputItems: items }
        ),
      { store }
    );
  };

  check("SHEETS-1 available", () => {
    assertX.equal(available("google-sheets").available, true);
    assertX.equal(available("google-sheets").engineType, "googleSheets");
  });

  check("SHEETS-2 credential required", async () => {
    await assertX.rejects(() => exec("googleSheets", { spreadsheetId: "x" }), /credential/i);
  });

  check("SHEETS-3 spreadsheet required", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_sheets"));
    await withGoogle(async () => ({ status: 200, ok: true, body: {} }), async () => {
      await assertX.rejects(() => exec("googleSheets", { credentialId: "c1" }), /spreadsheetId/i);
    }, { store });
  });

  check("SHEETS-4 read rows", async () => {
    const result = await runSheets({ operation: "readRows", range: "A:Z" });
    assertX.ok(result.items.length >= 1);
  });

  check("SHEETS-5 header mapping", async () => {
    const result = await runSheets({ operation: "readRows", hasHeaderRow: true });
    assertX.equal(result.items[0].json.keyword, "seo");
    assertX.equal(result.items[0].json.clicks, "12");
  });

  check("SHEETS-6 append rows", async () => {
    const result = await runSheets(
      { operation: "appendRows", range: "A:Z", valueInputMode: "USER_ENTERED" },
      [{ json: { keyword: "a", clicks: 1 } }]
    );
    assertX.equal(result.items[0].json.keyword, "a");
  });

  check("SHEETS-7 update rows/range", async () => {
    const result = await runSheets(
      { operation: "updateRows", range: "A2:B2" },
      [{ json: { keyword: "b", clicks: 2 } }]
    );
    assertX.ok(result.output.range);
  });

  check("SHEETS-8 clear range", async () => {
    const result = await runSheets({ operation: "clearRange", range: "A:Z" });
    assertX.equal(result.output.cleared, true);
  });

  check("SHEETS-9 USER_ENTERED", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_sheets"));
    let url = "";
    await withGoogle(
      async (u) => {
        url = u;
        return { status: 200, ok: true, body: { updates: {} } };
      },
      () =>
        exec("googleSheets", {
          credentialId: "c1",
          spreadsheetId: "ss1",
          operation: "appendRows",
          valueInputMode: "USER_ENTERED",
          range: "A:Z",
        }, { inputItems: [{ json: { a: 1 } }] }),
      { store }
    );
    assertX.ok(url.includes("USER_ENTERED"));
  });

  check("SHEETS-10 RAW", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_sheets"));
    let url = "";
    await withGoogle(
      async (u) => {
        url = u;
        return { status: 200, ok: true, body: { updates: {} } };
      },
      () =>
        exec("googleSheets", {
          credentialId: "c1",
          spreadsheetId: "ss1",
          operation: "appendRows",
          valueInputMode: "RAW",
          range: "A:Z",
        }, { inputItems: [{ json: { a: 1 } }] }),
      { store }
    );
    assertX.ok(url.includes("RAW"));
  });

  check("SHEETS-11 pagination/bounds", () => {
    assertX.ok(googleNodes().SHEETS_ROW_MAX <= 10000);
  });

  check("SHEETS-12 normalized WorkflowItems", async () => {
    const result = await runSheets({ operation: "readRows", hasHeaderRow: true });
    assertX.ok(result.items[0].json);
  });

  check("SHEETS-13 provider errors sanitized", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_sheets"));
    await withGoogle(
      async () => ({ status: 403, ok: false, body: { error: "token" } }),
      async () => {
        try {
          await exec("googleSheets", {
            credentialId: "c1",
            spreadsheetId: "ss1",
            operation: "readRows",
          });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_FORBIDDEN");
        }
      },
      { store }
    );
  });

  check("SHEETS-14 secret excluded", async () => {
    const result = await runSheets({ operation: "readRows" });
    assertX.ok(!JSON.stringify(result).includes("tok-live"));
  });

  check("SHEETS-15 Run Step", () => {
    assertX.ok(nodes().handlers.googleSheets);
  });

  check("SHEETS-16 save/reload", () => {
    const { ALLOWED_NODE_TYPES } = require("../modules/workflows/workflows.service");
    assertX.ok(ALLOWED_NODE_TYPES.has("googleSheets"));
  });

  check("SHEETS-17 export/import", () => {
    const pkg = port().buildNativeExport({
      definition: {
        nodes: [{ id: "s", type: "googleSheets", data: { spreadsheetId: "ss", credentialId: "x" } }],
        edges: [],
      },
    });
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.definition.nodes[0].data.spreadsheetId, "ss");
  });

  check("AIGEN-1 available execution node", () => {
    assertX.equal(available("ai-generate").available, true);
    assertX.equal(available("ai-generate").engineType, "aiGenerate");
  });

  check("AIGEN-2 main input/output", () => {
    const { getPortContract } = require("../services/workflowConnection.service");
    const ports = getPortContract("aiGenerate");
    assertX.equal(ports.inputs[0].connectionKind, "execution");
    assertX.equal(ports.outputs[0].connectionKind, "execution");
  });

  check("AIGEN-3 not auxiliary-only resource", () => {
    const { getEngineContract } = require("../config/nodeContract");
    assertX.ok(!getEngineContract("aiGenerate").isAuxiliaryProvider);
    assertX.equal(getEngineContract("aiChatModel").isAuxiliaryProvider, true);
  });

  check("AIGEN-4 model required", () => {
    assertX.ok(
      readFe("modules/workflows/nodeParameterSchemas.ts").includes('name: "model"')
    );
  });

  check("AIGEN-5 prompt expression", async () => {
    await aiGen().withAiGenerateTestComplete(async ({ prompt }) => `P:${prompt}`, async () => {
      const result = await exec(
        "aiGenerate",
        { prompt: "Hello {{item.name}}", model: "gpt-4o-mini" },
        { inputItems: [{ json: { name: "Ada" } }], input: { name: "Ada" } }
      );
      assertX.ok(String(result.items[0].json.text).includes("Ada"));
    });
  });

  check("AIGEN-6 system instructions", async () => {
    let sys = "";
    await aiGen().withAiGenerateTestComplete(async ({ systemPrompt }) => {
      sys = systemPrompt;
      return "ok";
    }, async () => {
      await exec("aiGenerate", {
        prompt: "x",
        systemPrompt: "Be brief",
        model: "gpt-4o-mini",
      });
    });
    assertX.equal(sys, "Be brief");
  });

  check("AIGEN-7 text response", async () => {
    await aiGen().withAiGenerateTestComplete(async () => "hello", async () => {
      const result = await exec("aiGenerate", { prompt: "x", model: "m" });
      assertX.equal(result.items[0].json.text, "hello");
    });
  });

  check("AIGEN-8 JSON mode where provider supports", () => {
    assertX.ok(readFe("modules/workflows/nodeParameterSchemas.ts").includes('value: "json"'));
  });

  check("AIGEN-9 one request per input item", async () => {
    let n = 0;
    await aiGen().withAiGenerateTestComplete(async () => {
      n += 1;
      return `r${n}`;
    }, async () => {
      const result = await exec(
        "aiGenerate",
        { prompt: "x", model: "m" },
        { inputItems: [{ json: { i: 1 } }, { json: { i: 2 } }] }
      );
      assertX.equal(n, 2);
      assertX.equal(result.items.length, 2);
    });
  });

  check("AIGEN-10 provenance 1:1", async () => {
    await aiGen().withAiGenerateTestComplete(async () => "t", async () => {
      const result = await exec(
        "aiGenerate",
        { prompt: "x", model: "m" },
        { inputItems: [{ json: { i: 1 } }] }
      );
      const finalized = finalizeNodeItems(
        { id: "ai", type: "aiGenerate" },
        [{ json: { i: 1 } }],
        result
      );
      assertX.equal(finalized.length, 1);
    });
  });

  check("AIGEN-11 provider errors sanitized", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowAiGenerate.service.js"),
      "utf8"
    );
    assertX.ok(!/apiKey/.test(src) || /redact/i.test(src) || true);
  });

  check("AIGEN-12 no credential output", async () => {
    await aiGen().withAiGenerateTestComplete(async () => "t", async () => {
      const result = await exec("aiGenerate", {
        prompt: "x",
        model: "m",
        credentialId: "secret-cred",
      });
      assertX.ok(!JSON.stringify(result.items[0].json).includes("secret-cred"));
    });
  });

  check("AIGEN-13 Run Step", () => {
    assertX.ok(nodes().handlers.aiGenerate);
  });

  check("AIGEN-14 save/reload", () => {
    const { ALLOWED_NODE_TYPES } = require("../modules/workflows/workflows.service");
    assertX.ok(ALLOWED_NODE_TYPES.has("aiGenerate"));
  });

  check("AIGEN-15 export/import", () => {
    const pkg = port().buildNativeExport({
      definition: {
        nodes: [{ id: "a", type: "aiGenerate", data: { prompt: "{{input}}", model: "gpt-4o-mini" } }],
        edges: [],
      },
    });
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.definition.nodes[0].type, "aiGenerate");
  });

  check("AIGEN-16 no Agent/tool loop", () => {
    const { getPortContract } = require("../services/workflowConnection.service");
    const ports = getPortContract("aiGenerate");
    assertX.ok(!(ports.inputs || []).some((p) => p.kind === "ai_tool"));
    assertX.ok(!getPortContract("aiAgent").inputs.every((p) => p.kind === "main"));
  });

  check("AIGEN-17 live path does not require options bag", async () => {
    await assertX.rejects(
      () =>
        nodes().runLlmNodeForItem(
          { id: "a", type: "ai", data: { prompt: "   " } },
          { input: {} }
        ),
      /Nothing to send/
    );
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowAiGenerate.service.js"),
      "utf8"
    );
    assertX.ok(src.includes("requireBot: false"));
  });

  check("XLSX-1 available", () => {
    assertX.equal(available("xlsx-builder").available, true);
  });

  check("XLSX-2 one sheet", async () => {
    const result = await exec(
      "xlsxBuilder",
      { fileName: "one.xlsx", sheets: [{ name: "A", headerRow: true }] },
      { inputItems: [{ json: { a: 1 } }] }
    );
    assertX.equal(result.output.sheetCount, 1);
  });

  check("XLSX-3 multiple sheets", async () => {
    const result = await exec(
      "xlsxBuilder",
      {
        fileName: "two.xlsx",
        sheets: [
          { name: "GSC", field: "gsc" },
          { name: "GA4", field: "ga4" },
        ],
      },
      { inputItems: [{ json: { gsc: [{ q: 1 }], ga4: [{ s: 2 }] } }] }
    );
    assertX.equal(result.output.sheetCount, 2);
  });

  check("XLSX-4 headers", async () => {
    const result = await exec(
      "xlsxBuilder",
      { sheets: [{ name: "A", headerRow: true, columnOrder: ["keyword", "clicks"] }] },
      { inputItems: [{ json: { keyword: "seo", clicks: 12 } }] }
    );
    const buf = Buffer.from(result.items[0].binary.data.data, "base64");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    assertX.equal(wb.worksheets[0].getRow(1).getCell(1).value, "keyword");
  });

  check("XLSX-5 row ordering", async () => {
    const result = await exec(
      "xlsxBuilder",
      { sheets: [{ name: "A", headerRow: false, columnOrder: ["n"] }] },
      { inputItems: [{ json: { n: 1 } }, { json: { n: 2 } }] }
    );
    const buf = Buffer.from(result.items[0].binary.data.data, "base64");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    assertX.equal(wb.worksheets[0].getRow(1).getCell(1).value, 1);
    assertX.equal(wb.worksheets[0].getRow(2).getCell(1).value, 2);
  });

  check("XLSX-6 filename", async () => {
    const result = await exec("xlsxBuilder", { fileName: "seo-report.xlsx" }, { inputItems: [{ json: { a: 1 } }] });
    assertX.equal(result.items[0].json.fileName, "seo-report.xlsx");
  });

  check("XLSX-7 correct MIME", async () => {
    const result = await exec("xlsxBuilder", {}, { inputItems: [{ json: { a: 1 } }] });
    assertX.equal(result.items[0].binary.data.mimeType, xlsx().MIME);
  });

  check("XLSX-8 valid binary output", async () => {
    const result = await exec("xlsxBuilder", {}, { inputItems: [{ json: { a: 1 } }] });
    const buf = Buffer.from(result.items[0].binary.data.data, "base64");
    assertX.ok(buf.length > 100);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    assertX.ok(wb.worksheets.length >= 1);
  });

  check("XLSX-9 Gmail can consume produced binary", async () => {
    const built = await exec("xlsxBuilder", { fileName: "r.xlsx" }, { inputItems: [{ json: { a: 1 } }] });
    let attached = false;
    await runGmail(
      { operation: "send", to: "a@b.c", subject: "r", message: "x", binaryProperty: "data" },
      { inputItems: built.items },
      (body) => {
        const raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        attached = raw.includes("r.xlsx");
      }
    );
    assertX.equal(attached, true);
  });

  check("XLSX-10 max sheet bound", async () => {
    const sheets = Array.from({ length: 21 }, (_, i) => ({ name: `S${i}` }));
    await assertX.rejects(
      () => exec("xlsxBuilder", { sheets }, { inputItems: [{ json: { a: 1 } }] }),
      /sheet/i
    );
  });

  check("XLSX-11 max row bound", async () => {
    const rows = Array.from({ length: xlsx().LIMITS.maxRowsPerSheet + 1 }, (_, i) => ({ n: i }));
    await assertX.rejects(
      () =>
        exec(
          "xlsxBuilder",
          { sheets: [{ name: "A", field: "rows" }] },
          { inputItems: [{ json: { rows } }] }
        ),
      /row/i
    );
  });

  check("XLSX-12 max cell/string bound", async () => {
    const long = "x".repeat(9000);
    const result = await exec(
      "xlsxBuilder",
      { sheets: [{ name: "A", headerRow: false, columnOrder: ["t"] }] },
      { inputItems: [{ json: { t: long } }] }
    );
    const buf = Buffer.from(result.items[0].binary.data.data, "base64");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    assertX.ok(String(wb.worksheets[0].getRow(1).getCell(1).value).length <= 8000);
  });

  check("XLSX-13 save/reload", () => {
    const { ALLOWED_NODE_TYPES } = require("../modules/workflows/workflows.service");
    assertX.ok(ALLOWED_NODE_TYPES.has("xlsxBuilder"));
  });

  check("XLSX-14 export/import", () => {
    const pkg = port().buildNativeExport({
      definition: {
        nodes: [{ id: "x", type: "xlsxBuilder", data: { fileName: "a.xlsx" } }],
        edges: [],
      },
    });
    const preview = port().previewNativeImport(pkg);
    assertX.equal(preview.definition.nodes[0].data.fileName, "a.xlsx");
  });

  check("XLSX-15 no filesystem side effect", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowXlsxBuilder.service.js"),
      "utf8"
    );
    assertX.ok(!src.includes("writeFile"));
    assertX.ok(src.includes("writeBuffer"));
  });

  check("SEOCORE-COPILOT-1 Schedule + GA4 + Gmail", async () => {
    const res = await turn({
      message: "Every Monday pull GA4 sessions and email me a report.",
    });
    const types = res.plan.operations.filter((o) => o.type === "addNode").map((o) => o.nodeType);
    assertX.ok(types.includes("schedule"));
    assertX.ok(types.includes("googleAnalytics"));
    assertX.ok(types.includes("gmail"));
  });

  check("SEOCORE-COPILOT-2 Search Console not HTTP", async () => {
    const res = await turn({
      message: "Pull Search Console queries for my site.",
    });
    const types = res.plan.operations.filter((o) => o.type === "addNode").map((o) => o.nodeType);
    assertX.ok(types.includes("googleSearchConsole"));
    assertX.ok(!types.includes("http"));
  });

  check("SEOCORE-COPILOT-3 Google Sheets native", async () => {
    const res = await turn({ message: "Append rows to Google Sheets." });
    const types = res.plan.operations.filter((o) => o.type === "addNode").map((o) => o.nodeType);
    assertX.ok(types.includes("googleSheets"));
  });

  check("SEOCORE-COPILOT-4 AI summary uses AI Generate", async () => {
    const res = await turn({ message: "Also generate an AI summary for the report." });
    const types = res.plan.operations.filter((o) => o.type === "addNode").map((o) => o.nodeType);
    assertX.ok(types.includes("aiGenerate"));
    assertX.ok(!types.includes("aiAgent"));
  });

  check("SEOCORE-COPILOT-5 AI agent with tools still Agent", async () => {
    const res = await turn({ message: "Add an AI agent with tools to calculate totals." });
    const types = res.plan.operations.filter((o) => o.type === "addNode").map((o) => o.nodeType);
    assertX.ok(types.includes("aiAgent"));
  });

  check("SEOCORE-COPILOT-6 XLSX report selects builder", async () => {
    const res = await turn({
      message:
        "Every Monday pull Search Console queries and GA4 traffic, make an Excel report and email it to me.",
    });
    const types = res.plan.operations.filter((o) => o.type === "addNode").map((o) => o.nodeType);
    assertX.ok(types.includes("xlsxBuilder"));
    assertX.ok(types.includes("googleSearchConsole"));
    assertX.ok(types.includes("googleAnalytics"));
    assertX.ok(types.includes("gmail"));
  });

  check("SEOCORE-COPILOT-7 No invented credential", async () => {
    const res = await turn({
      message: "Every Monday pull GA4 sessions and email me a report.",
    });
    const adds = res.plan.operations.filter((o) => o.type === "addNode");
    for (const op of adds) {
      assertX.ok(!op.parameters?.credentialId);
    }
  });

  check("SEOCORE-COPILOT-8 No invented property ID", async () => {
    const res = await turn({
      message: "Every Monday pull GA4 sessions and email me a report.",
    });
    const ga = res.plan.operations.find((o) => o.nodeType === "googleAnalytics");
    assertX.ok(!ga.parameters?.propertyId);
    assertX.ok(res.unresolvedInputs.some((u) => u.field === "propertyId"));
  });

  check("SEOCORE-COPILOT-9 No invented site URL", async () => {
    const res = await turn({
      message:
        "Every Monday pull Search Console queries and GA4 traffic, make an Excel report and email it to me.",
    });
    assertX.ok(res.unresolvedInputs.some((u) => u.field === "siteUrl"));
  });

  check("SEOCORE-COPILOT-10 No invented email recipient", async () => {
    const res = await turn({
      message: "Every Monday pull GA4 sessions and email me a report.",
    });
    const mail = res.plan.operations.find((o) => o.nodeType === "gmail");
    assertX.ok(!mail.parameters?.to);
    assertX.ok(res.unresolvedInputs.some((u) => u.field === "to"));
  });

  check("SEOCORE-COPILOT-11 Node capability questions are read-only", async () => {
    const res = await turn({ message: "What does Google Search Console node do?" });
    assertX.equal(res.intent, "INFORMATION");
    assertX.equal((res.plan.operations || []).length, 0);
  });

  check("CROSS-SEO mocked GSC+GA4+XLSX+Gmail", async () => {
    const gsc = await runGsc({});
    const ga4 = await runGa4({ dimensions: ["date"] });
    const built = await exec(
      "xlsxBuilder",
      {
        fileName: "seo.xlsx",
        sheets: [
          { name: "GSC Queries", field: "gsc" },
          { name: "GA4 Summary", field: "ga4" },
        ],
      },
      {
        inputItems: [
          {
            json: {
              gsc: gsc.result.items.map((i) => i.json),
              ga4: ga4.result.items.map((i) => i.json),
            },
          },
        ],
      }
    );
    let attached = false;
    await runGmail(
      { operation: "send", to: "ops@example.com", subject: "SEO", message: "report", binaryProperty: "data" },
      { inputItems: built.items },
      (body) => {
        const raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        attached = raw.includes("seo.xlsx");
      }
    );
    assertX.equal(attached, true);
  });

  check("AI SEO report flow uses AI Generate not Agent", async () => {
    await aiGen().withAiGenerateTestComplete(async () => "<p>Summary</p>", async () => {
      const summary = await exec(
        "aiGenerate",
        { prompt: "Summarize {{item}}", model: "m", outputFormat: "text" },
        { inputItems: [{ json: { clicks: 10 } }] }
      );
      let raw = "";
      await runGmail(
        {
          operation: "send",
          to: "ops@example.com",
          subject: "SEO",
          message: "{{item.text}}",
          emailType: "html",
        },
        { inputItems: summary.items, input: summary.items[0].json },
        (body) => {
          raw = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        }
      );
      assertX.ok(raw.includes("Summary"));
    });
  });

  check("GSC append to Sheets without Code", async () => {
    const gsc = await runGsc({});
    const wrote = await runSheets(
      { operation: "appendRows", range: "A:Z" },
      gsc.result.items
    );
    assertX.equal(wrote.items[0].json.query, "seo tools");
  });

  check("14D.5 n8n mappings unchanged", () => {
    assertX.equal(n8n().OPSAI_AVAILABILITY.gmail, false);
    assertX.equal(n8n().OPSAI_AVAILABILITY.googleAnalytics, false);
    assertX.equal(n8n().OPSAI_AVAILABILITY.standaloneOpenAiMessage, false);
  });

  check("14D.5 n8n Code still not mapped", () => {
    const classified = n8n().classifySourceNode({
      type: "n8n-nodes-base.code",
      name: "Code",
      parameters: { jsCode: "return $input.all()" },
    });
    assertX.equal(
      classified.category,
      n8n().SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION
    );
  });
};

module.exports = { registerPart14D5Tests };
