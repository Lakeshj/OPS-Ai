/**
 * Meta Ads M3 — native read-only Meta Ads node + core Insights reports.
 * Mocked Graph transport only. No live Meta calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const LONG = "EAATestLongLivedTokenValue";
const APP_SECRET = "meta-app-secret-test";
const CRED_ID = "cred-meta-m3";
const ACCOUNT = "123456789";
const NOW = Date.parse("2026-10-06T12:00:00Z");
const ADMIN = { role: "Admin", id: "user-1", userId: "user-1" };

const registerMetaAdsM3Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Meta Ads M3 native node + Insights reports");

  const ads = () => require("../services/workflowMetaAds.service");
  const catalog = () => require("../services/metaAdsReportCatalog");
  const grounding = () => require("../services/workflowMetaAdsAiGrounding");
  const oauth = () => require("../services/metaOAuth.service");
  const metaGraph = () => require("../config/metaGraph");

  const root = path.join(__dirname, "..", "..");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const newBackendFiles = [
    "backend/services/workflowMetaAds.service.js",
    "backend/services/metaAdsReportCatalog.js",
    "backend/services/workflowMetaAdsAiGrounding.js",
  ];

  const withApp = async (fn) => {
    const prevId = process.env.META_APP_ID;
    const prevSecret = process.env.META_APP_SECRET;
    process.env.META_APP_ID = "meta-app-id";
    process.env.META_APP_SECRET = APP_SECRET;
    try {
      return await fn();
    } finally {
      if (prevId == null) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = prevId;
      if (prevSecret == null) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = prevSecret;
    }
  };

  const cred = (type = "meta_ads") => ({
    id: CRED_ID,
    type,
    workspaceId: "ws-1",
    name: "Meta Ads",
    secret: { accessToken: LONG, expiresAt: "2030-01-01T00:00:00.000Z" },
    config: { selectedAdAccountId: ACCOUNT },
  });

  const insightRow = (i, extra = {}) => ({
    account_id: ACCOUNT,
    account_name: "Acme",
    account_currency: "EUR",
    impressions: "1000",
    reach: "800",
    frequency: "1.25",
    clicks: "40",
    inline_link_clicks: "25",
    ctr: "4",
    cpc: "0.5",
    cpm: "20",
    spend: "20.00",
    actions: [
      { action_type: "link_click", value: "25" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
    ],
    action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "99.50" }],
    cost_per_action_type: [{ action_type: "link_click", value: "0.8" }],
    date_start: `2026-09-${String(29 + (i % 2)).padStart(2, "0")}`,
    date_stop: `2026-09-${String(29 + (i % 2)).padStart(2, "0")}`,
    ...extra,
  });

  /**
   * Mock Graph. Account context → timezone; insights → pages.
   * pageFor(index, query) returns { data, paging }.
   */
  const runWith = async ({
    data = {},
    timezone = "America/Los_Angeles",
    pageFor,
    credential = cred(),
    now = NOW,
    inputItems,
  }) => {
    const calls = [];
    const node = {
      id: "meta-1",
      type: "metaAds",
      data: {
        nodeType: "metaAds",
        credentialId: CRED_ID,
        adAccountId: ACCOUNT,
        resource: "report",
        operation: "runReport",
        reportType: "campaign_performance",
        limit: 100,
        returnAll: false,
        ...data,
      },
    };
    let insightsIndex = 0;
    const result = await withApp(() =>
      ads().withMetaTestHooks(
        {
          now: () => now,
          loadCredential: async () => credential,
          transport: async (url, options) => {
            const u = new URL(url);
            const query = Object.fromEntries(u.searchParams.entries());
            calls.push({ url, path: u.pathname, query, method: options?.method });
            if (u.pathname.endsWith("/insights")) {
              const page = pageFor
                ? pageFor(insightsIndex, query)
                : { data: [insightRow(0), insightRow(1)] };
              insightsIndex += 1;
              return { ok: true, status: 200, body: page };
            }
            if (/\/act_\d+$/.test(u.pathname)) {
              return {
                ok: true,
                status: 200,
                body: {
                  id: `act_${ACCOUNT}`,
                  account_id: ACCOUNT,
                  name: "Acme",
                  currency: "EUR",
                  timezone_name: timezone,
                  account_status: 1,
                },
              };
            }
            return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
          },
        },
        () =>
          ads().executeMetaAdsNode(node, {
            workspaceId: "ws-1",
            inputItems: inputItems || [{ json: {} }],
            steps: {},
          })
      )
    );
    const insightCalls = calls.filter((c) => c.path.endsWith("/insights"));
    return { result, calls, insightCalls, node };
  };

  const rejectsCode = async (fn, code) => {
    await assertX.rejects(fn, (err) => {
      assertX.equal(err.code, code, err.message);
      return true;
    });
  };

  check("META-M3-1 Meta Ads appears in the Node Library", () => {
    const lib = JSON.parse(read("frontend/src/modules/workflows/nodeLibrary.json"));
    const nodes = lib.nodes || lib;
    const entry = nodes.find((n) => n.engineType === "metaAds");
    assertX.ok(entry);
    assertX.equal(entry.name, "Meta Ads");
    assertX.equal(entry.provider, "Meta");
    assertX.equal(entry.available, true);
  });

  check("META-M3-2 node type is metaAds across engine, contracts and UI", () => {
    const { handlers } = require("../services/workflowNodes.service");
    assertX.equal(typeof handlers.metaAds, "function");
    const backendContract = require("../config/nodeContract");
    const text = JSON.stringify(backendContract);
    assertX.ok(text.includes("metaAds"));
    assertX.ok(read("frontend/src/modules/workflows/nodeContract.ts").includes('type: "metaAds"'));
    assertX.ok(read("frontend/src/modules/workflows/types.ts").includes('| "metaAds"'));
    assertX.ok(read("frontend/src/components/workflows/WorkflowCanvas.tsx").includes("metaAds: WorkflowNode"));
    const { validateDefinition } = require("../modules/workflows/workflows.service");
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Manual", nodeType: "trigger" } },
        { id: "m", type: "metaAds", position: { x: 200, y: 0 }, data: { label: "Meta Ads", nodeType: "metaAds", credentialId: CRED_ID, adAccountId: ACCOUNT, reportType: "account_performance" } },
      ],
      edges: [{ id: "e1", source: "t", target: "m" }],
      settings: {},
    };
    validateDefinition(def);
  });

  check("META-M3-3 credential picker accepts meta_ads only", async () => {
    const schema = read("frontend/src/modules/workflows/nodeParameterSchemas.ts");
    const block = schema.slice(schema.indexOf("    metaAds: ["), schema.indexOf("    googleAnalytics: ["));
    assertX.ok(block.includes('credentialTypes: ["meta_ads"]'));
    assertX.ok(block.includes('displayName: "Meta Ads Account"'));
    assertX.equal((block.match(/credentialTypes:/g) || []).length, 1);
    await rejectsCode(() => runWith({ credential: cred("google_ads") }), "META_CREDENTIAL_REQUIRED");
  });

  check("META-M3-4 accessible ad accounts populate", async () => {
    const result = await withApp(() =>
      oauth().withMetaOAuthTestHooks(
        {
          now: () => NOW,
          loadCredential: async () => cred(),
          transport: async (url) => {
            const u = new URL(url);
            if (u.pathname.endsWith("/me/adaccounts")) {
              return {
                ok: true,
                status: 200,
                body: {
                  data: [
                    { id: `act_${ACCOUNT}`, account_id: ACCOUNT, name: "Acme", currency: "EUR", timezone_name: "Europe/Berlin", account_status: 1 },
                  ],
                },
              };
            }
            return { ok: true, status: 200, body: { id: "999", name: "Meta User" } };
          },
        },
        () => oauth().listMetaAdAccounts(CRED_ID, ADMIN)
      )
    );
    assertX.equal(result.adAccounts.length, 1);
    assertX.equal(result.adAccounts[0].adAccountId, ACCOUNT);
    assertX.equal(result.adAccounts[0].timezoneName, "Europe/Berlin");
    const field = read("frontend/src/components/workflows/params/MetaAdAccountField.tsx");
    assertX.ok(field.includes("listMetaAdAccounts"));
    assertX.ok(field.includes("account.currency") && field.includes("account.timezoneName"));
    const renderer = read("frontend/src/components/workflows/params/NodeParameterRenderer.tsx");
    assertX.ok(renderer.includes('case "metaAdAccount"'));
  });

  check("META-M3-5 numeric adAccountId persists", () => {
    const { validateDefinition } = require("../modules/workflows/workflows.service");
    const def = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Manual", nodeType: "trigger" } },
        {
          id: "m",
          type: "metaAds",
          position: { x: 200, y: 0 },
          data: {
            label: "Meta Ads",
            nodeType: "metaAds",
            credentialId: CRED_ID,
            adAccountId: `act_${ACCOUNT}`,
            reportType: "campaign_performance",
            accessToken: LONG,
            appsecret_proof: "proof",
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "m" }],
      settings: {},
    };
    validateDefinition(def);
    const data = def.nodes[1].data;
    assertX.equal(data.adAccountId, ACCOUNT);
    assertX.equal(data.accessToken, undefined);
    assertX.equal(data.appsecret_proof, undefined);
    assertX.equal(JSON.stringify(data).includes("act_"), false);
  });

  check("META-M3-6 act_ is built only for the Graph path", async () => {
    const { result, calls } = await runWith({});
    for (const call of calls) {
      assertX.ok(call.path.startsWith(`/${metaGraph().API_VERSION}/act_${ACCOUNT}`));
      assertX.ok(call.url.startsWith(`https://graph.facebook.com/${metaGraph().API_VERSION}/`));
    }
    assertX.equal(JSON.stringify(result.items).includes("act_"), false);
    assertX.equal(JSON.stringify(result.output).includes("act_"), false);
    assertX.equal(result.output.adAccountId, ACCOUNT);
  });

  const levelCheck = (id, reportType, level, identity) =>
    check(`META-M3-${id} ${reportType} uses level=${level}`, async () => {
      const { insightCalls, result } = await runWith({ data: { reportType } });
      assertX.equal(insightCalls.length, 1);
      assertX.equal(insightCalls[0].query.level, level);
      const fields = insightCalls[0].query.fields.split(",");
      for (const f of catalog().COMMON_FIELDS) assertX.ok(fields.includes(f), f);
      for (const f of identity) assertX.ok(fields.includes(f), f);
      assertX.equal(fields.length, catalog().COMMON_FIELDS.length + identity.length);
      assertX.equal(result.items[0].json._meta.level, level);
    });

  levelCheck(7, "account_performance", "account", []);
  levelCheck(8, "campaign_performance", "campaign", ["campaign_id", "campaign_name"]);
  levelCheck(9, "ad_set_performance", "adset", ["campaign_id", "campaign_name", "adset_id", "adset_name"]);
  levelCheck(10, "ad_performance", "ad", ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name"]);

  check("META-M3-7b unsupported field errors map to META_FIELD_UNSUPPORTED", async () => {
    const err = ads().mapMetaError(400, {
      error: { code: 100, message: "(#100) Tried accessing nonexisting field (bogus)" },
    });
    assertX.equal(err.code, "META_FIELD_UNSUPPORTED");
    await rejectsCode(() => runWith({ data: { reportType: "keyword_performance" } }), "META_FIELD_UNSUPPORTED");
    const param = ads().mapMetaError(400, { error: { code: 100, message: "Invalid parameter" } });
    assertX.equal(param.code, "META_GRAPH_ERROR");
  });

  check("META-M3-11 default date range is Last 7 days", async () => {
    const { insightCalls, result } = await runWith({ data: {} });
    assertX.deepEqual(JSON.parse(insightCalls[0].query.time_range), {
      since: "2026-09-29",
      until: "2026-10-05",
    });
    assertX.equal(insightCalls[0].query.date_preset, undefined);
    assertX.equal(result.output.since, "2026-09-29");
    assertX.equal(result.output.until, "2026-10-05");
    const schema = read("frontend/src/modules/workflows/nodeParameterSchemas.ts");
    const block = schema.slice(schema.indexOf("    metaAds: ["), schema.indexOf("    googleAnalytics: ["));
    assertX.ok(/name: "dateRange",[\s\S]*?default: "last7days"/.test(block));
    assertX.equal(block.includes('"maximum"'), false);
  });

  check("META-M3-12 custom date range builds a valid time_range", async () => {
    const { insightCalls } = await runWith({
      data: { dateRange: "custom", customStartDate: "2026-09-01", customEndDate: "2026-09-15" },
    });
    assertX.equal(insightCalls[0].query.time_range, JSON.stringify({ since: "2026-09-01", until: "2026-09-15" }));
    const resolve = (extra) =>
      catalog().resolveMetaDateRange({ timezone: "UTC", nowMs: NOW, dateRange: "custom", ...extra });
    assertX.throws(() => resolve({ customStartDate: "09/01/2026", customEndDate: "2026-09-15" }), /YYYY-MM-DD/);
    assertX.throws(() => resolve({ customStartDate: "2026-09-20", customEndDate: "2026-09-15" }), (e) => e.code === "META_DATE_WINDOW");
    assertX.throws(() => resolve({ customStartDate: "2026-09-20", customEndDate: "2026-12-15" }), (e) => e.code === "META_DATE_WINDOW");
    assertX.throws(() => resolve({ customStartDate: "2023-01-01", customEndDate: "2023-01-10" }), (e) => e.code === "META_DATE_WINDOW");
    assertX.throws(() => catalog().resolveMetaDateRange({ timezone: "UTC", nowMs: NOW, dateRange: "maximum" }), (e) => e.code === "META_DATE_WINDOW");
    assertX.equal(ads().mapMetaError(400, { error: { code: 3018, message: "start date too old" } }).code, "META_DATE_WINDOW");
    const r = (preset) => catalog().resolveMetaDateRange({ timezone: "UTC", nowMs: NOW, dateRange: preset });
    assertX.deepEqual([r("today").since, r("today").until], ["2026-10-06", "2026-10-06"]);
    assertX.deepEqual([r("yesterday").since, r("yesterday").until], ["2026-10-05", "2026-10-05"]);
    assertX.deepEqual([r("last14days").since, r("last14days").until], ["2026-09-22", "2026-10-05"]);
    assertX.deepEqual([r("last30days").since, r("last30days").until], ["2026-09-06", "2026-10-05"]);
    assertX.deepEqual([r("thisMonth").since, r("thisMonth").until], ["2026-10-01", "2026-10-06"]);
    assertX.deepEqual([r("lastMonth").since, r("lastMonth").until], ["2026-09-01", "2026-09-30"]);
  });

  check("META-M3-13 account timezone is used", async () => {
    const early = Date.parse("2026-10-06T03:00:00Z");
    const la = await runWith({ data: { dateRange: "yesterday" }, timezone: "America/Los_Angeles", now: early });
    const tokyo = await runWith({ data: { dateRange: "yesterday" }, timezone: "Asia/Tokyo", now: early });
    assertX.equal(JSON.parse(la.insightCalls[0].query.time_range).since, "2026-10-04");
    assertX.equal(JSON.parse(tokyo.insightCalls[0].query.time_range).since, "2026-10-05");
    assertX.equal(la.result.output.timezone, "America/Los_Angeles");
    assertX.equal(la.result.items[0].json._meta.timezone, "America/Los_Angeles");
    await rejectsCode(() => runWith({ timezone: "" }), "META_DATE_WINDOW");
  });

  check("META-M3-14 time_increment=1", async () => {
    const { insightCalls } = await runWith({});
    assertX.equal(insightCalls[0].query.time_increment, "1");
    assertX.equal(insightCalls[0].query.breakdowns, undefined);
  });

  const filteringOf = async (reportType, filters) => {
    const { insightCalls } = await runWith({ data: { reportType, filters } });
    return JSON.parse(insightCalls[0].query.filtering || "[]");
  };

  check("META-M3-15 campaign filters are validated", async () => {
    const filtering = await filteringOf("campaign_performance", {
      campaignId: "111, 222",
      effectiveStatus: "paused",
    });
    assertX.deepEqual(filtering, [
      { field: "campaign.id", operator: "IN", value: ["111", "222"] },
      { field: "campaign.effective_status", operator: "IN", value: ["PAUSED"] },
    ]);
    await rejectsCode(() => runWith({ data: { filters: { campaignId: "abc" } } }), "META_FILTER_INVALID");
    await rejectsCode(() => runWith({ data: { filters: { adSetId: "1" } } }), "META_FILTER_INVALID");
    await rejectsCode(() => runWith({ data: { filters: { effectiveStatus: "PENDING_REVIEW" } } }), "META_FILTER_INVALID");
    await rejectsCode(() => runWith({ data: { reportType: "account_performance", filters: { campaignId: "1" } } }), "META_FILTER_INVALID");
    assertX.equal(ads().mapMetaError(400, { error: { code: 100, message: "Filtering field is invalid" } }).code, "META_FILTER_INVALID");
  });

  check("META-M3-16 ad set filters are validated", async () => {
    const filtering = await filteringOf("ad_set_performance", {
      campaignId: "111",
      adSetId: ["333"],
      effectiveStatus: "CAMPAIGN_PAUSED",
    });
    assertX.deepEqual(filtering, [
      { field: "campaign.id", operator: "IN", value: ["111"] },
      { field: "adset.id", operator: "IN", value: ["333"] },
      { field: "adset.effective_status", operator: "IN", value: ["CAMPAIGN_PAUSED"] },
    ]);
    await rejectsCode(() => runWith({ data: { reportType: "ad_set_performance", filters: { effectiveStatus: "ADSET_PAUSED" } } }), "META_FILTER_INVALID");
    await rejectsCode(() => runWith({ data: { reportType: "ad_set_performance", filters: { adId: "1" } } }), "META_FILTER_INVALID");
  });

  check("META-M3-17 ad filters are validated", async () => {
    const filtering = await filteringOf("ad_performance", {
      adId: "555",
      effectiveStatus: "PENDING_REVIEW",
    });
    assertX.deepEqual(filtering, [
      { field: "ad.id", operator: "IN", value: ["555"] },
      { field: "ad.effective_status", operator: "IN", value: ["PENDING_REVIEW"] },
    ]);
    await rejectsCode(() => runWith({ data: { reportType: "ad_performance", filters: { creativeId: "1" } } }), "META_FILTER_INVALID");
    await rejectsCode(() => runWith({ data: { reportType: "ad_performance", filters: '[{"field":"x"}]' } }), "META_FILTER_INVALID");
    await rejectsCode(() => runWith({ data: { reportType: "ad_performance", filters: { effectiveStatus: "BOGUS" } } }), "META_FILTER_INVALID");
  });

  const NEXT_URL = `https://graph.facebook.com/v26.0/act_${ACCOUNT}/insights?access_token=${LONG}&after=NEXT`;

  check("META-M3-18 pagination uses after, never paging.next", async () => {
    const { insightCalls, result } = await runWith({
      data: { returnAll: true },
      pageFor: (index) =>
        index === 0
          ? { data: [insightRow(0)], paging: { cursors: { after: "C1" }, next: NEXT_URL } }
          : { data: [insightRow(1)], paging: { cursors: { after: "C2" } } },
    });
    assertX.equal(insightCalls.length, 2);
    assertX.equal(insightCalls[0].query.after, undefined);
    assertX.equal(insightCalls[1].query.after, "C1");
    assertX.equal(insightCalls.some((c) => c.url === NEXT_URL || c.query.after === "NEXT"), false);
    assertX.equal(result.items.length, 2);
    assertX.equal(result.output.truncated, false);
  });

  check("META-M3-19 row and page caps are enforced", async () => {
    const fullPage = (index, query) => ({
      data: Array.from({ length: Number(query.limit) }, (_, i) => insightRow(index * 100 + i)),
      paging: { cursors: { after: `C${index + 1}` }, next: NEXT_URL },
    });
    const all = await runWith({ data: { returnAll: true }, pageFor: fullPage });
    assertX.equal(all.insightCalls.length, catalog().MAX_PAGES);
    assertX.equal(all.result.items.length, catalog().MAX_ROWS);
    assertX.equal(all.result.output.truncated, true);
    const limited = await runWith({ data: { limit: 150 }, pageFor: fullPage });
    assertX.deepEqual(limited.insightCalls.map((c) => c.query.limit), ["100", "50"]);
    assertX.equal(limited.result.items.length, 150);
    assertX.equal(limited.result.output.truncated, true);
    const huge = await runWith({ data: { limit: 999999 }, pageFor: fullPage });
    assertX.equal(huge.result.items.length, catalog().MAX_ROWS);
    const last = await runWith({ data: { limit: 100 }, pageFor: () => ({ data: [insightRow(0)], paging: { cursors: { after: "C1" } } }) });
    assertX.equal(last.result.output.truncated, false);
    assertX.equal(last.insightCalls.length, 1);
  });

  const firstRow = async () => (await runWith({})).result.items[0].json;

  check("META-M3-20 actions array preserved", async () => {
    const row = await firstRow();
    assertX.ok(Array.isArray(row.actions));
    assertX.deepEqual(row.actions, [
      { action_type: "link_click", value: 25 },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: 2 },
    ]);
  });

  check("META-M3-21 action_values preserved", async () => {
    const row = await firstRow();
    assertX.deepEqual(row.action_values, [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: 99.5 },
    ]);
  });

  check("META-M3-22 cost_per_action_type preserved", async () => {
    const row = await firstRow();
    assertX.deepEqual(row.cost_per_action_type, [{ action_type: "link_click", value: 0.8 }]);
    const odd = ads().normalizeInsightsRow(
      { actions: [{ action_type: "x", value: "n/a", "1d_click": "3" }] },
      { reportType: "account_performance", level: "account", adAccountId: ACCOUNT, since: "a", until: "b", timezone: "UTC" }
    );
    assertX.deepEqual(odd.actions, [{ action_type: "x", value: "n/a", "1d_click": "3" }]);
  });

  check("META-M3-23 no synthetic total conversions", async () => {
    const row = await firstRow();
    const allowed = new Set([...catalog().fieldsFor("campaign_performance"), "_meta"]);
    for (const key of Object.keys(row)) assertX.ok(allowed.has(key), key);
    for (const key of ["conversions", "purchases", "totalConversions", "total_conversions", "conversionValue"]) {
      assertX.equal(key in row, false, key);
    }
    assertX.equal(row.impressions, 1000);
    assertX.equal(row.spend, 20);
    assertX.equal(row.account_id, ACCOUNT);
    assertX.equal(row.clicks, 40);
    assertX.equal(row.inline_link_clicks, 25);
  });

  check("META-M3-24 provenance provider is meta_ads", async () => {
    const { result } = await runWith({});
    for (const item of result.items) {
      assertX.equal(item.json._meta.provider, "meta_ads");
      assertX.equal(item.json._meta.resource, "insights");
      assertX.equal(item.json._meta.apiVersion, metaGraph().API_VERSION);
      assertX.equal(item.json._meta.apiVersion, "v26.0");
    }
    assertX.deepEqual(result.items.map((i) => i.pairedItem.inputItemIndex), [0, 1]);
  });

  check("META-M3-25 correct report and level provenance", async () => {
    const { result } = await runWith({ data: { reportType: "ad_set_performance" } });
    const meta = result.items[0].json._meta;
    assertX.deepEqual(meta, {
      provider: "meta_ads",
      resource: "insights",
      report: "ad_set_performance",
      level: "adset",
      adAccountId: ACCOUNT,
      apiVersion: "v26.0",
      dateRange: { since: "2026-09-29", until: "2026-10-05" },
      timezone: "America/Los_Angeles",
    });
    assertX.deepEqual(Object.keys(result.output).sort(), [
      "adAccountId", "reportType", "rowCount", "since", "timezone", "truncated", "until",
    ]);
  });

  const metaRows = (reportType, level) => [
    { json: { ...insightRow(0), _meta: { provider: "meta_ads", resource: "insights", report: reportType, level, adAccountId: ACCOUNT, apiVersion: "v26.0", dateRange: { since: "2026-09-29", until: "2026-10-05" }, timezone: "UTC" } } },
  ];

  check("META-M3-26 Meta grounding labels are correct", () => {
    const cases = [
      ["account_performance", "account", "Meta Ads Account Performance"],
      ["campaign_performance", "campaign", "Meta Ads Campaign Performance"],
      ["ad_set_performance", "adset", "Meta Ads Ad Set Performance"],
      ["ad_performance", "ad", "Meta Ads Ad Performance"],
    ];
    for (const [report, level, label] of cases) {
      const g = grounding().applyMetaAdsAiGrounding({ systemPrompt: "Summarize", input: metaRows(report, level) });
      assertX.equal(g.grounded, true);
      assertX.equal(g.source, "meta_ads");
      assertX.ok(g.systemPrompt.includes(`report: ${label}`), label);
      assertX.ok(g.systemPrompt.startsWith("Summarize"));
      assertX.ok(/inline_link_clicks/.test(g.systemPrompt));
      assertX.ok(/account_currency/.test(g.systemPrompt));
      assertX.ok(/link_click is not a purchase/.test(g.systemPrompt));
      assertX.equal(/Ad Group Performance/.test(g.systemPrompt), false);
    }
    const none = grounding().applyMetaAdsAiGrounding({ systemPrompt: "x", input: [{ json: { impressions: 1 } }] });
    assertX.equal(none.grounded, false);
  });

  check("META-M3-27 no Google Ads, GA4 or GSC grounding contamination", () => {
    const rows = metaRows("campaign_performance", "campaign");
    const google = require("../services/workflowGoogleAdsAiGrounding");
    assertX.equal(google.looksLikeGoogleAdsRows(google.collectRows(rows)), false);
    assertX.equal(google.applyGoogleAdsAiGrounding({ systemPrompt: "s", input: rows }).grounded, false);
    const ga4 = require("../services/workflowGa4AiGrounding");
    assertX.equal(ga4.applyGa4NativeAiGrounding({ systemPrompt: "s", userPrompt: "u", input: rows, context: {} }).grounded, false);
    const { applyMcpAiGrounding } = require("../services/workflowMcpAiGrounding");
    assertX.equal(applyMcpAiGrounding({ systemPrompt: "s", userPrompt: "u", input: rows, context: {} }).grounded, false);
    const g = grounding().applyMetaAdsAiGrounding({ systemPrompt: "", input: rows });
    assertX.equal(g.systemPrompt.includes("Google Ads evidence rules"), false);
    assertX.equal(g.systemPrompt.includes("source: google_ads"), false);
    const engine = read("backend/services/workflowNodes.service.js");
    assertX.ok(engine.includes('mcpGroundingSource !== "meta_ads"'));
  });

  check("META-M3-28 no ads_management", () => {
    assertX.equal(metaGraph().OAUTH_SCOPES.join(","), "ads_read");
    for (const rel of [
      ...newBackendFiles,
      "frontend/src/components/workflows/params/MetaAdAccountField.tsx",
      "frontend/src/components/workflows/params/MetaAdsFiltersField.tsx",
    ]) {
      assertX.equal(read(rel).includes("ads_management"), false, rel);
    }
  });

  check("META-M3-29 no write endpoint reachable", async () => {
    for (const rel of newBackendFiles) {
      const text = read(rel);
      assertX.equal(text.includes("POST"), false, rel);
      assertX.equal(text.includes("/campaigns"), false, rel);
      assertX.equal(text.includes("/adsets"), false, rel);
      assertX.equal(text.includes("paging.next}") || /fetch\([^)]*next/.test(text), false, rel);
    }
    await rejectsCode(() => runWith({ data: { resource: "campaign", operation: "update" } }), "META_PERMISSION_DENIED");
    const { calls } = await runWith({});
    assertX.ok(calls.every((c) => c.method === "GET"));
    await rejectsCode(
      () => withApp(() => ads().metaGraphRequest({ accessToken: LONG, path: `act_${ACCOUNT}/insights`, method: "POST" })),
      "META_PERMISSION_DENIED"
    );
  });

  check("META-M3-30 no secrets in node data, output or logs", async () => {
    const logs = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...args) => logs.push(args.join(" "));
    console.warn = console.log;
    console.error = console.log;
    let run;
    try {
      run = await runWith({});
    } finally {
      Object.assign(console, orig);
    }
    const visible = JSON.stringify({ items: run.result.items, output: run.result.output, resolved: run.result.resolved });
    for (const needle of [LONG, APP_SECRET, "appsecret_proof", "appsecret_time", "access_token", "accessToken", "appSecret", CRED_ID]) {
      assertX.equal(visible.includes(needle), false, needle);
      assertX.equal(logs.join("\n").includes(needle), false, needle);
    }
    const sanitized = ads().sanitizeMetaAdsNodeData({ adAccountId: ACCOUNT, accessToken: LONG, appSecret: APP_SECRET, app_secret: "x", code: "c", filters: { access_token: LONG } });
    assertX.equal(JSON.stringify(sanitized).includes(LONG), false);
    assertX.deepEqual(Object.keys(sanitized).sort(), ["adAccountId", "filters"]);
    const err = ads().mapMetaError(400, { error: { code: 100, message: `bad field access_token=${LONG}` } });
    assertX.equal(err.message.includes(LONG), false);
  });
};

if (require.main === module) {
  const queue = [];
  let passed = 0;
  let failed = 0;
  const check = (name, fn) => {
    queue.push(async () => {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`FAIL  ${name}\n      ${err.message}`);
        process.exitCode = 1;
      }
    });
  };
  const section = (name) => queue.push(async () => console.log(`\n${name}`));
  registerMetaAdsM3Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} checks passed, ${failed} failed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerMetaAdsM3Tests };
