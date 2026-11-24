/**
 * M8.18 — Meta Ads Native: platformScope, resources/ops, KPI aggregates, isolation.
 * Mocked Graph transport only. No live Meta calls. Does not expand MCP.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LONG = "EAATestLongLivedTokenValue";
const APP_SECRET = "meta-app-secret-test";
const CRED_ID = "cred-meta-m818";
const ACCOUNT = "123456789";
const NOW = Date.parse("2026-10-06T12:00:00Z");

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

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

const cred = () => ({
  id: CRED_ID,
  type: "meta_ads",
  workspaceId: "ws-1",
  name: "Meta Ads",
  secret: { accessToken: LONG, expiresAt: "2030-01-01T00:00:00.000Z" },
  config: { selectedAdAccountId: ACCOUNT },
});

const insightDay = (day, extra = {}) => ({
  account_id: ACCOUNT,
  account_name: "Test",
  account_currency: "USD",
  impressions: "1000",
  reach: "800",
  frequency: "1.25",
  clicks: "40",
  inline_link_clicks: "30",
  ctr: "4",
  cpc: "0.5",
  cpm: "20",
  spend: "20",
  actions: [
    { action_type: "lead", value: "2" },
    { action_type: "link_click", value: "30" },
    { action_type: "landing_page_view", value: "10" },
    { action_type: "purchase", value: "1" },
  ],
  action_values: [{ action_type: "purchase", value: "50" }],
  date_start: day,
  date_stop: day,
  ...extra,
});

(async () => {
  console.log("\nM8.18 Meta Ads Native platformScope + resources");

  const ads = () => require("../services/workflowMetaAds.service");
  const metrics = () => require("../services/metaAdsMetrics.service");
  const catalog = () => require("../services/metaAdsReportCatalog");
  const root = path.join(__dirname, "..", "..");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

  await check("M818-1 platformScope normalizes to all|facebook|instagram", () => {
    assert.equal(metrics().normalizePlatformScope("All Meta"), "all");
    assert.equal(metrics().normalizePlatformScope("facebook"), "facebook");
    assert.equal(metrics().normalizePlatformScope("ig"), "instagram");
    assert.equal(metrics().normalizePlatformScope(""), "all");
    const cleaned = ads().sanitizeMetaAdsNodeData({
      platformScope: "Instagram",
      resource: "report",
      adAccountId: "act_123",
    });
    assert.equal(cleaned.platformScope, "instagram");
    assert.equal(cleaned.resource, "report");
    assert.equal(cleaned.adAccountId, "123");
    assert.equal(ads().normalizeResource("report"), "insights");
  });

  await check("M818-2 KPI ratios from aggregates, not averaged daily ratios", () => {
    const rows = [
      insightDay("2026-09-29", { spend: "10", impressions: "100", clicks: "5", actions: [{ action_type: "lead", value: "1" }] }),
      insightDay("2026-09-30", { spend: "30", impressions: "300", clicks: "15", actions: [{ action_type: "lead", value: "3" }] }),
    ];
    const { totals, ratios } = metrics().aggregateInsightMetrics(rows);
    assert.equal(totals.spend, 40);
    assert.equal(totals.impressions, 400);
    assert.equal(totals.clicks, 20);
    assert.equal(totals.leads, 4);
    assert.equal(totals.reach, null);
    assert.equal(ratios.cpl, 10);
    assert.equal(ratios.cpc, 2);
    assert.equal(ratios.cpm, 100);
  });

  await check("M818-3 objective labels preserve raw Meta values", () => {
    assert.equal(metrics().objectiveLabel("OUTCOME_LEADS"), "Leads");
    assert.equal(metrics().objectiveLabel("OUTCOME_SALES"), "Sales");
    assert.equal(metrics().objectiveLabel("OUTCOME_APP_PROMOTION"), "App Promotion");
    assert.ok(catalog().DELIVERY_STATUS_LABELS.DISAPPROVED);
    assert.equal(catalog().deliveryStatusLabel("PENDING_REVIEW"), "In Review");
  });

  await check("M818-4 entity list default bound + paging metadata", async () => {
    await withApp(async () => {
      const calls = [];
      await ads().withMetaTestHooks(
        {
          now: () => NOW,
          loadCredential: async () => cred(),
          transport: async (url) => {
            const u = new URL(url);
            calls.push(u.pathname);
            if (u.pathname.endsWith(`/act_${ACCOUNT}/campaigns`)) {
              assert.ok(Number(u.searchParams.get("limit")) <= 25);
              return {
                ok: true,
                status: 200,
                body: {
                  data: [
                    {
                      id: "111",
                      name: "Lead Campaign",
                      objective: "OUTCOME_LEADS",
                      status: "ACTIVE",
                      effective_status: "ACTIVE",
                      created_time: "2026-01-01T00:00:00+0000",
                      updated_time: "2026-01-02T00:00:00+0000",
                    },
                  ],
                  paging: { cursors: { after: "cursor-2" }, next: "https://graph.facebook.com/next" },
                },
              };
            }
            return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
          },
        },
        async () => {
          const result = await ads().executeMetaAdsNode(
            {
              data: {
                credentialId: CRED_ID,
                adAccountId: ACCOUNT,
                platformScope: "all",
                resource: "campaign",
                operation: "list",
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          );
          assert.equal(result.items.length, 1);
          assert.equal(result.items[0].json.objective, "OUTCOME_LEADS");
          assert.equal(result.items[0].json.objectiveLabel, "Leads");
          assert.equal(result.items[0].json.presentation.status, "Active");
          assert.equal(result.output.paging.hasMore, true);
          assert.equal(result.output.paging.after, "cursor-2");
          assert.equal(result.output.platformScope, "all");
        }
      );
      assert.ok(calls.some((p) => p.endsWith("/campaigns")));
    });
  });

  await check("M818-5 insights facebook platform filters publisher_platform", async () => {
    await withApp(async () => {
      await ads().withMetaTestHooks(
        {
          now: () => NOW,
          loadCredential: async () => cred(),
          transport: async (url) => {
            const u = new URL(url);
            if (u.pathname.endsWith(`/act_${ACCOUNT}`)) {
              return {
                ok: true,
                status: 200,
                body: {
                  id: `act_${ACCOUNT}`,
                  account_id: ACCOUNT,
                  name: "Test",
                  account_status: 1,
                  currency: "USD",
                  timezone_name: "UTC",
                },
              };
            }
            if (u.pathname.endsWith(`/act_${ACCOUNT}/insights`)) {
              assert.equal(u.searchParams.get("breakdowns"), "publisher_platform");
              return {
                ok: true,
                status: 200,
                body: {
                  data: [
                    insightDay("2026-09-29", {
                      publisher_platform: "facebook",
                      spend: "10",
                      impressions: "100",
                      clicks: "5",
                      actions: [{ action_type: "lead", value: "1" }],
                    }),
                    insightDay("2026-09-29", {
                      publisher_platform: "instagram",
                      spend: "90",
                      impressions: "900",
                      clicks: "45",
                      actions: [{ action_type: "lead", value: "9" }],
                    }),
                  ],
                },
              };
            }
            return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
          },
        },
        async () => {
          const result = await ads().executeMetaAdsNode(
            {
              data: {
                credentialId: CRED_ID,
                adAccountId: ACCOUNT,
                platformScope: "facebook",
                resource: "insights",
                operation: "runReport",
                reportType: "account_performance",
                dateRange: "last7days",
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          );
          assert.equal(result.items.length, 1);
          assert.equal(result.items[0].json.publisher_platform, "facebook");
          assert.equal(result.output.platformScope, "facebook");
          assert.equal(result.output.presentation.spend, 10);
          assert.equal(result.output.metrics.ratios.cpl, 10);
          assert.equal(result.output.presentation.title, "Meta Ads · Facebook");
        }
      );
    });
  });

  await check("M818-6 legacy resource=report still runs insights", async () => {
    await withApp(async () => {
      await ads().withMetaTestHooks(
        {
          now: () => NOW,
          loadCredential: async () => cred(),
          transport: async (url) => {
            const u = new URL(url);
            if (u.pathname.endsWith(`/act_${ACCOUNT}`)) {
              return {
                ok: true,
                status: 200,
                body: {
                  id: `act_${ACCOUNT}`,
                  account_id: ACCOUNT,
                  name: "Test",
                  account_status: 1,
                  currency: "USD",
                  timezone_name: "UTC",
                },
              };
            }
            if (u.pathname.endsWith(`/act_${ACCOUNT}/insights`)) {
              assert.equal(u.searchParams.get("breakdowns"), null);
              return {
                ok: true,
                status: 200,
                body: { data: [insightDay("2026-09-29")] },
              };
            }
            return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
          },
        },
        async () => {
          const result = await ads().executeMetaAdsNode(
            {
              data: {
                credentialId: CRED_ID,
                adAccountId: ACCOUNT,
                resource: "report",
                operation: "runReport",
                reportType: "campaign_performance",
                dateRange: "last7days",
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          );
          // Legacy report resource keeps compact M3 output shape.
          assert.equal(result.output.reportType, "campaign_performance");
          assert.equal(result.output.adAccountId, ACCOUNT);
          assert.equal(Object.prototype.hasOwnProperty.call(result.output, "platformScope"), false);
          assert.ok(result.items.length >= 1);
          assert.equal(result.items[0].json._meta.resource, "insights");
        }
      );
    });
  });

  await check("M818-7 isolation: Meta Ads does not import Instagram Native/MCP", () => {
    const meta = read("backend/services/workflowMetaAds.service.js");
    const metricsSrc = read("backend/services/metaAdsMetrics.service.js");
    assert.ok(!/workflowInstagram/.test(meta));
    assert.ok(!/instagram-mcp/.test(meta));
    assert.ok(!/workflowInstagram/.test(metricsSrc));
    const ig = read("backend/services/workflowInstagram.service.js");
    assert.ok(!/require\(["'].*workflowMetaAds/.test(ig));
    assert.ok(!/require\(["'].*metaAdsMetrics/.test(ig));
  });

  await check("M818-8 FE schema exposes Platform + dependent resources", () => {
    const schema = read("frontend/src/modules/workflows/nodeParameterSchemas.ts");
    assert.ok(schema.includes('name: "platformScope"'));
    assert.ok(schema.includes('value: "facebook"'));
    assert.ok(schema.includes('value: "instagram"'));
    assert.ok(schema.includes('value: "adAccount"'));
    assert.ok(schema.includes('value: "delivery"'));
    assert.ok(schema.includes('name: "platformBreakdown"'));
    const canvas = read("frontend/src/components/workflows/WorkflowCanvas.tsx");
    assert.ok(canvas.includes('platformScope: "all"'));
  });

  await check("M818-9 placement secondary filter deferred (platform required only)", () => {
    const schema = read("frontend/src/modules/workflows/nodeParameterSchemas.ts");
    assert.ok(!/name: "placement"/.test(schema));
    assert.ok(catalog().PLATFORM_SCOPE_OPTIONS.length === 3);
  });

  await check("M818-10 credential types remain separated", () => {
    const types = read("frontend/src/modules/workflows/types.ts");
    assert.ok(types.includes('"meta_ads"'));
    assert.ok(types.includes('"instagram"'));
    const schema = read("frontend/src/modules/workflows/nodeParameterSchemas.ts");
    assert.ok(schema.includes('credentialTypes: ["meta_ads"]'));
    assert.ok(schema.includes('credentialTypes: ["instagram"]'));
  });

  console.log(`\nM8.18 done: ${passed} checks`);
})();
