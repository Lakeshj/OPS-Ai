/**
 * M10.3 — Optional Apify provider (mocked Apify APIs — no live charges).
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

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

const makeMockClient = ({
  freePlan = true,
  usedUsd = 1,
  includedUsd = 5,
  maxUsd = 5,
  runItems = null,
  failRun = false,
  invalidToken = false,
} = {}) => {
  let runCounter = 0;
  const items =
    runItems ||
    [
      {
        urn: "urn:li:activity:apify1",
        text: "Looking for SEO agency recommendations this quarter",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:apify1",
        postedAtISO: "2026-11-20T12:00:00.000Z",
        authorFullName: "Mock Author",
        authorHeadline: "Founder",
        likeCount: 4,
        commentCount: 1,
        shareCount: 0,
      },
    ];

  return {
    actorId: "kfiWbq3boy3dWKbiL",
    getMe: async () => {
      if (invalidToken) {
        const err = new Error("unauthorized");
        err.status = 401;
        const AppError = require("../utils/AppError");
        throw new AppError(
          "Apify credentials are invalid or revoked. Reconnect your Apify API token.",
          401,
          "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID"
        );
      }
      return {
        status: 200,
        body: {
          data: {
            plan: {
              id: freePlan ? "FREE" : "STARTER",
              monthlyBasePriceUsd: freePlan ? 0 : 19,
              monthlyUsageCreditsUsd: includedUsd,
            },
          },
        },
      };
    },
    getLimits: async () => ({
      status: 200,
      body: {
        data: {
          monthlyUsageCycle: {
            startAt: "2026-11-01T00:00:00.000Z",
            endAt: "2026-11-30T23:59:59.999Z",
          },
          limits: { maxMonthlyUsageUsd: maxUsd },
          current: { monthlyUsageUsd: usedUsd },
        },
      },
    }),
    getMonthlyUsage: async () => ({ status: 200, body: { data: {} } }),
    getActor: async () => ({
      status: 200,
      body: { data: { id: "kfiWbq3boy3dWKbiL", name: "linkedin-post-search-scraper" } },
    }),
    startRun: async () => {
      runCounter += 1;
      return {
        status: 201,
        body: {
          data: {
            id: `run-${runCounter}`,
            status: "RUNNING",
            defaultDatasetId: `ds-${runCounter}`,
          },
        },
      };
    },
    getRun: async (runId) => ({
      status: 200,
      body: {
        data: {
          id: runId,
          status: failRun ? "FAILED" : "SUCCEEDED",
          statusMessage: failRun ? "Actor failed" : undefined,
          defaultDatasetId: failRun ? null : `ds-${runId}`,
        },
      },
    }),
    abortRun: async () => ({ status: 200, body: {} }),
    listDatasetItems: async () => ({
      status: 200,
      body: failRun ? [] : items,
    }),
  };
};

(async () => {
  console.log("\nM10.3 Apify LinkedIn Lead Discovery provider");

  const usage = () =>
    require("../services/linkedinLeadDiscovery/apify/usage");
  const mapper = () =>
    require("../services/linkedinLeadDiscovery/apify/inputMapper");
  const mapResults = () =>
    require("../services/linkedinLeadDiscovery/apify/mapResults");
  const apifyProvider = () =>
    require("../services/linkedinLeadDiscovery/apifyProvider");
  const service = () =>
    require("../services/workflowLinkedInLeadDiscovery.service");
  const lib = () =>
    require("../services/linkedinLeadDiscovery/keywordLibrary");

  await check("M103-1 Actor constants + input mapping", () => {
    const { ACTOR_ID, ACTOR_PRICING } = require("../services/linkedinLeadDiscovery/apify/constants");
    assert.equal(ACTOR_ID, "kfiWbq3boy3dWKbiL");
    assert.equal(ACTOR_PRICING.model, "PAY_PER_EVENT");
    const mapped = mapper().buildActorInput({
      queries: ["Looking for SEO agency"],
      publicationPeriod: "past-week",
      sortBy: "recent",
      maxResults: 10,
    });
    assert.equal(mapped.urls?.length || mapped.input.urls.length, 1);
    assert.match(mapped.input.urls[0], /linkedin\.com\/search\/results\/content/);
    assert.match(mapped.input.urls[0], /date_posted|datePosted/);
  });

  await check("M103-2 Keyword library unchanged (10/140/15)", () => {
    const { SERVICE_CATEGORIES, ORIGINAL_KEYWORD_COUNT, INTENT_VARIATIONS } =
      lib();
    assert.equal(SERVICE_CATEGORIES.length, 10);
    assert.equal(ORIGINAL_KEYWORD_COUNT, 140);
    assert.equal(INTENT_VARIATIONS.length, 15);
  });

  await check("M103-3 Usage snapshot shared allowance + Free plan", () => {
    const snap = usage().buildUsageSnapshot({
      me: {
        data: {
          plan: {
            id: "FREE",
            monthlyBasePriceUsd: 0,
            monthlyUsageCreditsUsd: 5,
          },
        },
      },
      limits: {
        data: {
          monthlyUsageCycle: {
            startAt: "2026-11-01T00:00:00.000Z",
            endAt: "2026-11-30T23:59:59.999Z",
          },
          limits: { maxMonthlyUsageUsd: 5 },
          current: { monthlyUsageUsd: 1.5 },
        },
      },
    });
    assert.equal(snap.available, true);
    assert.equal(snap.sharedAllowance, true);
    assert.equal(snap.freePlan, true);
    assert.equal(snap.free.usedPercent, 30);
    assert.equal(snap.free.remainingPercent, 70);
    assert.equal(snap.paid.available, false);
  });

  await check("M103-4 Paid plan infinite-limit handling", () => {
    const snap = usage().buildUsageSnapshot({
      me: {
        data: {
          plan: {
            id: "BUSINESS",
            monthlyBasePriceUsd: 999,
            monthlyUsageCreditsUsd: 999,
          },
        },
      },
      limits: {
        data: {
          monthlyUsageCycle: {
            startAt: "2026-11-01T00:00:00.000Z",
            endAt: "2026-11-30T23:59:59.999Z",
          },
          limits: { maxMonthlyUsageUsd: null },
          current: { monthlyUsageUsd: 42 },
        },
      },
    });
    assert.equal(snap.freePlan, false);
    assert.equal(snap.paid.infinite, true);
    assert.equal(snap.paid.usedPercent, null);
    assert.equal(snap.paid.usedUsd, 42);
  });

  await check("M103-5 Free exhausted + Paid-on-free-plan gates", () => {
    const exhausted = usage().buildUsageSnapshot({
      me: {
        data: {
          plan: { id: "FREE", monthlyBasePriceUsd: 0, monthlyUsageCreditsUsd: 5 },
        },
      },
      limits: {
        data: {
          limits: { maxMonthlyUsageUsd: 5 },
          current: { monthlyUsageUsd: 5 },
          monthlyUsageCycle: {},
        },
      },
    });
    assert.throws(
      () => usage().assertBillingModeAllowed(exhausted, "free"),
      (err) => err.code === "LINKEDIN_LEAD_APIFY_FREE_EXHAUSTED"
    );
    assert.throws(
      () => usage().assertBillingModeAllowed(exhausted, "paid"),
      (err) => err.code === "LINKEDIN_LEAD_APIFY_PAID_UNAVAILABLE"
    );
  });

  await check("M103-6 Output normalization from Apify items", () => {
    const rows = mapResults().mapApifyItems([
      {
        urn: "urn:li:activity:x",
        text: "Need SEO expert",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:x",
        postedAtISO: "2026-11-01T00:00:00.000Z",
        authorFullName: "A B",
        likeCount: 2,
      },
    ]);
    assert.equal(rows[0].sourcePostId, "urn:li:activity:x");
    assert.equal(rows[0].contentKind, "full");
    assert.equal(rows[0].author.name, "A B");
    assert.equal(rows[0].engagement.likes, 2);
  });

  await check("M103-7 Mocked Apify search Run Step (free mode)", async () => {
    const client = makeMockClient({ freePlan: true, usedUsd: 0.5, includedUsd: 5, maxUsd: 5 });
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "discover_by_custom_keywords",
          dataProvider: "apify",
          customKeywords: ["Looking for SEO agency"],
          apifyBillingMode: "free",
          apifyCredentialId: "cred-mock",
          maxResults: 10,
        },
      },
      {
        inputItems: [{ json: {} }],
        workspaceId: "ws-mock",
        apifyCredential: {
          id: "cred-mock",
          type: "apify",
          secret: { apiToken: "mock-token" },
        },
        apifyClient: client,
      }
    );
    assert.ok(out.items.length >= 1);
    assert.equal(out.output.dataProvider, "apify");
    assert.equal(out.output.providerMeta.liveCollection, true);
    assert.equal(out.items[0].json._meta.fixture, false);
    assert.equal(out.items[0].json.dataProvider, "apify");
    assert.equal(out.items[0].json.qualifiedLead, false);
  });

  await check("M103-8 Get Post Details via Apify mock", async () => {
    const client = makeMockClient({
      freePlan: false,
      usedUsd: 2,
      includedUsd: 19,
      maxUsd: 100,
      runItems: [
        {
          urn: "urn:li:activity:detail1",
          text: "Full post body",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:detail1",
          postedAtISO: "2026-11-18T00:00:00.000Z",
        },
      ],
    });
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "get_post_details",
          dataProvider: "apify",
          postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:detail1",
          apifyBillingMode: "paid",
          apifyCredentialId: "cred-mock",
        },
      },
      {
        workspaceId: "ws-mock",
        apifyCredential: {
          id: "cred-mock",
          type: "apify",
          secret: { apiToken: "mock-token" },
        },
        apifyClient: client,
      }
    );
    assert.equal(out.items[0].json.sourcePostId, "urn:li:activity:detail1");
  });

  await check("M103-9 Usage status API shape (mock)", async () => {
    const client = makeMockClient({ freePlan: true, usedUsd: 1, includedUsd: 5, maxUsd: 5 });
    const status = await apifyProvider().getUsageStatus({
      credential: { id: "c1", secret: { apiToken: "t" } },
      apifyClient: client,
      forceRefresh: true,
    });
    assert.equal(status.available, true);
    assert.ok(status.free.usedPercent != null);
    assert.equal(status.paid.available, false);
    assert.ok(status.refreshedAt);
  });

  await check("M103-10 Native works without Apify; Apify without Native feed", async () => {
    delete process.env.OPSAI_LINKEDIN_FEED_URL;
    process.env.OPSAI_LINKEDIN_ALLOW_FIXTURES = "1";
    const native = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "search_posts",
          dataProvider: "opsai_native",
          customKeywords: ["SEO agency"],
          useFixtures: true,
        },
      },
      { inputItems: [{ json: {} }] }
    );
    assert.equal(native.output.dataProvider, "opsai_native");

    const client = makeMockClient();
    const apifyOut = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "search_posts",
          dataProvider: "apify",
          customKeywords: ["SEO agency"],
          apifyBillingMode: "free",
          apifyCredentialId: "cred-mock",
        },
      },
      {
        workspaceId: "ws",
        apifyCredential: { id: "cred-mock", type: "apify", secret: { apiToken: "t" } },
        apifyClient: client,
      }
    );
    assert.equal(apifyOut.output.dataProvider, "apify");
  });

  await check("M103-11 Empty Apify results are not failures", async () => {
    const client = makeMockClient({ runItems: [] });
    const out = await apifyProvider().search({
      operation: "search_posts",
      queries: ["zzzz-no-match"],
      maxResults: 5,
      billingMode: "free",
      credential: { id: "c", secret: { apiToken: "t" } },
      apifyClient: client,
    });
    assert.equal(out.items.length, 0);
    assert.equal(out.providerMeta.liveCollection, true);
  });

  await check("M103-12 Isolation: Apify modules do not import Native feed/IG/Meta/FB", () => {
    const root = path.join(__dirname, "..", "services", "linkedinLeadDiscovery", "apify");
    const files = fs.readdirSync(root).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      assert.ok(
        !/workflowInstagram|workflowMetaAds|workflowFacebookPage|opsaiNativeProvider|OPSAI_LINKEDIN_FEED/.test(
          src
        ),
        f
      );
    }
    // sanitize persists provider settings keys
    const cleaned = service().sanitizeLinkedInLeadDiscoveryNodeData({
      operation: "discover_by_category",
      dataProvider: "apify",
      apifyCredentialId: "abc",
      apifyBillingMode: "paid",
      categoryIds: ["seo"],
      intentIds: ["looking_for"],
    });
    assert.equal(cleaned.apifyCredentialId, "abc");
    assert.equal(cleaned.apifyBillingMode, "paid");
    assert.deepEqual(cleaned.categoryIds, ["seo"]);
  });

  console.log(`\n${passed} M10.3 Apify provider checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {
    // ignore
  }
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
