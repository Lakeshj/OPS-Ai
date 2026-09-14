/**
 * Part 14D.5.5B — GA4 live acceptance gate regressions (deterministic).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D55BTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.5B GA4 live acceptance regressions");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");

  const googleNodes = () => require("../services/workflowGoogleNodes.service");
  const dates = () => require("../services/workflowGoogleDateRange");
  const oauth = () => require("../services/googleOAuth.service");
  const locator = () => require("../services/resourceLocator");

  const mockCred = (type = "google_ga4") => ({
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
    return oauth().withGoogleOAuthTestHooks(
      {
        transport,
        now: extra.now || (() => Date.now()),
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

  const exec = (data, context = {}) =>
    googleNodes().executeGoogleNode(
      { id: "n1", type: "googleAnalytics", data },
      {
        workspaceId: context.workspaceId || "ws-1",
        input: context.input ?? {},
        inputItems: context.inputItems,
        steps: context.steps || {},
        items: context.items || [],
      }
    );

  const emptyReport = { rows: [], dimensionHeaders: [], metricHeaders: [] };

  check("GA455B-1 missing connection uses Connect Google Analytics copy", async () => {
    await assertX.rejects(
      () => exec({ propertyId: "123456789" }),
      /Connect Google Analytics to continue/
    );
  });

  check("GA455B-2 zero rows is success with rowCount 0", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    const result = await withGoogle(
      async () => ({ status: 200, ok: true, body: emptyReport }),
      async () =>
        exec({
          credentialId: "c1",
          propertyId: "123456789",
          dateRange: "last7days",
          metrics: ["sessions", "totalUsers"],
          dimensions: ["date"],
          limit: 10,
        }),
      { store }
    );
    assertX.equal(result.output.rowCount, 0);
    assertX.equal(result.items.length, 0);
    assertX.equal(result.output.propertyId, "properties/123456789");
  });

  check("GA455B-3 invalid custom date range rejected safely", () => {
    assertX.throws(
      () =>
        dates().resolveDateRange("custom", {
          startDate: "2026-09-10",
          endDate: "2026-09-01",
        }),
      /startDate must be on or before endDate/
    );
  });

  check("GA455B-4 expression propertyId resolves for provider call", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    let capturedUrl = "";
    await withGoogle(
      async (url) => {
        capturedUrl = url;
        return { status: 200, ok: true, body: emptyReport };
      },
      async () => {
        await exec(
          {
            credentialId: "c1",
            propertyId: "{{input.ga4PropertyId}}",
            metrics: ["sessions"],
            dimensions: ["date"],
          },
          { input: { ga4PropertyId: "987654321" } }
        );
      },
      { store }
    );
    assertX.ok(capturedUrl.includes("properties/987654321"));
  });

  check("GA455B-5 invalid property 403 sanitized no token leak", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    await withGoogle(
      async () => ({
        status: 403,
        ok: false,
        body: { error: { message: "tok-live dump Authorization Bearer" } },
      }),
      async () => {
        try {
          await exec({ credentialId: "c1", propertyId: "000000001" });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_FORBIDDEN");
          const msg = String(err.message);
          assertX.ok(!msg.includes("tok-live"));
          assertX.ok(!msg.includes("Bearer"));
        }
      },
      { store }
    );
  });

  check("GA455B-6 order by sessions descending", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    let captured = null;
    await withGoogle(
      async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return { status: 200, ok: true, body: emptyReport };
      },
      async () => {
        await exec({
          credentialId: "c1",
          propertyId: "123",
          metrics: ["sessions"],
          dimensions: ["pageLocation"],
          orderByField: "sessions",
          orderDirection: "descending",
        });
      },
      { store }
    );
    assertX.equal(captured.orderBys[0].metric.metricName, "sessions");
    assertX.equal(captured.orderBys[0].desc, true);
  });

  check("GA455B-7 limit clamps and returnAll is bounded", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    let captured = null;
    await withGoogle(
      async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return { status: 200, ok: true, body: emptyReport };
      },
      async () => {
        await exec({
          credentialId: "c1",
          propertyId: "123",
          limit: 999999,
        });
      },
      { store }
    );
    assertX.equal(captured.limit, googleNodes().GA4_ROW_MAX);

    captured = null;
    await withGoogle(
      async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return { status: 200, ok: true, body: emptyReport };
      },
      async () => {
        await exec({
          credentialId: "c1",
          propertyId: "123",
          returnAll: true,
        });
      },
      { store }
    );
    assertX.ok(captured.limit <= googleNodes().GA4_ROW_MAX);
  });

  check("GA455B-8 unsupported metric rejected safely", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    await withGoogle(
      async () => ({ status: 200, ok: true, body: emptyReport }),
      async () => {
        await assertX.rejects(
          () =>
            exec({
              credentialId: "c1",
              propertyId: "123",
              metrics: ["not a metric!!!"],
            }),
          /Unsupported GA4 metric/
        );
      },
      { store }
    );
  });

  check("GA455B-9 dimension filter request shape", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    let captured = null;
    await withGoogle(
      async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return { status: 200, ok: true, body: emptyReport };
      },
      async () => {
        await exec({
          credentialId: "c1",
          propertyId: "123",
          dimensions: ["pageLocation"],
          metrics: ["sessions"],
          dimensionFilter: {
            field: "pageLocation",
            operator: "contains",
            value: "/blog",
          },
        });
      },
      { store }
    );
    assertX.equal(captured.dimensionFilter.filter.fieldName, "pageLocation");
  });

  check("GA455B-10 locator persists mode + GA4 Property ID label + Connect copy", () => {
    const locatorSrc = readFe("components/workflows/params/ResourceLocatorField.tsx");
    const renderer = readFe("components/workflows/params/NodeParameterRenderer.tsx");
    assertX.match(locatorSrc, /mode:\s*"account"/);
    assertX.match(locatorSrc, /mode:\s*"manual"/);
    assertX.match(locatorSrc, /mode:\s*"expression"/);
    assertX.match(locatorSrc, /Connect Google Analytics to continue/);
    assertX.match(renderer, /ga4Properties[\s\S]*Property ID/);
  });

  check("GA455B-11 connect-copy classifies as missing_credential", () => {
    assertX.equal(
      locator().classifyResourceLoadError({
        message: "Connect Google Analytics to continue.",
      }),
      "missing_credential"
    );
  });

  check("GA455B-12 account chooser remains select_account consent", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/googleOAuth.service.js"),
      "utf8"
    );
    assertX.match(src, /prompt:\s*"select_account consent"/);
    assertX.ok(!/login_hint:\s*["'][^"']+["']/.test(src));
  });

  check("GA455B-13 schema uses propertyIdMode + propertyDisplayName cache field", () => {
    const schema = readFe("modules/workflows/nodeParameterSchemas.ts");
    assertX.match(schema, /locatorModeField: "propertyIdMode"/);
    assertX.match(schema, /locatorLabelField: "propertyDisplayName"/);
    assertX.match(schema, /locatorKind: "ga4Properties"/);
  });

  check("GA455B-14 CUSTOM_APP refresh uses credential client (deterministic)", async () => {
    let tokenBody = "";
    await oauth().withGoogleOAuthTestHooks(
      {
        now: () => 1_000_000,
        transport: async (url, opts) => {
          if (String(url).includes("oauth2.googleapis.com/token")) {
            tokenBody = String(opts.body || "");
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
        await oauth().refreshAccessToken(
          {
            accessToken: "old",
            refreshToken: "ref-live",
            clientId: "ga4-custom-client",
            clientSecret: "ga4-custom-secret",
            oauthAppMode: "CUSTOM_APP",
            expiryMs: 1,
          },
          { oauthAppMode: "CUSTOM_APP", clientId: "ga4-custom-client" }
        );
      }
    );
    assertX.ok(tokenBody.includes("client_id=ga4-custom-client"));
    assertX.ok(tokenBody.includes("client_secret=ga4-custom-secret"));
    assertX.ok(!tokenBody.includes("GOOGLE_OAUTH_CLIENT"));
  });
};

module.exports = { registerPart14D55BTests };
