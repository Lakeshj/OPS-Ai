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

  check("GA455B-15 schema hides unused resource/operation and advertises 10k cap", () => {
    const schema = readFe("modules/workflows/nodeParameterSchemas.ts");
    const gaBlock = schema.slice(
      schema.indexOf("googleAnalytics:"),
      schema.indexOf("gmail:", schema.indexOf("googleAnalytics:"))
    );
    assertX.ok(!/name:\s*"resource"/.test(gaBlock));
    assertX.ok(!/name:\s*"operation"/.test(gaBlock));
    assertX.match(gaBlock, /Return all \(max 10,000 rows\)/);
    assertX.match(gaBlock, /customRenderer:\s*"ga4Filter"/);
    assertX.match(gaBlock, /customRenderer:\s*"ga4OrderBy"/);
  });

  check("GA455B-16 FE/BE GA4 catalogs stay in parity", () => {
    const catalog = require("../services/ga4Catalog");
    const fe = readFe("modules/workflows/ga4Catalog.ts");
    for (const m of catalog.GA4_METRICS) {
      assertX.ok(fe.includes(`"${m}"`) || fe.includes(`'${m}'`), `FE missing metric ${m}`);
    }
    for (const d of catalog.GA4_DIMENSIONS) {
      assertX.ok(fe.includes(`"${d}"`) || fe.includes(`'${d}'`), `FE missing dimension ${d}`);
    }
    assertX.ok(catalog.GA4_METRICS.has("bounceRate"));
    assertX.ok(catalog.GA4_METRICS.has("keyEvents"));
    assertX.ok(catalog.GA4_DIMENSIONS.has("eventName"));
    assertX.ok(catalog.GA4_DIMENSIONS.has("sessionDefaultChannelGroup"));
  });

  check("GA455B-17 metric filter + order by dimension request shape", async () => {
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
          metrics: ["sessions", "bounceRate"],
          dimensions: ["pagePath", "eventName"],
          metricFilter: {
            field: "sessions",
            operator: "gt",
            value: 10,
          },
          orderByField: "pagePath",
          orderDirection: "ascending",
        });
      },
      { store }
    );
    assertX.equal(captured.metricFilter.filter.fieldName, "sessions");
    assertX.equal(captured.metricFilter.filter.numericFilter.operation, "GREATER_THAN");
    assertX.equal(captured.orderBys[0].dimension.dimensionName, "pagePath");
    assertX.equal(captured.orderBys[0].desc, false);
  });

  check("GA455B-18 order by outside selection rejected", async () => {
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
              metrics: ["sessions"],
              dimensions: ["date"],
              orderByField: "bounceRate",
            }),
          /Order by must be one of the selected/
        );
      },
      { store }
    );
  });

  check("GA455B-19 flat numeric metric output + fan-out items", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_ga4"), id: "c1" });
    const result = await withGoogle(
      async () => ({
        status: 200,
        ok: true,
        body: {
          dimensionHeaders: [{ name: "pagePath" }],
          metricHeaders: [{ name: "sessions" }, { name: "engagementRate" }],
          rows: [
            {
              dimensionValues: [{ value: "/a" }],
              metricValues: [{ value: "42" }, { value: "0.55" }],
            },
            {
              dimensionValues: [{ value: "/b" }],
              metricValues: [{ value: "7" }, { value: "0.12" }],
            },
          ],
        },
      }),
      async () =>
        exec({
          credentialId: "c1",
          propertyId: "123",
          metrics: ["sessions", "engagementRate"],
          dimensions: ["pagePath"],
        }),
      { store }
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.pagePath, "/a");
    assertX.strictEqual(result.items[0].json.sessions, 42);
    assertX.strictEqual(result.items[0].json.engagementRate, 0.55);
    assertX.equal(typeof result.items[0].json.sessions, "number");
    assertX.ok(result.items[0].pairedItem);
    assertX.equal(result.output.rowCount, 2);
  });

  check("GA455B-20 expanded curated metric accepted in request body", async () => {
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
          metrics: ["keyEvents", "totalRevenue"],
          dimensions: ["sessionDefaultChannelGroup", "eventName"],
        });
      },
      { store }
    );
    assertX.deepEqual(
      captured.metrics.map((m) => m.name),
      ["keyEvents", "totalRevenue"]
    );
    assertX.deepEqual(
      captured.dimensions.map((d) => d.name),
      ["sessionDefaultChannelGroup", "eventName"]
    );
  });
};
module.exports = { registerPart14D55BTests };
