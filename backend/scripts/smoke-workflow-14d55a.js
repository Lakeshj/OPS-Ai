/**
 * Part 14D.5.5A — GSC live acceptance gate regressions (deterministic).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D55ATests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.5A GSC live acceptance regressions");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");

  const googleNodes = () => require("../services/workflowGoogleNodes.service");
  const dates = () => require("../services/workflowGoogleDateRange");
  const oauth = () => require("../services/googleOAuth.service");
  const locator = () => require("../services/resourceLocator");

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
      { id: "n1", type: "googleSearchConsole", data },
      {
        workspaceId: context.workspaceId || "ws-1",
        input: context.input ?? {},
        inputItems: context.inputItems,
        steps: context.steps || {},
        items: context.items || [],
      }
    );

  check("GSC55A-1 missing connection uses Connect GSC copy", async () => {
    await assertX.rejects(
      () => exec({ siteUrl: "https://opsai.socialchamps.com/" }),
      /Connect Google Search Console to continue/
    );
  });

  check("GSC55A-2 zero rows is success with rowCount 0", async () => {
    const store = new Map();
    store.set("c1", mockCred("google_gsc"));
    store.get("c1").id = "c1";
    const result = await withGoogle(
      async () => ({ status: 200, ok: true, body: { rows: [] } }),
      async () =>
        exec({
          credentialId: "c1",
          siteUrl: "https://opsai.socialchamps.com/",
          operation: "getQueries",
          dateRange: "last7days",
          rowLimit: 10,
        }),
      { store }
    );
    assertX.equal(result.output.rowCount, 0);
    assertX.equal(result.items.length, 0);
    assertX.equal(result.output.dimension, "query");
    assertX.equal(result.output.siteUrl, "https://opsai.socialchamps.com/");
  });

  check("GSC55A-3 invalid custom date range rejected safely", () => {
    assertX.throws(
      () =>
        dates().resolveDateRange("custom", {
          startDate: "2026-09-10",
          endDate: "2026-09-01",
        }),
      /startDate must be on or before endDate/
    );
  });

  check("GSC55A-4 row limit clamps excessive and coerces invalid", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_gsc"), id: "c1" });
    let captured = null;
    await withGoogle(
      async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return { status: 200, ok: true, body: { rows: [] } };
      },
      async () => {
        await exec({
          credentialId: "c1",
          siteUrl: "https://opsai.socialchamps.com/",
          rowLimit: 99999,
        });
      },
      { store }
    );
    assertX.equal(captured.rowLimit, googleNodes().GSC_ROW_MAX);

    captured = null;
    await withGoogle(
      async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return { status: 200, ok: true, body: { rows: [] } };
      },
      async () => {
        await exec({
          credentialId: "c1",
          siteUrl: "https://opsai.socialchamps.com/",
          rowLimit: 0,
        });
      },
      { store }
    );
    assertX.ok(captured.rowLimit >= 1);
  });

  check("GSC55A-5 invalid property 403 sanitized no token leak", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_gsc"), id: "c1" });
    await withGoogle(
      async () => ({
        status: 403,
        ok: false,
        body: { error: { message: "tok-live dump Authorization Bearer" } },
      }),
      async () => {
        try {
          await exec({
            credentialId: "c1",
            siteUrl: "https://not-a-real-gsc-property.invalid/",
          });
          assertX.fail("expected throw");
        } catch (err) {
          assertX.equal(err.code, "GOOGLE_FORBIDDEN");
          const msg = String(err.message);
          assertX.ok(!msg.includes("tok-live"));
          assertX.ok(!msg.includes("Bearer"));
          assertX.ok(!msg.includes("Authorization"));
        }
      },
      { store }
    );
  });

  check("GSC55A-6 expression siteUrl resolves for provider call", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_gsc"), id: "c1" });
    let capturedUrl = "";
    await withGoogle(
      async (url) => {
        capturedUrl = url;
        return { status: 200, ok: true, body: { rows: [] } };
      },
      async () => {
        await exec(
          {
            credentialId: "c1",
            siteUrl: "{{input.siteUrl}}",
            operation: "getQueries",
          },
          { input: { siteUrl: "https://opsai.socialchamps.com/" } }
        );
      },
      { store }
    );
    assertX.ok(
      capturedUrl.includes(encodeURIComponent("https://opsai.socialchamps.com/"))
    );
  });

  check("GSC55A-7 account chooser prompt remains select_account consent", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/googleOAuth.service.js"),
      "utf8"
    );
    assertX.match(src, /prompt:\s*"select_account consent"/);
    assertX.ok(!/login_hint:\s*["'][^"']+["']/.test(src));
  });

  check("GSC55A-8 locator persists mode on account/manual/expression edits", () => {
    const src = readFe("components/workflows/params/ResourceLocatorField.tsx");
    assertX.match(src, /mode:\s*"account"/);
    assertX.match(src, /mode:\s*"manual"/);
    assertX.match(src, /mode:\s*"expression"/);
    assertX.match(src, /Connect Google Search Console to continue/);
  });

  check("GSC55A-9 connect-copy classifies as missing_credential", () => {
    assertX.equal(
      locator().classifyResourceLoadError({
        message: "Connect Google Search Console to continue.",
      }),
      "missing_credential"
    );
  });

  check("GSC55A-10 zero-row pages success", async () => {
    const store = new Map();
    store.set("c1", { ...mockCred("google_gsc"), id: "c1" });
    const result = await withGoogle(
      async () => ({ status: 200, ok: true, body: { rows: [] } }),
      async () =>
        exec({
          credentialId: "c1",
          siteUrl: "https://opsai.socialchamps.com/",
          operation: "getPages",
          rowLimit: 10,
        }),
      { store }
    );
    assertX.equal(result.output.dimension, "page");
    assertX.equal(result.output.rowCount, 0);
  });
};

module.exports = { registerPart14D55ATests };
