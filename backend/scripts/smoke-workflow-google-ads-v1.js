/**
 * Google Ads V1 — read-only reports. No live Google calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerGoogleAdsV1Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Google Ads V1 read-only");

  const ads = () => require("../services/workflowGoogleAds.service");
  const oauth = () => require("../services/googleOAuth.service");
  const credentials = () => require("../modules/workflows/credentials.service");
  const workflows = () => require("../modules/workflows/workflows.service");

  const baseNode = (data) => ({
    id: "ads-1",
    type: "googleAds",
    data: {
      credentialId: "cred-ads",
      resource: "report",
      operation: "runReport",
      reportType: "campaign_performance",
      customerId: "123-456-7890",
      dateRange: "custom",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      limit: 25,
      ...data,
    },
  });

  const sampleRow = {
    customer: { id: "1234567890", currencyCode: "USD" },
    campaign: {
      id: "11",
      name: "Brand",
      status: "ENABLED",
      advertisingChannelType: "SEARCH",
    },
    metrics: {
      impressions: "100",
      clicks: "10",
      ctr: 0.1,
      costMicros: "2500000",
      averageCpc: "250000",
      conversions: 2,
      conversionsValue: 40,
    },
    segments: { date: "2026-09-01" },
  };

  check("ADS-A/B credential type and adwords scope", () => {
    const products = oauth().GOOGLE_PRODUCTS;
    assertX.equal(products.google_ads.type, "google_ads");
    assertX.deepEqual(products.google_ads.scopes, [
      "https://www.googleapis.com/auth/adwords",
    ]);
    const registry = require("../services/connectionRegistry.service");
    const entry = registry.getSupportedPredefined("google_ads");
    assertX.ok(entry.oauth.defaultScopes.includes("https://www.googleapis.com/auth/adwords"));
    assertX.equal(
      require("../config/googleNativeAuthPolicy").getGoogleNativeAuthPolicy("google_ads"),
      "HYBRID_CUSTOM_PRIMARY"
    );
    const credSrc = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/credentials.service.js"),
      "utf8"
    );
    assertX.ok(credSrc.includes('"google_ads"'));
    assertX.ok(credSrc.includes("hasDeveloperToken"));
    assertX.equal(credSrc.includes("developerToken: secret.developerToken"), false);
  });

  check("ADS-C/D/Z node JSON keeps credentialId and drops the developer token", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "ads-1",
          type: "googleAds",
          data: {
            credentialId: "cred-ads",
            customerId: "1234567890",
            reportType: "campaign_performance",
            dateRange: "last7days",
            limit: 100,
            developerToken: "SHOULD_NOT_LEAK",
            accessToken: "ya29.SHOULD_NOT_LEAK",
            refreshToken: "SHOULD_NOT_LEAK",
            clientSecret: "SHOULD_NOT_LEAK",
          },
        },
      ],
      edges: [],
    };
    workflows().validateDefinition(definition);
    const saved = JSON.parse(JSON.stringify(definition));
    const data = saved.nodes[0].data;
    assertX.equal(data.credentialId, "cred-ads");
    assertX.equal(data.customerId, "1234567890");
    assertX.equal(data.reportType, "campaign_performance");
    const blob = JSON.stringify(saved);
    assertX.equal(blob.includes("SHOULD_NOT_LEAK"), false);
    assertX.equal(blob.includes("developerToken"), false);
    assertX.equal(blob.includes("accessToken"), false);
    const formatted = credentials().formatCredential({
      id: "c1",
      workspace_id: "ws",
      name: "Ads",
      type: "google_ads",
      created_by: "u",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      config_json: JSON.stringify({
        oauthAppMode: "CUSTOM_APP",
        clientId: "client",
        developerToken: "SHOULD_NOT_LEAK",
      }),
    });
    assertX.equal(JSON.stringify(formatted).includes("SHOULD_NOT_LEAK"), false);
  });

  check("ADS-E/F/G/H/I/J/K report GAQL is server-owned", () => {
    const cases = [
      ["campaign_performance", "FROM campaign", "campaign.advertising_channel_type"],
      ["ad_group_performance", "FROM ad_group", "ad_group.name"],
      ["keyword_performance", "FROM keyword_view", "ad_group_criterion.keyword.text"],
      ["search_terms", "FROM search_term_view", "search_term_view.search_term"],
      ["device_performance", "FROM campaign", "segments.device"],
      ["geographic_performance", "FROM geographic_view", "geographic_view.country_criterion_id"],
      ["conversion_performance", "FROM campaign", "segments.conversion_action_name"],
    ];
    for (const [reportType, from, field] of cases) {
      const built = ads().buildReportQuery({
        reportType,
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        limit: 10,
      });
      assertX.ok(built.gaql.includes(from), reportType);
      assertX.ok(built.gaql.includes(field), reportType);
      assertX.ok(built.gaql.startsWith("SELECT "));
      assertX.equal(built.gaql.includes("mutate"), false);
    }
    const conversion = ads().buildReportQuery({
      reportType: "conversion_performance",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      limit: 10,
    });
    assertX.equal(conversion.gaql.includes("metrics.impressions"), false);
    assertX.equal(conversion.gaql.includes("metrics.cost_micros"), false);
    assertX.ok(conversion.gaql.includes("metrics.conversions"));
  });

  check("ADS-L/M date presets and custom range", () => {
    const preset = ads().buildReportQuery({
      reportType: "campaign_performance",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      limit: 5,
    });
    assertX.ok(
      preset.gaql.includes("segments.date BETWEEN '2026-09-01' AND '2026-09-07'")
    );
    const { resolveDateRange } = require("../services/workflowGoogleDateRange");
    const custom = resolveDateRange("custom", {
      startDate: "2026-08-01",
      endDate: "2026-08-15",
    });
    assertX.equal(custom.startDate, "2026-08-01");
    assertX.equal(custom.endDate, "2026-08-15");
    const last7 = resolveDateRange("last7days", {
      nowMs: Date.parse("2026-09-07T12:00:00Z"),
    });
    assertX.equal(last7.startDate, "2026-09-01");
    assertX.equal(last7.endDate, "2026-09-07");
  });

  check("ADS-N filters are validated and cannot inject GAQL", () => {
    const built = ads().buildReportQuery({
      reportType: "campaign_performance",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      limit: 5,
      filters: {
        campaignStatus: "ENABLED",
        campaignId: "99",
        campaignName: "brand' OR campaign.status = REMOVED",
      },
    });
    assertX.ok(built.gaql.includes("campaign.status = ENABLED"));
    assertX.ok(built.gaql.includes("campaign.id = 99"));
    assertX.ok(
      built.gaql.includes("LIKE '%brand\\' OR campaign.status = REMOVED%'")
    );
    assertX.equal(built.gaql.split("campaign.status = ENABLED").length, 2);
    assertX.throws(
      () =>
        ads().buildReportQuery({
          reportType: "campaign_performance",
          startDate: "2026-09-01",
          endDate: "2026-09-07",
          filters: { campaignStatus: "DELETED" },
          limit: 5,
        }),
      (err) => err.code === "GOOGLE_ADS_FILTER"
    );
    assertX.throws(
      () =>
        ads().buildReportQuery({
          reportType: "nope",
          startDate: "2026-09-01",
          endDate: "2026-09-07",
          limit: 5,
        }),
      (err) => err.code === "GOOGLE_ADS_REPORT"
    );
  });

  check("ADS-O/P return all and limit", () => {
    const limited = ads().buildReportQuery({
      reportType: "keyword_performance",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      limit: 25,
    });
    assertX.ok(limited.gaql.endsWith("LIMIT 25"));
    const all = ads().buildReportQuery({
      reportType: "keyword_performance",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      limit: ads().ADS_ROW_MAX,
    });
    assertX.ok(all.gaql.endsWith(`LIMIT ${ads().ADS_ROW_MAX}`));
  });

  check("ADS-Q/R/S pagination, WorkflowItems, and expressions", async () => {
    const calls = [];
    const result = await ads().runGoogleAdsReport(
      baseNode({
        customerId: "{{item.customerId}}",
        limit: 10,
        returnAll: false,
      }),
      {
        item: { json: { customerId: "1234567890" } },
        input: {},
        steps: {},
        items: {},
        workspaceId: "ws",
      },
      { json: { customerId: "1234567890" } },
      {
        retryDelayMs: 0,
        googleApiRequest: async (req) => {
          calls.push(req);
          if (!req.body.pageToken) {
            return {
              body: {
                results: [sampleRow],
                nextPageToken: "page-2",
              },
            };
          }
          return {
            body: {
              results: [
                {
                  ...sampleRow,
                  campaign: { ...sampleRow.campaign, id: "12", name: "Generic" },
                  metrics: { ...sampleRow.metrics, costMicros: "500000" },
                },
              ],
            },
          };
        },
      }
    );
    assertX.equal(calls.length, 2);
    assertX.equal(calls[0].method, "POST");
    assertX.ok(calls[0].url.includes("/v25/customers/1234567890/googleAds:search"));
    assertX.equal(calls[0].requiredType, "google_ads");
    assertX.equal(calls[1].body.pageToken, "page-2");
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.campaignName, "Brand");
    assertX.equal(result.items[0].json.costMicros, 2500000);
    assertX.equal(result.items[0].json.cost, 2.5);
    assertX.equal(result.items[0].json.averageCpcMicros, 250000);
    assertX.equal(result.items[0].json.averageCpc, 0.25);
    assertX.equal(result.items[0].json.ctr, 0.1);
    assertX.equal(result.items[0].json.currencyCode, "USD");
    assertX.equal(result.items[1].json.cost, 0.5);
    assertX.equal(result.items[0].json.rows, undefined);
    assertX.equal(JSON.stringify(result).includes("developerToken"), false);
  });

  check("ADS-T/U/V/W invalid customer, report, auth, and quota retry", async () => {
    await assertX.rejects(
      () =>
        ads().runGoogleAdsReport(
          baseNode({ customerId: "not-an-id" }),
          {},
          null,
          { googleApiRequest: async () => { throw new Error("should not call"); } }
        ),
      (err) => err.code === "GOOGLE_ADS_CUSTOMER_INVALID"
    );
    await assertX.rejects(
      () =>
        ads().runGoogleAdsReport(
          baseNode({ operation: "pauseCampaign" }),
          {},
          null,
          { googleApiRequest: async () => ({ body: { results: [] } }) }
        ),
      (err) => err.code === "GOOGLE_ADS_READ_ONLY"
    );
    const unauth = oauth().sanitizeGoogleError(
      403,
      {
        error: {
          details: [
            {
              errors: [
                {
                  errorCode: { authorizationError: "USER_PERMISSION_DENIED" },
                  message: "developer token SHOULD_NOT_LEAK",
                },
              ],
            },
          ],
        },
      },
      { product: "google_ads" }
    );
    assertX.equal(unauth.code, "GOOGLE_ADS_CUSTOMER_UNAUTHORIZED");
    assertX.equal(String(unauth.message).includes("SHOULD_NOT_LEAK"), false);
    const badQuery = oauth().sanitizeGoogleError(
      400,
      { error: { details: [{ errors: [{ errorCode: { queryError: "BAD_FIELD" } }] }] } },
      { product: "google_ads" }
    );
    assertX.equal(badQuery.code, "GOOGLE_ADS_QUERY");
    let attempts = 0;
    const retried = await ads().runGoogleAdsReport(
      baseNode(),
      {},
      null,
      {
        retryDelayMs: 0,
        googleApiRequest: async () => {
          attempts += 1;
          if (attempts === 1) {
            const err = new Error("quota");
            err.code = "GOOGLE_ADS_QUOTA";
            err.retryable = true;
            throw err;
          }
          return { body: { results: [sampleRow] } };
        },
      }
    );
    assertX.equal(attempts, 2);
    assertX.equal(retried.items.length, 1);
    const dev = oauth().sanitizeGoogleError(
      403,
      { error: { details: [{ errors: [{ errorCode: { developerTokenError: "INVALID" } }] }] } },
      { product: "google_ads" }
    );
    assertX.equal(dev.code, "GOOGLE_ADS_DEVELOPER_TOKEN");
    assertX.equal(String(dev.message).includes("SHOULD_NOT_LEAK"), false);
    assertX.equal(ads().ADS_API_VERSION, "v25");
    const production = oauth().sanitizeGoogleError(
      403,
      {
        error: {
          status: "PERMISSION_DENIED",
          message: "token SHOULD_NOT_LEAK",
          details: [
            {
              requestId: "req-safe-1",
              errors: [
                {
                  errorCode: {
                    authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
                  },
                  message: "raw Google text SHOULD_NOT_LEAK",
                },
              ],
            },
          ],
        },
      },
      {
        product: "google_ads",
        apiVersion: "v25",
        customerId: "7887133215",
        loginCustomerId: "675-305-9302",
        developerHeaderSent: false,
      }
    );
    assertX.equal(production.code, "GOOGLE_ADS_API_ERROR");
    assertX.equal(production.message.includes("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"), true);
    assertX.equal(production.message.includes("httpStatus: 403"), true);
    assertX.equal(production.message.includes("customerId: 7887133215"), true);
    assertX.equal(production.message.includes("loginCustomerId: 6753059302"), true);
    assertX.equal(production.message.includes("developerHeaderSent: no"), true);
    assertX.equal(production.message.includes("SHOULD_NOT_LEAK"), false);
    assertX.equal(/oauth/i.test(production.message), false);
    const missingVersion = oauth().sanitizeGoogleError(
      404,
      "<!DOCTYPE html><title>Error 404</title>",
      { product: "google_ads", apiVersion: "v21" }
    );
    assertX.equal(missingVersion.message.includes("Google Ads request failed."), false);
    assertX.equal(missingVersion.message.includes("code: NOT_FOUND"), true);
    assertX.equal(missingVersion.message.includes("httpStatus: 404"), true);
    assertX.equal(missingVersion.message.includes("<html"), false);
  });

  const actor = { id: "user-a", userId: "user-a", role: "Admin" };
  const adsScope = "https://www.googleapis.com/auth/adwords";

  check("ADS-OPT-1 credential saves without developerToken", () => {
    const checked = credentials().validateGoogleCreate({
      type: "google_ads",
      secret: { clientSecret: "sec" },
      config: { oauthAppMode: "CUSTOM_APP", clientId: "cid" },
    });
    assertX.equal(checked.errors.length, 0);
    const payload = credentials().buildGoogleCreateSecret({
      type: "google_ads",
      mode: "CUSTOM_APP",
      secret: { clientSecret: "sec" },
    });
    assertX.equal(payload.clientSecret, "sec");
    assertX.equal(Object.prototype.hasOwnProperty.call(payload, "developerToken"), false);
    const credSrc = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/credentials.service.js"),
      "utf8"
    );
    assertX.equal(credSrc.includes("Google Ads developer token is required"), false);
    const modal = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/GoogleCredentialModal.tsx"
      ),
      "utf8"
    );
    assertX.equal(modal.includes("Developer token *"), false);
    assertX.ok(modal.includes("Developer token"));
    assertX.ok(modal.includes("legacy compatibility"));
    assertX.equal(modal.includes('next.developerToken = "This field is required"'), false);
    const { validateCredential } = require("../modules/workflows/workflows.validation");
    const errors = validateCredential({
      body: {
        workspaceId: "ws",
        name: "Google Ads",
        type: "google_ads",
        secret: { clientSecret: "sec" },
        config: { oauthAppMode: "CUSTOM_APP", clientId: "cid" },
      },
    });
    assertX.equal(errors.length, 0);
    assertX.equal(errors.join(" ").includes("type must be one of"), false);
  });

  check("ADS-OPT-2 OAuth starts without developerToken", async () => {
    const credId = "cred-ads-opt";
    await oauth().withGoogleOAuthTestHooks(
      {
        credentialResolver: async () => ({
          id: credId,
          type: "google_ads",
          name: "Ads",
          workspaceId: "ws",
          secret: { clientSecret: "sec", oauthAppMode: "CUSTOM_APP" },
          config: { oauthAppMode: "CUSTOM_APP", clientId: "ads-client" },
        }),
      },
      async () => {
        const started = await oauth().startGoogleOAuth(
          { workspaceId: "ws", product: "google_ads", credentialId: credId },
          actor
        );
        const auth = new URL(started.url);
        assertX.ok(String(auth.searchParams.get("scope") || "").includes(adsScope));
        assertX.equal(auth.searchParams.get("client_id"), "ads-client");
        assertX.equal(JSON.stringify(started).includes("developerToken"), false);
      }
    );
  });

  check("ADS-OPT-3 OAuth callback works without developerToken", async () => {
    const credId = "cred-ads-cb";
    const store = new Map([
      [
        credId,
        {
          id: credId,
          type: "google_ads",
          workspaceId: "ws",
          name: "Ads",
          secret: { clientSecret: "sec-keep", oauthAppMode: "CUSTOM_APP" },
          config: { oauthAppMode: "CUSTOM_APP", clientId: "cid-keep" },
        },
      ],
    ]);
    let state = "";
    await oauth().withGoogleOAuthTestHooks(
      {
        credentialResolver: async (id) => store.get(id),
        credentialSaver: async (id, secret, configObj) => {
          const cur = store.get(id);
          store.set(id, { ...cur, secret, config: configObj });
        },
        transport: async () => ({
          status: 200,
          ok: true,
          body: {
            access_token: "at-ads",
            refresh_token: "rt-ads",
            expires_in: 3600,
            token_type: "Bearer",
            scope: adsScope,
          },
          headers: {},
        }),
      },
      async () => {
        const started = await oauth().startGoogleOAuth(
          { workspaceId: "ws", product: "google_ads", credentialId: credId },
          actor
        );
        state = started.state;
        const result = await oauth().finishGoogleOAuth("code-ads", state);
        assertX.equal(result.credentialId, credId);
        const saved = store.get(credId);
        assertX.equal(saved.secret.accessToken, "at-ads");
        assertX.equal(saved.secret.refreshToken, "rt-ads");
        assertX.equal(saved.secret.clientSecret, "sec-keep");
        assertX.equal(saved.secret.developerToken, undefined);
        assertX.equal(saved.config.connected, true);
      }
    );
  });

  check("ADS-OPT-4 token refresh works without developerToken", async () => {
    let bodySeen = "";
    await oauth().withGoogleOAuthTestHooks(
      {
        transport: async (_url, opts) => {
          bodySeen = String(opts.body || "");
          return {
            status: 200,
            ok: true,
            body: { access_token: "at-refreshed", expires_in: 3600, token_type: "Bearer" },
            headers: {},
          };
        },
      },
      async () => {
        const refreshed = await oauth().refreshAccessToken(
          {
            refreshToken: "rt",
            clientSecret: "custom-secret",
            oauthAppMode: "CUSTOM_APP",
          },
          { oauthAppMode: "CUSTOM_APP", clientId: "custom-client" }
        );
        assertX.equal(refreshed.accessToken, "at-refreshed");
        assertX.equal(refreshed.developerToken, undefined);
        assertX.ok(bodySeen.includes("client_id=custom-client"));
        const kept = await oauth().refreshAccessToken(
          {
            refreshToken: "rt",
            clientSecret: "custom-secret",
            oauthAppMode: "CUSTOM_APP",
            developerToken: "LEGACY_DEV_TOKEN",
          },
          { oauthAppMode: "CUSTOM_APP", clientId: "custom-client" }
        );
        assertX.equal(kept.developerToken, "LEGACY_DEV_TOKEN");
        assertX.equal(bodySeen.includes("LEGACY_DEV_TOKEN"), false);
      }
    );
  });

  check("ADS-OPT-5 reporting works without developerToken", async () => {
    let seenHeaders = null;
    const logs = [];
    await oauth().withGoogleOAuthTestHooks(
      {
        now: () => Date.parse("2026-09-07T12:00:00Z"),
        logger: (fields) => logs.push(JSON.stringify(oauth().redactLog(fields))),
        credentialResolver: async () => ({
          id: "cred-ads",
          type: "google_ads",
          workspaceId: "ws",
          secret: {
            accessToken: "ya29-access",
            refreshToken: "rt",
            expiryMs: Date.parse("2026-09-07T13:00:00Z"),
            oauthAppMode: "CUSTOM_APP",
            clientSecret: "sec",
          },
          config: { oauthAppMode: "CUSTOM_APP", clientId: "cid" },
        }),
        transport: async (url, opts) => {
          seenHeaders = opts.headers || {};
          assertX.ok(String(url).includes("/googleAds:search"));
          return { status: 200, ok: true, body: { results: [sampleRow] }, headers: {} };
        },
      },
      async () => {
        const result = await ads().runGoogleAdsReport(
          baseNode(),
          { workspaceId: "ws" },
          null
        );
        assertX.equal(result.items.length, 1);
        assertX.equal(result.items[0].json.campaignName, "Brand");
        assertX.equal(seenHeaders["developer-token"], undefined);
        assertX.ok(String(seenHeaders.Authorization || "").includes("ya29-access"));
        assertX.equal(JSON.stringify(result).includes("developerToken"), false);
        assertX.equal(logs.join("\n").includes("ya29-access"), false);
      }
    );
  });

  check("ADS-OPT-6 legacy developerToken stays encrypted", () => {
    const { encryptSecret, decryptSecret } = require("../services/secretBox.service");
    const payload = credentials().buildGoogleCreateSecret({
      type: "google_ads",
      mode: "CUSTOM_APP",
      secret: { clientSecret: "sec", developerToken: "LEGACY_DEV_TOKEN" },
    });
    assertX.equal(payload.developerToken, "LEGACY_DEV_TOKEN");
    const enc = encryptSecret(payload);
    assertX.equal(String(enc).includes("LEGACY_DEV_TOKEN"), false);
    assertX.equal(decryptSecret(enc).developerToken, "LEGACY_DEV_TOKEN");
    const formatted = credentials().formatCredential({
      id: "c1",
      workspace_id: "ws",
      name: "Ads",
      type: "google_ads",
      created_by: "u",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      config_json: JSON.stringify({ oauthAppMode: "CUSTOM_APP", clientId: "cid" }),
      secret_json: enc,
    });
    assertX.equal(JSON.stringify(formatted).includes("LEGACY_DEV_TOKEN"), false);
  });

  check("ADS-OPT-7 developer token never leaks", async () => {
    const token = "LEGACY_DEV_TOKEN";
    const redacted = oauth().redactLog({
      developerToken: token,
      headers: { "developer-token": token, Accept: "application/json" },
    });
    assertX.equal(JSON.stringify(redacted).includes(token), false);
    assertX.equal(redacted.developerToken, "[REDACTED]");
    assertX.equal(redacted.headers["developer-token"], "[REDACTED]");
    let seenHeaders = null;
    const logs = [];
    await oauth().withGoogleOAuthTestHooks(
      {
        now: () => Date.parse("2026-09-07T12:00:00Z"),
        logger: (fields) => logs.push(JSON.stringify(oauth().redactLog(fields))),
        credentialResolver: async () => ({
          id: "cred-ads",
          type: "google_ads",
          workspaceId: "ws",
          secret: {
            accessToken: "ya29-access",
            refreshToken: "rt",
            expiryMs: Date.parse("2026-09-07T13:00:00Z"),
            oauthAppMode: "CUSTOM_APP",
            developerToken: token,
          },
          config: { oauthAppMode: "CUSTOM_APP", clientId: "cid" },
        }),
        transport: async (_url, opts) => {
          seenHeaders = opts.headers || {};
          return { status: 200, ok: true, body: { results: [] }, headers: {} };
        },
      },
      async () => {
        const result = await ads().runGoogleAdsReport(baseNode(), { workspaceId: "ws" }, null);
        assertX.equal(seenHeaders["developer-token"], token);
        assertX.equal(JSON.stringify(result).includes(token), false);
        assertX.equal(logs.join("\n").includes(token), false);
      }
    );
  });

  check("ADS-OPT-8 GA4 and GSC authentication stay unchanged", async () => {
    const products = oauth().GOOGLE_PRODUCTS;
    assertX.deepEqual(products.google_ga4.scopes, [
      "https://www.googleapis.com/auth/analytics.readonly",
    ]);
    assertX.deepEqual(products.google_gsc.scopes, [
      "https://www.googleapis.com/auth/webmasters.readonly",
    ]);
    const store = {
      google_ga4: {
        id: "ga4",
        type: "google_ga4",
        name: "GA4",
        workspaceId: "ws",
        secret: { clientSecret: "ga4-sec", oauthAppMode: "CUSTOM_APP" },
        config: { oauthAppMode: "CUSTOM_APP", clientId: "ga4-client" },
      },
      google_gsc: {
        id: "gsc",
        type: "google_gsc",
        name: "GSC",
        workspaceId: "ws",
        secret: { clientSecret: "gsc-sec", oauthAppMode: "CUSTOM_APP" },
        config: { oauthAppMode: "CUSTOM_APP", clientId: "gsc-client" },
      },
    };
    await oauth().withGoogleOAuthTestHooks(
      { credentialResolver: async (id) => store[id] },
      async () => {
        const ga4 = await oauth().startGoogleOAuth(
          { workspaceId: "ws", product: "google_ga4", credentialId: "google_ga4" },
          actor
        );
        const gsc = await oauth().startGoogleOAuth(
          { workspaceId: "ws", product: "google_gsc", credentialId: "google_gsc" },
          actor
        );
        const ga4Scope = new URL(ga4.url).searchParams.get("scope") || "";
        const gscScope = new URL(gsc.url).searchParams.get("scope") || "";
        assertX.ok(ga4Scope.includes("https://www.googleapis.com/auth/analytics.readonly"));
        assertX.ok(gscScope.includes("https://www.googleapis.com/auth/webmasters.readonly"));
        assertX.equal(ga4Scope.includes(adsScope), false);
        assertX.equal(gscScope.includes(adsScope), false);
      }
    );
    let ga4Headers = null;
    let gscHeaders = null;
    await oauth().withGoogleOAuthTestHooks(
      {
        now: () => Date.parse("2026-09-07T12:00:00Z"),
        transport: async (url, opts) => {
          if (String(url).includes("analyticsdata")) ga4Headers = opts.headers;
          if (String(url).includes("searchconsole")) gscHeaders = opts.headers;
          return { status: 200, ok: true, body: {}, headers: {} };
        },
      },
      async () => {
        const secret = {
          accessToken: "ya29-other",
          expiryMs: Date.parse("2026-09-07T13:00:00Z"),
          developerToken: "SHOULD_NOT_APPLY",
        };
        await oauth().googleAuthorizedFetch({
          product: "google_ga4",
          secret,
          url: "https://analyticsdata.googleapis.com/v1beta/properties/1:runReport",
          method: "POST",
          body: {},
        });
        await oauth().googleAuthorizedFetch({
          product: "google_gsc",
          secret,
          url: "https://searchconsole.googleapis.com/webmasters/v3/sites",
          method: "GET",
        });
      }
    );
    assertX.equal(ga4Headers["developer-token"], undefined);
    assertX.equal(gscHeaders["developer-token"], undefined);
    assertX.ok(String(ga4Headers.Authorization || "").startsWith("Bearer "));
  });

  check("ADS-X/Y no mutation path is wired", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowGoogleAds.service.js"),
      "utf8"
    );
    assertX.equal(src.includes("googleAds:mutate"), false);
    assertX.equal(src.includes("mutateOperations"), false);
    assertX.equal(/CampaignOperation|AdGroupOperation|AdGroupCriterionOperation/.test(src), false);
    assertX.ok(src.includes("googleAds:search"));
    const nodeSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowGoogleNodes.service.js"),
      "utf8"
    );
    assertX.ok(nodeSrc.includes('type === "googleAds"'));
    assertX.equal(nodeSrc.includes("googleAds:mutate"), false);
  });

  check("ADS-AI Google Ads rows are not rendered as a GA4 landing report", async () => {
    const grounding = require("../services/workflowGoogleAdsAiGrounding");
    const ga4Ground = require("../services/workflowGa4AiGrounding");
    const { handlers, resolveLandingOpportunitiesForResult } = require("../services/workflowNodes.service");
    const campaign = {
      source: "google_ads",
      provider: "google_ads",
      reportType: "campaign_performance",
      campaignId: "11",
      campaignName: "Brand",
      campaignStatus: "PAUSED",
      impressions: 100,
      clicks: 10,
      ctr: 0.1,
      costMicros: 2500000,
      cost: 2.5,
      averageCpcMicros: 250000,
      averageCpc: 0.25,
      conversions: 1,
      conversionsValue: 4,
      date: "2026-09-01",
    };
    const keyword = {
      source: "google_ads",
      provider: "google_ads",
      reportType: "keyword_performance",
      campaignName: "Brand",
      keywordText: "running shoes",
      impressions: 40,
      clicks: 4,
      ctr: 0.1,
      cost: 1,
    };
    const searchTerm = {
      source: "google_ads",
      provider: "google_ads",
      reportType: "search_terms",
      searchTerm: "buy shoes",
      campaignName: "Brand",
      impressions: 8,
      clicks: 1,
      cost: 0.4,
    };
    const adsGround = grounding.applyGoogleAdsAiGrounding({
      systemPrompt: "Summarize the rows.",
      userPrompt: "{{input}}",
      input: [{ json: campaign }],
    });
    assertX.equal(adsGround.grounded, true);
    assertX.equal(adsGround.source, "google_ads");
    assertX.equal(adsGround.entity, "campaign");
    assertX.match(adsGround.systemPrompt, /source: google_ads/);
    assertX.match(adsGround.systemPrompt, /Do not call this a GA4 Intelligence Report/);
    assertX.match(adsGround.systemPrompt, /landing_underperformance/);
    assertX.match(adsGround.systemPrompt, /Do not invent Landing Page/);
    const ga4 = ga4Ground.applyGa4NativeAiGrounding({
      systemPrompt: "Summarize",
      userPrompt: "",
      input: [{ json: campaign }],
    });
    assertX.equal(ga4.grounded, false);
    for (const [row, entity] of [
      [keyword, "keyword"],
      [searchTerm, "search term"],
    ]) {
      const grounded = grounding.applyGoogleAdsAiGrounding({
        systemPrompt: "",
        userPrompt: "",
        input: [{ json: row }],
      });
      assertX.equal(grounded.entity, entity);
      assertX.match(grounded.systemPrompt, /Do not call this a GA4 Intelligence Report/);
    }
    const report = grounding.formatGoogleAdsReport([campaign]);
    assertX.match(report, /Google Ads Report/);
    assertX.match(report, /Campaign: Brand/);
    assertX.match(report, /Impressions: 100/);
    assertX.match(report, /Cost: 2\.5/);
    assertX.equal(report.includes("GA4 Intelligence Report"), false);
    assertX.equal(report.includes("Landing Underperformance"), false);
    assertX.equal(report.includes("Landing Page"), false);
    assertX.equal(report.includes("(unknown)"), false);
    const resolved = resolveLandingOpportunitiesForResult(
      { isLlm: true, text: "GA4 Intelligence Report", json: { opportunities: [campaign] }, opportunities: [campaign] },
      "GA4 Intelligence Report"
    );
    assertX.match(resolved.report, /Campaign: Brand/);
    assertX.equal(resolved.report.includes("GA4 Intelligence Report"), false);
    assertX.equal(resolved.report.includes("Landing Page"), false);
    const result = await handlers.result(
      { id: "result-1", type: "result", data: { mapFrom: "{{steps.ai-1.text}}" } },
      {
        steps: {
          "ai-1": {
            isLlm: true,
            text: "GA4 Intelligence Report\nLanding Page: (unknown)",
            json: { opportunities: [campaign] },
            opportunities: [campaign],
          },
        },
        input: {},
      }
    );
    assertX.match(String(result.output.result), /Campaign: Brand/);
    assertX.equal(String(result.output.result).includes("GA4 Intelligence Report"), false);
    assertX.equal(String(result.output.result).includes("Landing Page"), false);
    assertX.equal(result.resolved.googleAdsReport, true);
    assertX.equal(result.resolved.landingReport, false);
  });

  check("ADS-PROV Google Ads _meta stays out of GA4 landing interpretation", () => {
    const grounding = require("../services/workflowGoogleAdsAiGrounding");
    const ga4Ground = require("../services/workflowGa4AiGrounding");
    const { resolveLandingOpportunitiesForResult } = require("../services/workflowNodes.service");
    const normalized = ads().normalizeAdsRow(
      sampleRow,
      "campaign_performance",
      {
        customerId: "788-713-3215",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
      }
    );
    assertX.equal(normalized._meta.resource, "campaign");
    assertX.equal(
      ads().normalizeAdsRow(sampleRow, "keyword_performance")._meta.resource,
      "keyword"
    );
    assertX.equal(
      ads().normalizeAdsRow(sampleRow, "search_terms")._meta.resource,
      "search_term"
    );
    assertX.equal(normalized.impressions, 100);
    assertX.equal(normalized.clicks, 10);
    assertX.equal(normalized.ctr, 0.1);
    assertX.equal(normalized.cost, 2.5);
    assertX.equal(normalized.conversions, 2);
    assertX.deepEqual(normalized._meta, {
      provider: "google_ads",
      resource: "campaign",
      report: "campaign_performance",
      customerId: "7887133215",
      dateRange: { startDate: "2026-09-01", endDate: "2026-09-07" },
    });
    assertX.equal(JSON.stringify(normalized._meta).includes("developerToken"), false);
    assertX.equal(JSON.stringify(normalized._meta).includes("accessToken"), false);
    const boundary = {
      _meta: {
        provider: "google_ads",
        resource: "campaign",
        report: "campaign_performance",
        customerId: "7887133215",
        dateRange: { startDate: "2026-09-01", endDate: "2026-09-07" },
      },
      campaignId: "11",
      campaignName: "Brand",
      campaignStatus: "PAUSED",
      impressions: 100,
      clicks: 10,
      ctr: 0.1,
      cost: 2.5,
    };
    const adsGround = grounding.applyGoogleAdsAiGrounding({
      systemPrompt: "Summarize the rows.",
      userPrompt: "",
      input: [{ json: boundary }],
    });
    assertX.equal(adsGround.grounded, true);
    assertX.equal(adsGround.source, "google_ads");
    assertX.equal(adsGround.entity, "campaign");
    assertX.match(adsGround.systemPrompt, /Never invent landingPage/);
    assertX.match(adsGround.systemPrompt, /Never invent sessions/);
    assertX.match(adsGround.systemPrompt, /Never invent engagementRate/);
    assertX.match(adsGround.systemPrompt, /Never invent bounceRate/);
    assertX.equal(ga4Ground.applyGa4NativeAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: boundary }],
    }).grounded, false);
    const report = grounding.formatGoogleAdsReport([boundary]);
    assertX.match(report, /Campaign: Brand/);
    assertX.match(report, /Impressions: 100/);
    assertX.equal(report.includes("GA4 Intelligence Report"), false);
    assertX.equal(report.includes("landing_underperformance"), false);
    assertX.equal(report.includes("landingPage"), false);
    assertX.equal(report.includes("sessions"), false);
    assertX.equal(report.includes("engagementRate"), false);
    assertX.equal(report.includes("bounceRate"), false);
    const resolved = resolveLandingOpportunitiesForResult(
      {
        isLlm: true,
        text: "GA4 Intelligence Report",
        opportunities: [boundary],
      },
      "GA4 Intelligence Report"
    );
    assertX.equal(resolved.source, "google_ads");
    assertX.equal(resolved.report.includes("GA4 Intelligence Report"), false);
    assertX.equal(resolved.report.includes("landing_underperformance"), false);
    assertX.equal(resolved.report.includes("Landing Page"), false);
  });

  check("ADS-RPT geographic entity and _meta survive on every report type", () => {
    const geoQuery = ads().buildReportQuery({
      reportType: "geographic_performance",
      startDate: "2026-09-24",
      endDate: "2026-09-30",
      limit: 5,
    });
    assertX.ok(geoQuery.gaql.includes("geographic_view.country_criterion_id"));
    assertX.ok(geoQuery.gaql.includes("geographic_view.location_type"));
    assertX.ok(geoQuery.gaql.includes("FROM geographic_view"));

    const geo = ads().normalizeAdsRow(
      {
        ...sampleRow,
        geographicView: {
          countryCriterionId: "2356",
          locationType: "LOCATION_OF_PRESENCE",
        },
      },
      "geographic_performance",
      {
        customerId: "788-713-3215",
        startDate: "2026-09-24",
        endDate: "2026-09-30",
      }
    );
    assertX.equal(geo.countryCriterionId, "2356");
    assertX.equal(geo.locationType, "LOCATION_OF_PRESENCE");
    assertX.equal(geo.campaignId, "11");
    assertX.equal(geo._meta.provider, "google_ads");
    assertX.equal(geo._meta.resource, "geographic");
    assertX.equal(geo._meta.report, "geographic_performance");
    assertX.equal(Object.prototype.hasOwnProperty.call(geo, "country"), false);

    const keyword = ads().normalizeAdsRow(
      {
        ...sampleRow,
        adGroupCriterion: {
          status: "ENABLED",
          keyword: { text: "running shoes", matchType: "EXACT" },
        },
      },
      "keyword_performance",
      { customerId: "7887133215", startDate: "2026-09-24", endDate: "2026-09-30" }
    );
    assertX.equal(keyword.keywordText, "running shoes");
    assertX.equal(keyword._meta.provider, "google_ads");
    assertX.equal(keyword._meta.resource, "keyword");
    assertX.equal(keyword._meta.report, "keyword_performance");

    const searchTerm = ads().normalizeAdsRow(
      {
        ...sampleRow,
        searchTermView: { searchTerm: "buy shoes" },
      },
      "search_terms",
      { customerId: "7887133215", startDate: "2026-09-24", endDate: "2026-09-30" }
    );
    assertX.equal(searchTerm.searchTerm, "buy shoes");
    assertX.equal(searchTerm._meta.provider, "google_ads");
    assertX.equal(searchTerm._meta.resource, "search_term");
    assertX.equal(searchTerm._meta.report, "search_terms");

    const resources = {
      campaign_performance: "campaign",
      ad_group_performance: "ad_group",
      keyword_performance: "keyword",
      search_terms: "search_term",
      device_performance: "device",
      geographic_performance: "geographic",
      conversion_performance: "conversion",
    };
    for (const [reportType, resource] of Object.entries(resources)) {
      const row = ads().normalizeAdsRow(sampleRow, reportType, {
        customerId: "7887133215",
        startDate: "2026-09-24",
        endDate: "2026-09-30",
      });
      assertX.equal(row._meta.provider, "google_ads", reportType);
      assertX.equal(row._meta.resource, resource, reportType);
      assertX.equal(row._meta.report, reportType, reportType);
      assertX.equal(row.provider, "google_ads", reportType);
      assertX.equal(row.source, "google_ads", reportType);
    }
  });
};

module.exports = { registerGoogleAdsV1Tests };

if (require.main === module) {
  const queue = [];
  const check = (name, fn) => {
    queue.push(async () => {
      await fn();
      console.log(`  ok  ${name}`);
    });
  };
  registerGoogleAdsV1Tests({
    check,
    section: (name) => console.log(`\n${name}`),
    assert,
  });
  (async () => {
    for (const task of queue) await task();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
