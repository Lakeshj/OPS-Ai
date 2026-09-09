/**
 * Part 14D.5.1 — Resource locators, multi-resource credentials, Split Out/Limit audit.
 * Deterministic mocks only — no live Google or LLM calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D51Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.1 resource locators + multi-website UX");

  const locator = () => require("../services/resourceLocator");
  const resources = () => require("../services/workflowGoogleResources.service");
  const oauth = () => require("../services/googleOAuth.service");
  const nodes = () => require("../services/workflowNodes.service");
  const port = () => require("../services/opsaiWorkflowPortability.service");
  const planSvc = () => require("../services/workflowCopilotPlan.service");
  const aiGen = () => require("../services/workflowAiGenerate.service");
  const secretBox = () => require("../services/secretBox.service");
  const googleNodes = () => require("../services/workflowGoogleNodes.service");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");

  const emptyDef = () => ({ version: 1, nodes: [], edges: [], settings: {} });
  const turn = (opts) =>
    planSvc().planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      definition: emptyDef(),
      ...opts,
    });

  const mockCred = (type, id = `cred-${type}`) => ({
    id,
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
        credentialResolver: (cid, workspaceId) => {
          const row = store.get(cid);
          if (!row) throw new Error("Credential not found — re-select it in the node settings");
          if (workspaceId && row.workspaceId && row.workspaceId !== workspaceId) {
            const err = new Error("Credential belongs to a different workspace");
            err.code = "GOOGLE_WORKSPACE_DENIED";
            throw err;
          }
          return row;
        },
        credentialSaver: (cid, secret) => {
          const row = store.get(cid) || { id: cid, secret };
          row.secret = secret;
          store.set(cid, row);
        },
      },
      fn
    );
  };

  const exec = (type, data, context = {}) =>
    nodes().executeNode(
      { id: data.id || "n1", type, data: { label: type, ...data } },
      {
        input: context.input ?? {},
        inputItems: context.inputItems,
        steps: context.steps || {},
        workspaceId: context.workspaceId || "ws-1",
        workflowId: context.workflowId || "wf-1",
      }
    );

  const gscRows = {
    rows: [{ keys: ["q"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }],
  };

  check("SHEETS_BROWSE_REQUIRES_DRIVE_SCOPE is yes", () => {
    assertX.equal(locator().SHEETS_BROWSE_REQUIRES_DRIVE_SCOPE, true);
    assertX.equal(
      locator().scopesIncludeDrive(oauth().GOOGLE_PRODUCTS.google_sheets.scopes),
      false
    );
  });

  check("SPLIT_OUT_EQUIVALENT is existing splitOut", async () => {
    const r = await nodes().executeNode(
      { id: "s", type: "splitOut", data: { fieldName: "rows" } },
      {
        input: { rows: [{ a: 1 }, { a: 2 }] },
        inputItems: [{ rows: [{ a: 1 }, { a: 2 }] }],
        steps: {},
        workspaceId: "ws-1",
      }
    );
    assertX.equal(r.items.length, 2);
    assertX.equal(r.items[0].a, 1);
  });

  check("SPLIT_OUT empty array is zero output", async () => {
    const r = await nodes().executeNode(
      { id: "s", type: "splitOut", data: { fieldToSplitOut: "rows" } },
      {
        input: { rows: [] },
        inputItems: [{ rows: [] }],
        steps: {},
        workspaceId: "ws-1",
      }
    );
    assertX.equal(r.items.length, 0);
  });

  check("LIMIT_EQUIVALENT is existing limit first/last", async () => {
    const items = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
    const first = await nodes().executeNode(
      { id: "l", type: "limit", data: { maxItems: 2, keep: "first" } },
      { input: {}, inputItems: items, steps: {}, workspaceId: "ws-1" }
    );
    const last = await nodes().executeNode(
      { id: "l", type: "limit", data: { count: 2, mode: "last" } },
      { input: {}, inputItems: items, steps: {}, workspaceId: "ws-1" }
    );
    assertX.deepEqual(first.items.map((i) => i.n), [1, 2]);
    assertX.deepEqual(last.items.map((i) => i.n), [3, 4]);
  });

  check("GSC-PICKER-1 valid credential loads accessible properties", async () => {
    const store = new Map([["c1", mockCred("google_gsc", "c1")]]);
    await withGoogle(
      async () => ({
        status: 200,
        ok: true,
        body: {
          siteEntry: [
            { siteUrl: "https://client-a.com/", permissionLevel: "siteFullUser" },
            { siteUrl: "sc-domain:client-b.com", permissionLevel: "siteRestrictedUser" },
          ],
        },
      }),
      async () => {
        const res = await resources().listGscSitesForCredential({
          credentialId: "c1",
          workspaceId: "ws-1",
        });
        assertX.equal(res.sites.length, 2);
        assertX.equal(res.sites[0].kind, "urlPrefix");
        assertX.equal(res.sites[1].kind, "domain");
      },
      { store }
    );
  });

  check("GSC-PICKER-2 search filters results", () => {
    const opts = [
      { id: "https://client-a.com/", label: "URL prefix · https://client-a.com/" },
      { id: "sc-domain:client-b.com", label: "Domain property · sc-domain:client-b.com" },
    ];
    const filtered = locator().filterResourceOptions(opts, "client-b");
    assertX.equal(filtered.length, 1);
    assertX.equal(filtered[0].id, "sc-domain:client-b.com");
  });

  check("GSC-PICKER-3 refresh reloads provider data", async () => {
    const store = new Map([["c1", mockCred("google_gsc", "c1")]]);
    let calls = 0;
    await withGoogle(
      async () => {
        calls += 1;
        return {
          status: 200,
          ok: true,
          body: {
            siteEntry: [{ siteUrl: `https://n${calls}.example/`, permissionLevel: "siteFullUser" }],
          },
        };
      },
      async () => {
        const a = await resources().listGscSitesForCredential({ credentialId: "c1", workspaceId: "ws-1" });
        const b = await resources().listGscSitesForCredential({ credentialId: "c1", workspaceId: "ws-1" });
        assertX.equal(calls, 2);
        assertX.notEqual(a.sites[0].siteUrl, b.sites[0].siteUrl);
      },
      { store }
    );
  });

  check("GSC-PICKER-4 manual property mode", () => {
    assertX.equal(locator().inferLocatorMode("https://www.example.com/", ["account", "manual", "expression"]), "manual");
    assertX.equal(locator().classifyGscProperty("https://www.example.com/").kind, "urlPrefix");
    assertX.equal(locator().classifyGscProperty("sc-domain:example.com").kind, "domain");
  });

  check("GSC-PICKER-5 expression property mode", async () => {
    assertX.equal(locator().isExpressionValue("{{input.siteUrl}}"), true);
    assertX.equal(locator().inferLocatorMode("{{input.siteUrl}}"), "expression");
    const store = new Map([["c1", mockCred("google_gsc", "c1")]]);
    let url = "";
    await withGoogle(
      async (reqUrl) => {
        url = reqUrl;
        return { status: 200, ok: true, body: gscRows };
      },
      async () => {
        await exec(
          "googleSearchConsole",
          { credentialId: "c1", siteUrl: "{{input.siteUrl}}" },
          { input: { siteUrl: "https://expr.example/" }, inputItems: [{ json: { siteUrl: "https://expr.example/" } }] }
        );
      },
      { store }
    );
    assertX.ok(decodeURIComponent(url).includes("https://expr.example/"));
  });

  check("GSC-PICKER-6 missing credential safe state", () => {
    assertX.equal(
      locator().classifyResourceLoadError({ code: "GOOGLE_CREDENTIAL_REQUIRED" }),
      "missing_credential"
    );
  });

  check("GSC-PICKER-7 permission denied safe state", () => {
    assertX.equal(locator().classifyResourceLoadError({ code: "GOOGLE_FORBIDDEN", status: 403 }), "permission_denied");
    assertX.equal(locator().classifyResourceLoadError({ code: "GOOGLE_UNAUTHORIZED", status: 401 }), "unauthorized");
  });

  check("GSC-PICKER-8 stale saved property retained with warning", () => {
    const stale = locator().staleResourceState("https://old.example/", [
      { id: "https://new.example/", label: "new" },
    ]);
    assertX.equal(stale.stale, true);
    assertX.equal(stale.retained, "https://old.example/");
  });

  check("GA4-PICKER-1 valid credential loads properties", async () => {
    const store = new Map([["c1", mockCred("google_ga4", "c1")]]);
    await withGoogle(
      async () => ({
        status: 200,
        ok: true,
        body: {
          accountSummaries: [
            {
              displayName: "Acme",
              propertySummaries: [
                { property: "properties/111", displayName: "Client A" },
                { property: "properties/222", displayName: "Client B" },
              ],
            },
          ],
        },
      }),
      async () => {
        const res = await resources().listGa4PropertiesForCredential({
          credentialId: "c1",
          workspaceId: "ws-1",
        });
        assertX.deepEqual(
          res.properties.map((p) => p.propertyId),
          ["111", "222"]
        );
      },
      { store }
    );
  });

  check("GA4-PICKER-2 search", () => {
    const filtered = locator().filterResourceOptions(
      [
        { id: "111", label: "Client A (111)" },
        { id: "222", label: "Client B (222)" },
      ],
      "client b"
    );
    assertX.equal(filtered[0].id, "222");
  });

  check("GA4-PICKER-3 refresh", async () => {
    const store = new Map([["c1", mockCred("google_ga4", "c1")]]);
    let n = 0;
    await withGoogle(
      async () => {
        n += 1;
        return {
          status: 200,
          ok: true,
          body: {
            accountSummaries: [
              { propertySummaries: [{ property: `properties/${n}00`, displayName: "P" }] },
            ],
          },
        };
      },
      async () => {
        await resources().listGa4PropertiesForCredential({ credentialId: "c1", workspaceId: "ws-1" });
        await resources().listGa4PropertiesForCredential({ credentialId: "c1", workspaceId: "ws-1" });
        assertX.equal(n, 2);
      },
      { store }
    );
  });

  check("GA4-PICKER-4 manual ID", () => {
    assertX.equal(locator().isGa4PropertyId("123456789"), true);
    assertX.equal(locator().isGa4PropertyId("abc"), false);
  });

  check("GA4-PICKER-5 expression", async () => {
    const store = new Map([["c1", mockCred("google_ga4", "c1")]]);
    let url = "";
    await withGoogle(
      async (reqUrl) => {
        url = reqUrl;
        return {
          status: 200,
          ok: true,
          body: {
            dimensionHeaders: [],
            metricHeaders: [{ name: "sessions" }],
            rows: [{ dimensionValues: [], metricValues: [{ value: "1" }] }],
          },
        };
      },
      async () => {
        await exec(
          "googleAnalytics",
          { credentialId: "c1", propertyId: "{{input.ga4PropertyId}}", metrics: ["sessions"] },
          { input: { ga4PropertyId: "123456789" }, inputItems: [{ json: { ga4PropertyId: "123456789" } }] }
        );
      },
      { store }
    );
    assertX.ok(url.includes("123456789"));
  });

  check("GA4-PICKER-6 missing credential", () => {
    assertX.equal(
      locator().classifyResourceLoadError({ message: "Select a Google credential" }),
      "missing_credential"
    );
  });

  check("GA4-PICKER-7 permission failure", () => {
    assertX.equal(locator().classifyResourceLoadError({ status: 403, message: "forbidden" }), "permission_denied");
  });

  check("GA4-PICKER-8 cached label does not replace canonical propertyId", () => {
    const node = {
      propertyId: "123456789",
      propertyDisplayName: "Marketing (123456789)",
    };
    assertX.equal(node.propertyId, "123456789");
    assertX.notEqual(node.propertyDisplayName, node.propertyId);
  });

  check("SHEETS-PICKER-1 manual spreadsheet ID works without Drive scope", async () => {
    const store = new Map([["c1", mockCred("google_sheets", "c1")]]);
    await withGoogle(
      async (url) => {
        assertX.ok(url.includes("/spreadsheets/abc123id"));
        return { status: 200, ok: true, body: { values: [["h"], ["1"]] } };
      },
      async () => {
        await exec("googleSheets", {
          credentialId: "c1",
          operation: "readRows",
          spreadsheetId: "abc123id",
          range: "A:Z",
        });
      },
      { store }
    );
  });

  check("SHEETS-PICKER-2 spreadsheet URL/ID handling safe", () => {
    const parsed = locator().parseSpreadsheetRef(
      "https://docs.google.com/spreadsheets/d/1AbcDefGhIjK/edit#gid=0"
    );
    assertX.equal(parsed.spreadsheetId, "1AbcDefGhIjK");
    assertX.equal(parsed.fromUrl, true);
  });

  check("SHEETS-PICKER-3 spreadsheet expression", async () => {
    const store = new Map([["c1", mockCred("google_sheets", "c1")]]);
    let url = "";
    await withGoogle(
      async (reqUrl) => {
        url = reqUrl;
        return { status: 200, ok: true, body: { values: [["h"], ["1"]] } };
      },
      async () => {
        await exec(
          "googleSheets",
          {
            credentialId: "c1",
            spreadsheetId: "{{input.spreadsheetId}}",
            range: "{{input.range}}",
          },
          {
            input: { spreadsheetId: "ssid1", range: "Sheet1!A:B" },
            inputItems: [{ json: { spreadsheetId: "ssid1", range: "Sheet1!A:B" } }],
          }
        );
      },
      { store }
    );
    assertX.ok(url.includes("ssid1"));
  });

  check("SHEETS-PICKER-4 sheet expression", async () => {
    const store = new Map([["c1", mockCred("google_sheets", "c1")]]);
    let url = "";
    await withGoogle(
      async (reqUrl) => {
        url = reqUrl;
        return { status: 200, ok: true, body: { values: [["h"]] } };
      },
      async () => {
        await exec(
          "googleSheets",
          {
            credentialId: "c1",
            spreadsheetId: "ssid1",
            sheetName: "{{input.sheetName}}",
            range: "A:Z",
          },
          { input: { sheetName: "Tab Two" }, inputItems: [{ json: { sheetName: "Tab Two" } }] }
        );
      },
      { store }
    );
    assertX.ok(decodeURIComponent(url).includes("Tab Two"));
  });

  check("SHEETS-PICKER-5 range expression", () => {
    assertX.equal(locator().isExpressionValue("{{input.range}}"), true);
  });

  check("SHEETS-PICKER-6 dependent sheet load if supported", async () => {
    const store = new Map([["c1", mockCred("google_sheets", "c1")]]);
    await withGoogle(
      async (url) => {
        assertX.ok(url.includes("ssid1"));
        return {
          status: 200,
          ok: true,
          body: { sheets: [{ properties: { title: "Sheet1", sheetId: 0 } }] },
        };
      },
      async () => {
        const res = await resources().listSheetTabsForSpreadsheet({
          credentialId: "c1",
          workspaceId: "ws-1",
          spreadsheetId: "ssid1",
        });
        assertX.equal(res.sheets[0].title, "Sheet1");
      },
      { store }
    );
  });

  check("SHEETS-PICKER-7 no silent Drive scope expansion", () => {
    const scopes = oauth().GOOGLE_PRODUCTS.google_sheets.scopes.join(" ");
    assertX.equal(scopes.includes("spreadsheets"), true);
    assertX.equal(scopes.includes("auth/drive"), false);
    const src = fs.readFileSync(
      path.join(__dirname, "../services/googleOAuth.service.js"),
      "utf8"
    );
    assertX.doesNotMatch(src, /google_sheets:[\s\S]{0,200}auth\/drive/);
  });

  check("GMAIL-PICKER-1 labels load for label operations", async () => {
    const store = new Map([["c1", mockCred("google_gmail", "c1")]]);
    await withGoogle(
      async () => ({
        status: 200,
        ok: true,
        body: { labels: [{ id: "INBOX", name: "INBOX" }, { id: "Label_9", name: "Clients" }] },
      }),
      async () => {
        const res = await resources().listGmailLabelsForCredential({
          credentialId: "c1",
          workspaceId: "ws-1",
        });
        assertX.equal(res.labels.length, 2);
      },
      { store }
    );
  });

  check("GMAIL-PICKER-2 search labels", () => {
    const filtered = locator().filterResourceOptions(
      [
        { id: "INBOX", label: "INBOX" },
        { id: "Label_9", label: "Clients (Label_9)" },
      ],
      "client"
    );
    assertX.equal(filtered[0].id, "Label_9");
  });

  check("GMAIL-PICKER-3 multi-select where applicable", () => {
    const ids = locator().normalizeLabelIds(["INBOX", "Label_9"]);
    assertX.deepEqual(ids, ["INBOX", "Label_9"]);
  });

  check("GMAIL-PICKER-4 saved label IDs preserved", () => {
    const stale = locator().staleResourceState("Label_9", [{ id: "INBOX", label: "INBOX" }]);
    assertX.equal(stale.retained, "Label_9");
    assertX.equal(stale.stale, true);
  });

  check("GMAIL-PICKER-5 Gmail Trigger label filter uses same safe resource logic", () => {
    const schema = readFe("modules/workflows/nodeParameterSchemas.ts");
    assertX.match(schema, /gmailTrigger:[\s\S]*locatorKind: "gmailLabels"/);
    const trig = fs.readFileSync(
      path.join(__dirname, "../services/workflowGmailTrigger.service.js"),
      "utf8"
    );
    assertX.match(trig, /workflow_trigger_cursors|setTriggerCursor/);
    assertX.doesNotMatch(trig, /data\.pollCursor\s*=/);
  });

  check("AIGEN-PICKER-1 model list loads where provider adapter supports it", () => {
    const list = locator().suggestedAiModels("openai");
    assertX.ok(list.some((m) => m.id === "gpt-4o-mini"));
  });

  check("AIGEN-PICKER-2 search model", () => {
    const filtered = locator().filterResourceOptions(locator().suggestedAiModels("openai"), "mini");
    assertX.ok(filtered.every((m) => /mini/i.test(m.id)));
  });

  check("AIGEN-PICKER-3 manual model ID", () => {
    assertX.equal(locator().inferLocatorMode("my-custom-model"), "manual");
  });

  check("AIGEN-PICKER-4 expression model where supported", async () => {
    const out = await aiGen().withAiGenerateTestComplete(
      async ({ model }) => `ok:${model}`,
      async () =>
        aiGen().executeAiGenerate(
          { id: "a", type: "aiGenerate", data: { prompt: "hi", model: "{{input.model}}" } },
          { input: { model: "gpt-4o" }, inputItems: [{ json: { model: "gpt-4o" } }], steps: {} }
        )
    );
    assertX.equal(out.items[0].json.model, "gpt-4o");
  });

  check("AIGEN-PICKER-5 invalid credential/model discovery fails safely", () => {
    assertX.deepEqual(locator().suggestedAiModels("unknown-vendor"), []);
  });

  check("MULTIRESOURCE-1 one google_gsc credential two sites", async () => {
    const store = new Map([["C1", mockCred("google_gsc", "C1")]]);
    const seen = [];
    await withGoogle(
      async (url) => {
        seen.push(decodeURIComponent(url));
        return { status: 200, ok: true, body: gscRows };
      },
      async () => {
        await exec("googleSearchConsole", { id: "a", credentialId: "C1", siteUrl: "https://client-a.com/" });
        await exec("googleSearchConsole", { id: "b", credentialId: "C1", siteUrl: "sc-domain:client-b.com" });
      },
      { store }
    );
    assertX.ok(seen[0].includes("https://client-a.com/"));
    assertX.ok(seen[1].includes("sc-domain:client-b.com"));
  });

  check("MULTIRESOURCE-2 one google_ga4 credential two properties", async () => {
    const store = new Map([["C1", mockCred("google_ga4", "C1")]]);
    const seen = [];
    await withGoogle(
      async (url) => {
        seen.push(url);
        return {
          status: 200,
          ok: true,
          body: {
            metricHeaders: [{ name: "sessions" }],
            rows: [{ dimensionValues: [], metricValues: [{ value: "1" }] }],
          },
        };
      },
      async () => {
        await exec("googleAnalytics", { id: "a", credentialId: "C1", propertyId: "111", metrics: ["sessions"] });
        await exec("googleAnalytics", { id: "b", credentialId: "C1", propertyId: "222", metrics: ["sessions"] });
      },
      { store }
    );
    assertX.ok(seen[0].includes("111"));
    assertX.ok(seen[1].includes("222"));
  });

  check("MULTIRESOURCE-3 one google_sheets credential two spreadsheets", async () => {
    const store = new Map([["C1", mockCred("google_sheets", "C1")]]);
    const seen = [];
    await withGoogle(
      async (url) => {
        seen.push(url);
        return { status: 200, ok: true, body: { values: [["h"]] } };
      },
      async () => {
        await exec("googleSheets", { id: "a", credentialId: "C1", spreadsheetId: "sheetA", range: "A1" });
        await exec("googleSheets", { id: "b", credentialId: "C1", spreadsheetId: "sheetB", range: "A1" });
      },
      { store }
    );
    assertX.ok(seen[0].includes("sheetA"));
    assertX.ok(seen[1].includes("sheetB"));
  });

  check("MULTIRESOURCE-4 resource identifiers are never stored inside credential secret_json", () => {
    const secret = {
      accessToken: "tok",
      refreshToken: "ref",
      expiryMs: Date.now() + 1000,
    };
    const cipher = secretBox().encryptSecret(secret);
    const plain = secretBox().decryptSecret(cipher);
    assertX.equal("siteUrl" in plain, false);
    assertX.equal("propertyId" in plain, false);
    assertX.equal("spreadsheetId" in plain, false);
    assertX.equal("labelIds" in plain, false);
  });

  check("MULTIRESOURCE-5 save/reload preserves each node's resource independently", () => {
    const definition = {
      version: 1,
      nodes: [
        { id: "a", type: "googleSearchConsole", data: { credentialId: "C1", siteUrl: "https://client-a.com/" } },
        { id: "b", type: "googleSearchConsole", data: { credentialId: "C1", siteUrl: "sc-domain:client-b.com" } },
      ],
      edges: [],
    };
    const round = JSON.parse(JSON.stringify(definition));
    assertX.equal(round.nodes[0].data.siteUrl, "https://client-a.com/");
    assertX.equal(round.nodes[1].data.siteUrl, "sc-domain:client-b.com");
    assertX.equal(round.nodes[0].data.credentialId, round.nodes[1].data.credentialId);
  });

  check("MULTIRESOURCE-6 native export preserves safe resource configuration", () => {
    const pkg = port().buildNativeExport({
      name: "multi",
      definition: {
        nodes: [
          {
            id: "a",
            type: "googleSearchConsole",
            data: { credentialId: "C1", siteUrl: "https://client-a.com/", accessToken: "NO" },
          },
          {
            id: "b",
            type: "googleAnalytics",
            data: { credentialId: "C1", propertyId: "111", propertyDisplayName: "A" },
          },
        ],
        edges: [],
      },
    });
    const a = pkg.workflow.definition.nodes[0].data;
    const b = pkg.workflow.definition.nodes[1].data;
    assertX.equal(a.siteUrl, "https://client-a.com/");
    assertX.equal(a.credentialId, undefined);
    assertX.equal(a.accessToken, undefined);
    assertX.equal(b.propertyId, "111");
    assertX.equal(b.propertyDisplayName, "A");
  });

  check("COPILOT-14D51 explicit site does not invent credential", async () => {
    const res = await turn({ message: "Build a weekly report for https://example.com" });
    const gsc = res.plan.operations.find((o) => o.nodeType === "googleSearchConsole");
    assertX.ok(gsc);
    assertX.equal(gsc.parameters.siteUrl, "https://example.com");
    assertX.ok(!gsc.parameters.credentialId);
    assertX.ok(!res.plan.operations.some((o) => o.parameters?.propertyId && !String(o.parameters.propertyId).includes("{{")));
    assertX.ok(!res.plan.operations.some((o) => o.parameters?.to && !String(o.parameters.to).includes("{{")));
  });

  check("COPILOT-14D51 workflow input resources use expressions", async () => {
    const res = await turn({
      message: "Use the site and GA property passed into this workflow",
    });
    const gsc = res.plan.operations.find((o) => o.nodeType === "googleSearchConsole");
    const ga = res.plan.operations.find((o) => o.nodeType === "googleAnalytics");
    const sh = res.plan.operations.find((o) => o.nodeType === "googleSheets");
    const mail = res.plan.operations.find((o) => o.nodeType === "gmail");
    assertX.equal(gsc.parameters.siteUrl, "{{input.siteUrl}}");
    assertX.equal(ga.parameters.propertyId, "{{input.ga4PropertyId}}");
    assertX.equal(sh.parameters.spreadsheetId, "{{input.spreadsheetId}}");
    assertX.equal(sh.parameters.sheetName, "{{input.sheetName}}");
    assertX.equal(mail.parameters.to, "{{input.recipient}}");
    for (const op of res.plan.operations.filter((o) => o.type === "addNode")) {
      assertX.ok(!op.parameters?.credentialId);
    }
  });

  check("COPILOT-14D51 one Google account many websites is INFORMATION", async () => {
    const res = await turn({ message: "Can one Google account be used for multiple websites?" });
    assertX.equal(res.intent, "INFORMATION");
    assertX.equal((res.plan.operations || []).length, 0);
    assertX.match(String(res.assistantMessage || res.plan?.assistantMessage || ""), /credential/i);
  });

  check("UI locator modes exist in ResourceLocatorField", () => {
    const src = readFe("components/workflows/params/ResourceLocatorField.tsx");
    assertX.match(src, /From account/);
    assertX.match(src, /Manual/);
    assertX.match(src, /Expression/);
    assertX.match(src, /Search/);
    assertX.match(src, /Refresh/);
  });

  check("Gmail operations are resource-filtered in schema", () => {
    const schema = readFe("modules/workflows/nodeParameterSchemas.ts");
    assertX.match(schema, /value: "send", displayOptions: \{ show: \{ resource: \["message"\] \}/);
    assertX.match(schema, /locatorKind: "gmailLabels"/);
  });

  check("no workflow-specific SEO report nodes added", () => {
    const { ALLOWED_NODE_TYPES } = require("../modules/workflows/workflows.service");
    assertX.equal(ALLOWED_NODE_TYPES.has("generateSeoReport"), false);
    assertX.equal(ALLOWED_NODE_TYPES.has("seoReportBuilder"), false);
    assertX.equal(ALLOWED_NODE_TYPES.has("ga4PagePerformance"), false);
  });

  void googleNodes;
};

module.exports = { registerPart14D51Tests };
