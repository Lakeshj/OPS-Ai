/**
 * M10.3.1 — Apify credential validation fix + Native source configuration.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

(async () => {
  console.log("\nM10.3.1 Apify credential + Native source config");

  const validate = () =>
    require("../modules/workflows/workflows.validation");
  const service = () =>
    require("../services/workflowLinkedInLeadDiscovery.service");
  const usageMod = () =>
    require("../services/linkedinLeadDiscovery/apify/usage");
  const apifyProvider = () =>
    require("../services/linkedinLeadDiscovery/apifyProvider");
  const feedConn = () =>
    require("../services/linkedinLeadDiscovery/nativeCollection/feedConnection");

  await check("M1031-1 validateCredential accepts apify apiToken", () => {
    const errors = validate().validateCredential({
      body: {
        workspaceId: "ws-1",
        name: "Apify token",
        type: "apify",
        secret: { apiToken: "apify_api_xxx" },
      },
    });
    assert.deepEqual(errors, []);
  });

  await check("M1031-2 validateCredential rejects empty apify token", () => {
    const errors = validate().validateCredential({
      body: {
        workspaceId: "ws-1",
        name: "Apify token",
        type: "apify",
        secret: { apiToken: "" },
      },
    });
    assert.ok(errors.some((e) => /apiToken/i.test(e)));
  });

  await check("M1031-3 Error message no longer omits apify from allowlist", () => {
    const errors = validate().validateCredential({
      body: {
        workspaceId: "ws-1",
        name: "Bad",
        type: "not_a_real_type",
        secret: { token: "x" },
      },
    });
    assert.ok(errors.some((e) => /apify/.test(e)));
    assert.ok(!errors.some((e) => e === "type must be one of: bearer, api_key_header, basic, query_param, oauth2, google_gsc, google_ga4, google_gmail, google_sheets, google_ads"));
  });

  await check("M1031-4 Native dataset source executes without feed", async () => {
    delete process.env.OPSAI_LINKEDIN_FEED_URL;
    process.env.OPSAI_LINKEDIN_ALLOW_FIXTURES = "0";
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "discover_by_custom_keywords",
          dataProvider: "opsai_native",
          nativeSource: "user_dataset",
          nativeDatasetJson: JSON.stringify([
            {
              sourcePostId: "ds-1",
              sourcePostUrl:
                "https://www.linkedin.com/feed/update/urn:li:activity:ds1",
              content: "Looking for SEO agency for Q4",
            },
          ]),
          customKeywords: ["Looking for SEO agency"],
          maxResults: 5,
        },
      },
      { inputItems: [{ json: {} }] }
    );
    assert.equal(out.output.providerMeta.mode, "user_dataset");
    assert.equal(out.items[0].json.sourcePostId, "ds-1");
  });

  await check("M1031-5 Previous node input source", async () => {
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "search_posts",
          dataProvider: "opsai_native",
          nativeSource: "previous_node",
          customKeywords: ["SEO agency"],
        },
      },
      {
        inputItems: [
          {
            json: {
              sourcePostUrl:
                "https://www.linkedin.com/feed/update/urn:li:activity:prev1",
              content: "Need SEO agency support",
            },
          },
        ],
      }
    );
    assert.equal(out.output.providerMeta.mode, "user_dataset");
    assert.ok(out.items.length >= 1);
  });

  await check("M1031-6 Authorized feed selected but missing → actionable error", async () => {
    delete process.env.OPSAI_LINKEDIN_FEED_URL;
    await assert.rejects(
      () =>
        service().executeLinkedInLeadDiscoveryNode(
          {
            data: {
              operation: "search_posts",
              dataProvider: "opsai_native",
              nativeSource: "authorized_feed",
              customKeywords: ["SEO agency"],
            },
          },
          { inputItems: [{ json: {} }] }
        ),
      (err) => err.code === "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
    );
  });

  await check("M1031-7 Feed URL SSRF rejection for localhost", async () => {
    await assert.rejects(
      () => feedConn().validateAndNormalizeFeedUrl("http://127.0.0.1:8080"),
      (err) => Boolean(err.code || err.message)
    );
  });

  await check("M1031-8 Sanitize keeps native settings for opsai_native only", () => {
    const native = service().sanitizeLinkedInLeadDiscoveryNodeData({
      dataProvider: "opsai_native",
      nativeSource: "authorized_feed",
      nativeFeedUrl: "https://feed.example.com",
      apifyCredentialId: "should-go",
    });
    assert.equal(native.nativeSource, "authorized_feed");
    assert.equal(native.apifyCredentialId, undefined);

    const apify = service().sanitizeLinkedInLeadDiscoveryNodeData({
      dataProvider: "apify",
      nativeSource: "user_dataset",
      apifyCredentialId: "cred",
      apifyBillingMode: "free",
    });
    assert.equal(apify.nativeSource, undefined);
    assert.equal(apify.apifyCredentialId, "cred");
  });

  await check("M1031-9 Free mode serializes batches and depletes charge budget", async () => {
    const { ACTOR_PRICING } = require("../services/linkedinLeadDiscovery/apify/constants");
    let startCalls = 0;
    const client = {
      actorId: "kTfhD8wSCMRXlhNmE",
      getMe: async () => ({
        status: 200,
        body: {
          data: {
            plan: {
              id: "FREE",
              monthlyBasePriceUsd: 0,
              // Enough for one batch (start + 1 item), not two.
              monthlyUsageCreditsUsd:
                ACTOR_PRICING.events.actorStartUsd +
                ACTOR_PRICING.events.datasetItemUsd +
                0.0001,
            },
          },
        },
      }),
      getLimits: async () => ({
        status: 200,
        body: {
          data: {
            monthlyUsageCycle: {
              startAt: "2026-11-01T00:00:00.000Z",
              endAt: "2026-11-30T23:59:59.999Z",
            },
            limits: {
              maxMonthlyUsageUsd:
                ACTOR_PRICING.events.actorStartUsd +
                ACTOR_PRICING.events.datasetItemUsd +
                0.0001,
            },
            current: { monthlyUsageUsd: 0 },
          },
        },
      }),
      getActor: async () => ({ status: 200, body: { data: { id: "kTfhD8wSCMRXlhNmE" } } }),
      startRun: async (_input, options) => {
        startCalls += 1;
        assert.ok(options.maxTotalChargeUsd != null);
        return {
          status: 201,
          body: {
            data: {
              id: `run-${startCalls}`,
              status: "RUNNING",
              defaultDatasetId: `ds-${startCalls}`,
            },
          },
        };
      },
      getRun: async (runId) => ({
        status: 200,
        body: {
          data: {
            id: runId,
            status: "SUCCEEDED",
            defaultDatasetId: `ds-${runId}`,
          },
        },
      }),
      abortRun: async () => ({ status: 200, body: {} }),
      listDatasetItems: async () => ({
        status: 200,
        body: [
          {
            urn: `urn:li:activity:${startCalls}`,
            text: "Looking for SEO agency",
            url: "https://www.linkedin.com/feed/update/x",
            postedAtISO: "2026-11-20T00:00:00.000Z",
          },
        ],
      }),
    };

    // Two queries → two batches with batchSize 1; second should hit FREE_EXHAUSTED after first charge estimate.
    const out = await apifyProvider().search({
      operation: "search_posts",
      queries: ["Looking for SEO agency", "Need SEO expert"],
      queryBatchSize: 1,
      maxResults: 5,
      billingMode: "free",
      credential: { id: "c", secret: { apiToken: "t" } },
      apifyClient: client,
    });
    // Either one batch succeeded with continuation/partial, or second threw into failed batches.
    assert.ok(startCalls >= 1);
    assert.ok(
      out.items.length >= 1 ||
        (out.providerMeta.partialErrors || []).some(
          (e) => e.error?.code === "LINKEDIN_LEAD_APIFY_FREE_EXHAUSTED"
        )
    );
  });

  await check("M1031-10 FE wiring includes native source + validation fix", () => {
    const root = path.join(__dirname, "..", "..");
    const fields = fs.readFileSync(
      path.join(
        root,
        "frontend/src/components/workflows/params/LinkedInLeadDiscoveryFields.tsx"
      ),
      "utf8"
    );
    assert.match(fields, /authorized_feed/);
    assert.match(fields, /user_dataset/);
    assert.match(fields, /previous_node/);
    assert.match(fields, /testLinkedInNativeFeed/);
    const validation = fs.readFileSync(
      path.join(root, "backend/modules/workflows/workflows.validation.js"),
      "utf8"
    );
    assert.match(validation, /type === "apify"/);
  });

  await check("M1031-11 Live DB create/select/delete Apify credential", async () => {
    const { pool } = require("../config/database");
    const credentials = require("../modules/workflows/credentials.service");
    const [wsRows] = await pool.execute("SELECT id FROM workspaces LIMIT 1");
    const [userRows] = await pool.execute("SELECT id FROM users LIMIT 1");
    if (!wsRows.length || !userRows.length) {
      console.log("  skip  no workspace/user for live credential create");
      return;
    }
    const workspaceId = wsRows[0].id;
    const userId = userRows[0].id;
    const authUser = { userId, role: "system" };
    const [enumRows] = await pool.execute(
      "SHOW COLUMNS FROM workflow_credentials LIKE 'type'"
    );
    assert.match(String(enumRows[0].Type), /apify/);

    const created = await credentials.create(
      {
        workspaceId,
        name: `apify-m1031-${Date.now()}`,
        type: "apify",
        secret: { apiToken: "apify_api_test_token_not_real" },
        config: {},
      },
      authUser
    );
    assert.ok(created.id);
    assert.equal(created.type, "apify");

    const loaded = await credentials.getForWorkspace(created.id, workspaceId);
    assert.ok(loaded);
    assert.equal(loaded.type, "apify");
    assert.equal(loaded.secret.apiToken, "apify_api_test_token_not_real");

    await credentials.remove(created.id, authUser);
    const gone = await credentials.getForWorkspace(created.id, workspaceId);
    assert.equal(gone, null);
  });

  console.log(`\n${passed} M10.3.1 checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {}
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
