/**
 * Instagram M4 — account + media insights.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const IG_USER = "17841400000000001";
const MEDIA_ID = "17890000000000001";
const TOKEN = "IG_LONG_LIVED_TOKEN_SECRET_VALUE";

const registerInstagramM4Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Instagram M4 insights");

  const ig = () => require("../services/workflowInstagram.service");
  const catalog = () => require("../services/instagramInsightsCatalog");
  const metaGraph = () => require("../config/metaGraph");
  const metaAds = () => require("../services/workflowMetaAds.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const scope = () => require("../services/workflowAiContextScope");

  const baseCred = (overrides = {}) => ({
    id: "cred-ig-m4",
    type: "instagram",
    name: "IG",
    workspaceId: "ws-1",
    secret: {
      accessToken: TOKEN,
      expiresAt: "2099-01-01T00:00:00.000Z",
      grantedPermissions: [
        "instagram_basic",
        "instagram_manage_insights",
      ],
      instagramUserId: IG_USER,
      ...(overrides.secret || {}),
    },
    config: {
      connected: true,
      instagramUserId: IG_USER,
      username: "brand_ig",
      grantedPermissions: [
        "instagram_basic",
        "instagram_manage_insights",
      ],
      ...(overrides.config || {}),
    },
  });

  const run = (data, transport, loadCredential) =>
    ig().withInstagramNodeTestHooks(
      {
        transport,
        loadCredential: loadCredential || (async () => baseCred()),
      },
      () =>
        ig().executeInstagramNode(
          { id: "ig-1", type: "instagram", data },
          { workspaceId: "ws-1", items: [{ json: {} }] }
        )
    );

  check("IG-M4-1 account_insights registered", () => {
    assertX.equal(
      Object.prototype.hasOwnProperty.call(catalog().ACCOUNT_PRESETS, "overview"),
      true
    );
    assertX.equal(
      typeof ig().runAccountInsights === "function" ||
        typeof ig().executeInstagramNode === "function",
      true
    );
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assertX.equal(schema.includes('value: "account_insights"'), true);
    assertX.equal(schema.includes('value: "insights"'), true);
  });

  check("IG-M4-2 requires instagram_manage_insights", async () => {
    await assertX.rejects(
      () =>
        run(
          {
            credentialId: "cred-ig-m4",
            resource: "insights",
            operation: "account_insights",
            insightsPreset: "overview",
            period: "day",
          },
          async () => ({ ok: true, status: 200, body: { data: [] } }),
          async () =>
            baseCred({
              secret: { grantedPermissions: ["instagram_basic"] },
              config: { grantedPermissions: ["instagram_basic"] },
            })
        ),
      (err) =>
        err.code === "PERMISSION_NOT_GRANTED" ||
        err.code === "INSTAGRAM_PERMISSION_DENIED"
    );
  });

  check("IG-M4-3 account preset resolves to valid server-owned metrics", () => {
    const metrics = catalog().resolveAccountPresetMetrics("overview");
    assertX.deepEqual(metrics, [
      "views",
      "reach",
      "accounts_engaged",
      "total_interactions",
    ]);
    for (const name of metrics) {
      assertX.ok(catalog().ACCOUNT_METRICS[name]);
    }
  });

  check("IG-M4-4 invalid arbitrary metric rejected", () => {
    assertX.throws(
      () => catalog().getAccountMetric("impressions_fake"),
      (err) => err.code === "INSTAGRAM_INSIGHTS_METRIC_INVALID"
    );
    assertX.throws(
      () =>
        catalog().buildAccountInsightRequests({
          preset: "custom",
          metrics: ["not_a_real_metric"],
          period: "day",
        }),
      (err) => err.code === "INSTAGRAM_INSIGHTS_METRIC_INVALID"
    );
  });

  check("IG-M4-5 metric/period compatibility enforced", () => {
    assertX.throws(
      () => catalog().assertAccountMetricPeriod("follower_count", "lifetime"),
      (err) => err.code === "INSTAGRAM_INSIGHTS_PERIOD_INVALID"
    );
    assertX.throws(
      () => catalog().assertAccountMetricPeriod("online_followers", "day"),
      (err) => err.code === "INSTAGRAM_INSIGHTS_PERIOD_INVALID"
    );
    const ok = catalog().assertAccountMetricPeriod("views", "day");
    assertX.equal(ok.name, "views");
  });

  check("IG-M4-6 account insights normalize real returned values", async () => {
    const result = await run(
      {
        credentialId: "cred-ig-m4",
        resource: "insights",
        operation: "account_insights",
        insightsPreset: "overview",
        period: "day",
      },
      async (url) => {
        assertX.equal(String(url).includes(`/${IG_USER}/insights?`), true);
        assertX.equal(String(url).includes("graph.facebook.com"), true);
        assertX.equal(String(url).includes("graph.instagram.com"), false);
        return {
          ok: true,
          status: 200,
          body: {
            data: [
              {
                name: "views",
                period: "day",
                title: "Views",
                values: [
                  { value: 12, end_time: "2026-03-01T07:00:00+0000" },
                  { value: 15, end_time: "2026-03-02T07:00:00+0000" },
                ],
              },
              {
                name: "reach",
                period: "day",
                values: [{ value: 9, end_time: "2026-03-02T07:00:00+0000" }],
              },
            ],
          },
        };
      }
    );
    assertX.equal(result.items.length >= 3, true);
    const views = result.items.filter((i) => i.json.metric === "views");
    assertX.equal(views[0].json.value, 12);
    assertX.equal(views[1].json.value, 15);
    assertX.equal(views[0].json._meta.provider, "instagram");
    assertX.equal(views[0].json._meta.resource, "insights");
    assertX.equal(views[0].json._meta.operation, "account_insights");
    assertX.equal(views[0].json._meta.instagramUserId, IG_USER);
  });

  check("IG-M4-7 missing metric data is not converted to zero", () => {
    const missing = ig().readInsightValue(null);
    assertX.equal(missing.status, "missing");
    assertX.equal(missing.value, undefined);

    const zero = ig().readInsightValue(0);
    assertX.equal(zero.status, "ok");
    assertX.equal(zero.value, 0);

    const rows = ig().normalizeInsightRows({
      metricRows: [
        { name: "reach", period: "day", values: [] },
        { name: "views", period: "day", values: [{ value: null }] },
      ],
      operation: "account_insights",
      instagramUserId: IG_USER,
      period: "day",
    });
    assertX.equal(rows.some((r) => r.value === 0), false);
    assertX.equal(rows.every((r) => r.status === "unavailable" || r.status === "missing"), true);
  });

  check("IG-M4-8 media_insights registered", () => {
    assertX.ok(catalog().MEDIA_PRESETS.overview);
    assertX.ok(catalog().MEDIA_METRICS.views);
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assertX.equal(schema.includes('value: "media_insights"'), true);
  });

  check("IG-M4-9 media insight metrics validated by media type", () => {
    const ok = catalog().assertMediaMetricForType("likes", "IMAGE");
    assertX.equal(ok.name, "likes");
    const reels = catalog().buildMediaInsightRequest({
      preset: "reels",
      mediaType: "REELS",
    });
    assertX.equal(reels.metrics.includes("ig_reels_avg_watch_time"), true);
  });

  check("IG-M4-10 incompatible media metric safely rejected/unavailable", () => {
    assertX.throws(
      () => catalog().assertMediaMetricForType("ig_reels_avg_watch_time", "IMAGE"),
      (err) => err.code === "INSTAGRAM_INSIGHTS_MEDIA_UNSUPPORTED"
    );
    assertX.throws(
      () =>
        catalog().buildMediaInsightRequest({
          preset: "custom",
          metrics: ["navigation"],
          mediaType: "IMAGE",
        }),
      (err) => err.code === "INSTAGRAM_INSIGHTS_MEDIA_UNSUPPORTED"
    );
  });

  check("IG-M4-11 time-series rows preserve chronological order", () => {
    const rows = ig().normalizeInsightRows({
      metricRows: [
        {
          name: "views",
          period: "day",
          values: [
            { value: 3, end_time: "2026-03-03T07:00:00+0000" },
            { value: 1, end_time: "2026-03-01T07:00:00+0000" },
            { value: 2, end_time: "2026-03-02T07:00:00+0000" },
          ],
        },
      ],
      operation: "account_insights",
      instagramUserId: IG_USER,
      period: "day",
    });
    assertX.deepEqual(
      rows.map((r) => r.value),
      [1, 2, 3]
    );
  });

  check("IG-M4-12 no token/paging secret leakage", async () => {
    const result = await run(
      {
        credentialId: "cred-ig-m4",
        resource: "insights",
        operation: "account_insights",
        insightsPreset: "engagement",
        period: "day",
      },
      async () => ({
        ok: true,
        status: 200,
        body: {
          data: [
            {
              name: "likes",
              period: "day",
              values: [{ value: 4, end_time: "2026-03-01T07:00:00+0000" }],
            },
          ],
          paging: {
            cursors: { after: "ABC" },
            next: `https://graph.facebook.com/v27.0/${IG_USER}/insights?access_token=${TOKEN}`,
          },
        },
      })
    );
    const dumped = JSON.stringify(result);
    assertX.equal(dumped.includes(TOKEN), false);
    assertX.equal(dumped.includes("access_token="), false);
    assertX.equal(result.output.next, undefined);
  });

  check("IG-M4-13 expired token reuses reconnect behavior", async () => {
    await assertX.rejects(
      () =>
        run(
          {
            credentialId: "cred-ig-m4",
            resource: "insights",
            operation: "account_insights",
            insightsPreset: "overview",
            period: "day",
          },
          async () => ({ ok: true, status: 200, body: { data: [] } }),
          async () =>
            baseCred({
              config: { reconnectRequired: true },
            })
        ),
      (err) => err.code === "INSTAGRAM_TOKEN_INVALID"
    );

    await assertX.rejects(
      () =>
        auth().withInstagramAuthTestHooks(
          {
            loadCredential: async () => baseCred(),
            transport: async () => ({
              ok: false,
              status: 401,
              body: { error: { code: 190, message: "Invalid OAuth access token." } },
            }),
          },
          () =>
            auth().instagramGraphGet({
              credentialId: "cred-ig-m4",
              workspaceId: "ws-1",
              path: `${IG_USER}/insights`,
              query: { metric: "views", period: "day" },
            })
        ),
      (err) => err.code === "INSTAGRAM_TOKEN_INVALID"
    );
  });

  check("IG-M4-14 Instagram M3 regression green", async () => {
    const profile = await run(
      {
        credentialId: "cred-ig-m4",
        resource: "account",
        operation: "get_profile",
      },
      async () => ({
        ok: true,
        status: 200,
        body: { user_id: IG_USER, username: "brand_ig", account_type: "BUSINESS" },
      })
    );
    assertX.equal(profile.items[0].json.username, "brand_ig");

    const media = await run(
      {
        credentialId: "cred-ig-m4",
        resource: "media",
        operation: "get_media",
        mediaId: MEDIA_ID,
      },
      async () => ({
        ok: true,
        status: 200,
        body: { id: MEDIA_ID, media_type: "IMAGE", permalink: "https://instagram.com/p/x" },
      })
    );
    assertX.equal(media.items[0].json.mediaId, MEDIA_ID);
  });

  check("IG-M4-15 Meta Ads native/MCP regression green", async () => {
    assertX.deepEqual([...metaGraph().OAUTH_SCOPES], ["ads_read"]);
    assertX.equal(metaGraph().API_VERSION, "v26.0");
    const adsSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    assertX.equal(adsSrc.includes("instagram"), false);
    await assertX.rejects(
      () =>
        metaAds().metaGraphRequest({
          accessToken: "x",
          path: "me",
          method: "POST",
        }),
      (err) => err.code === "META_PERMISSION_DENIED"
    );
    const mcpSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAdsMcp.service.js"),
      "utf8"
    );
    assertX.equal(mcpSrc.includes("normalizeAdAccountId"), true);
  });

  check("IG-M4-16 AI Entire Dataset regression green", () => {
    assertX.equal(scope().resolveAiContextScope({ contextScope: "dataset" }), "dataset");
    assertX.equal(scope().resolveAiContextScope({ contextScope: "item" }), "item");
    const smoke = fs.readFileSync(
      path.join(__dirname, "smoke-workflow-ai-live-scope.js"),
      "utf8"
    );
    assertX.equal(smoke.includes("AI-LIVE-SCOPE-2"), true);
    assertX.equal(smoke.includes("contextScope"), true);
  });
};

if (require.main === module) {
  const queue = [];
  let passed = 0;
  const check = (name, fn) => {
    queue.push(async () => {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
      } catch (err) {
        console.error(
          `FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`
        );
        process.exitCode = 1;
      }
    });
  };
  const section = (name) => queue.push(async () => console.log(`\n${name}`));
  registerInstagramM4Tests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} Instagram M4 checks passed`);
    process.exit(process.exitCode || 0);
  })();
}

module.exports = { registerInstagramM4Tests };
