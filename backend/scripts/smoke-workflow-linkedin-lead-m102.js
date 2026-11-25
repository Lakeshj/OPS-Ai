/**
 * M10.2 — OpsAi Native LinkedIn collection engine.
 * Uses injectable mock feed — does not call LinkedIn or Apify.
 */
const assert = require("node:assert/strict");
const http = require("node:http");

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

const startMockFeed = async () => {
  const posts = [
    {
      sourcePostId: "live-seo-1",
      sourcePostUrl: "https://www.linkedin.com/feed/update/urn:li:activity:live1",
      content: "Looking for SEO agency and SEO services required this quarter.",
      contentKind: "full",
      publishedAt: "2026-11-21T10:00:00.000Z",
      publishedAtVerified: true,
      author: { name: "Casey Ng", headline: "CMO" },
      engagement: { likes: 12, comments: 3, reposts: 1 },
    },
    {
      sourcePostId: "live-seo-1", // duplicate id across batches
      sourcePostUrl: "https://www.linkedin.com/feed/update/urn:li:activity:live1",
      content: "Looking for SEO agency",
      contentKind: "excerpt",
      publishedAt: "2026-11-21T10:00:00.000Z",
      publishedAtVerified: true,
    },
    {
      sourcePostId: "live-dm-2",
      sourcePostUrl: "https://www.linkedin.com/feed/update/urn:li:activity:live2",
      content: "Need a digital marketing partner for end-to-end support.",
      contentKind: "full",
      publishedAt: "2026-11-19T08:00:00.000Z",
      publishedAtVerified: false,
      author: { name: "Riley Fox" },
    },
  ];

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      body = {};
    }
    if (req.url === "/search" && req.method === "POST") {
      if (body._forceRateLimit) {
        res.writeHead(429, { "retry-after": "0", "content-type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }
      if (body._forceFail) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "boom" }));
        return;
      }
      const queries = Array.isArray(body.queries) ? body.queries : [];
      const results = posts.filter((p) => {
        const hay = p.content.toLowerCase();
        return queries.some((q) => hay.includes(String(q).toLowerCase().slice(0, 18)));
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results, paging: { hasMore: false } }));
      return;
    }
    if (req.url === "/post" && req.method === "POST") {
      const needle = String(body.postUrl || body.postId || "").toLowerCase();
      const found =
        posts.find(
          (p) =>
            p.sourcePostId.toLowerCase() === needle ||
            p.sourcePostUrl.toLowerCase() === needle
        ) || null;
      if (!found) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: found }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

(async () => {
  console.log("\nM10.2 OpsAi Native LinkedIn collection engine");

  delete require.cache[require.resolve("../services/linkedinLeadDiscovery/nativeCollection/config")];
  const engine = () =>
    require("../services/linkedinLeadDiscovery/nativeCollection/engine");
  const service = () =>
    require("../services/workflowLinkedInLeadDiscovery.service");
  const feasibility = () =>
    require("../services/linkedinLeadDiscovery/nativeCollection/feasibility");
  const batcher = () =>
    require("../services/linkedinLeadDiscovery/nativeCollection/queryBatcher");
  const dedupe = () =>
    require("../services/linkedinLeadDiscovery/nativeCollection/dedupe");

  let mock;

  await check("M102-1 Feasibility matrix rejects unauthorized sources", () => {
    const { FEASIBILITY_MATRIX, SELECTED_METHODS } = feasibility();
    assert.ok(FEASIBILITY_MATRIX.length >= 6);
    assert.equal(SELECTED_METHODS.primaryLive, "opsai_authorized_opportunity_feed");
    const scrape = FEASIBILITY_MATRIX.find(
      (r) => r.id === "linkedin_html_session_scrape"
    );
    assert.equal(scrape.status, "prohibited");
    const cm = FEASIBILITY_MATRIX.find(
      (r) => r.id === "linkedin_community_management_posts_api"
    );
    assert.equal(cm.status, "not_permitted_for_this_node");
    assert.ok(SELECTED_METHODS.explicitlyRejected.includes(cm.id));
  });

  await check("M102-2 Missing config errors (no silent fixtures)", async () => {
    process.env.OPSAI_LINKEDIN_ALLOW_FIXTURES = "0";
    delete process.env.OPSAI_LINKEDIN_FEED_URL;
    delete require.cache[
      require.resolve("../services/linkedinLeadDiscovery/nativeCollection/config")
    ];
    await assert.rejects(
      () =>
        engine().search({
          operation: "discover_by_category",
          queries: ["Looking for SEO agency"],
          maxResults: 5,
        }),
      (err) => err.code === "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
    );
  });

  await check("M102-3 Query batching reports remaining coverage", () => {
    const plan = batcher().chunkQueries(
      Array.from({ length: 25 }, (_, i) => `q${i}`),
      10
    );
    assert.equal(plan.batchCount, 3);
    assert.equal(plan.totalQueries, 25);
    assert.equal(plan.batches[2].queries.length, 5);
  });

  await check("M102-4 Dedupe merges matched keywords across duplicates", () => {
    const out = dedupe().dedupeRows([
      {
        sourcePostId: "x1",
        content: "A",
        matchedKeywords: ["Looking for SEO agency"],
        matchedCategoryIds: ["seo"],
      },
      {
        sourcePostId: "x1",
        content: "A longer full content",
        contentKind: "full",
        matchedKeywords: ["SEO agency required"],
        matchedCategoryIds: ["seo", "digital_marketing"],
      },
    ]);
    assert.equal(out.uniqueCount, 1);
    assert.equal(out.duplicateMerges, 1);
    assert.ok(out.rows[0].matchedKeywords.includes("Looking for SEO agency"));
    assert.ok(out.rows[0].matchedKeywords.includes("SEO agency required"));
    assert.ok(out.rows[0].matchedCategoryIds.includes("digital_marketing"));
  });

  mock = await startMockFeed();
  process.env.OPSAI_LINKEDIN_FEED_URL = mock.url;
  process.env.OPSAI_LINKEDIN_ALLOW_FIXTURES = "0";
  process.env.OPSAI_LINKEDIN_QUERY_BATCH_SIZE = "2";
  process.env.OPSAI_LINKEDIN_CONCURRENCY = "2";
  delete require.cache[
    require.resolve("../services/linkedinLeadDiscovery/nativeCollection/config")
  ];

  // Local mock feed listens on 127.0.0.1 — allow loopback only inside this smoke.
  const withLoopbackFeed = (fn) =>
    require("../services/workflowHttpSecurity.service").withHttpSecurityTestPolicy(
      { allowLoopback: true },
      fn
    );

  await check("M102-5 Live feed category discovery (mock authorized feed)", async () => {
    const out = await withLoopbackFeed(() =>
      service().executeLinkedInLeadDiscoveryNode(
        {
          data: {
            operation: "discover_by_category",
            dataProvider: "opsai_native",
            categoryIds: ["seo", "digital_marketing"],
            maxResults: 10,
            live: true,
          },
        },
        { inputItems: [{ json: {} }] }
      )
    );
    assert.ok(out.items.length >= 1);
    assert.equal(out.output.providerMeta.liveCollection, true);
    assert.equal(out.output.providerMeta.mode, "feed");
    assert.equal(out.items[0].json._meta.fixture, false);
    assert.ok(out.items[0].json.content);
    assert.ok(out.output.coverage?.totalQueries >= 26); // seo(14)+digital_marketing(12)
  });

  await check("M102-6 Custom keywords + intent expansion via feed", async () => {
    const out = await withLoopbackFeed(() =>
      service().executeLinkedInLeadDiscoveryNode(
        {
          data: {
            operation: "discover_by_custom_keywords",
            dataProvider: "opsai_native",
            customKeywords: ["SEO agency"],
            intentExpansion: true,
            intentIds: ["looking_for", "required"],
            maxResults: 10,
            live: true,
          },
        },
        { inputItems: [{ json: {} }] }
      )
    );
    assert.equal(out.output.providerMeta.mode, "feed");
    assert.ok(out.output.queryCount >= 1);
  });

  await check("M102-7 Search posts + get post details via feed", async () => {
    const search = await withLoopbackFeed(() =>
      service().executeLinkedInLeadDiscoveryNode(
        {
          data: {
            operation: "search_posts",
            dataProvider: "opsai_native",
            customKeywords: ["digital marketing partner"],
            maxResults: 5,
            live: true,
          },
        },
        { inputItems: [{ json: {} }] }
      )
    );
    assert.ok(search.items.length >= 1);

    const details = await withLoopbackFeed(() =>
      service().executeLinkedInLeadDiscoveryNode(
        {
          data: {
            operation: "get_post_details",
            dataProvider: "opsai_native",
            postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:live1",
            live: true,
          },
        },
        { inputItems: [{ json: {} }] }
      )
    );
    assert.equal(details.items[0].json.sourcePostId, "live-seo-1");
    assert.equal(details.items[0].json.contentKind, "full");
  });

  await check("M102-8 User dataset works without feed or Apify", async () => {
    delete process.env.OPSAI_LINKEDIN_FEED_URL;
    delete require.cache[
      require.resolve("../services/linkedinLeadDiscovery/nativeCollection/config")
    ];
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "discover_by_custom_keywords",
          dataProvider: "opsai_native",
          customKeywords: ["SEO agency"],
          live: true,
        },
      },
      {
        inputItems: [
          {
            json: {
              sourcePostId: "user-1",
              sourcePostUrl: "https://www.linkedin.com/feed/update/urn:li:activity:user1",
              content: "Looking for SEO agency recommendations",
            },
          },
        ],
      }
    );
    assert.equal(out.output.providerMeta.mode, "user_dataset");
    assert.equal(out.output.providerMeta.liveCollection, false);
    assert.equal(out.items[0].json.sourcePostId, "user-1");
    assert.ok(!out.items[0].json._meta.fixture);
  });

  await check("M102-9 Partial batch failure keeps successes + continuation", async () => {
    process.env.OPSAI_LINKEDIN_FEED_URL = mock.url;
    process.env.OPSAI_LINKEDIN_QUERY_BATCH_SIZE = "1";
    delete require.cache[
      require.resolve("../services/linkedinLeadDiscovery/nativeCollection/config")
    ];
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls += 1;
      if (calls === 1) {
        return { status: 500, ok: false, body: { error: "fail" }, rateLimited: false };
      }
      // Delegate to real mock for remaining
      const res = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: JSON.stringify(options.body),
      });
      return {
        status: res.status,
        ok: res.ok,
        body: await res.json(),
        rateLimited: false,
      };
    };
    const out = await withLoopbackFeed(() =>
      engine().search(
        {
          operation: "search_posts",
          queries: ["Looking for SEO agency", "digital marketing partner"],
          maxResults: 10,
          live: true,
          fetchImpl,
        },
        { feedUrl: mock.url, allowFixtures: false }
      )
    );
    assert.ok(out.items.length >= 1);
    assert.ok(out.providerMeta.partialErrors.length >= 1);
    assert.ok(out.providerMeta.coverage.hasMore);
    assert.ok(out.providerMeta.coverage.remainingQueries.length >= 1);
  });

  await check("M102-10 Apify unconfigured does not affect Native", async () => {
    process.env.OPSAI_LINKEDIN_FEED_URL = mock.url;
    delete require.cache[
      require.resolve("../services/linkedinLeadDiscovery/nativeCollection/config")
    ];
    const out = await withLoopbackFeed(() =>
      service().executeLinkedInLeadDiscoveryNode(
        {
          data: {
            operation: "search_posts",
            dataProvider: "opsai_native",
            customKeywords: ["SEO agency"],
            live: true,
          },
        },
        { inputItems: [{ json: {} }] }
      )
    );
    assert.equal(out.output.dataProvider, "opsai_native");
    await assert.rejects(
      () =>
        service().executeLinkedInLeadDiscoveryNode(
          {
            data: {
              operation: "search_posts",
              dataProvider: "apify",
              customKeywords: ["SEO agency"],
            },
          },
          { inputItems: [{ json: {} }] }
        ),
      (err) => err.code === "LINKEDIN_LEAD_APIFY_NOT_CONNECTED"
    );
  });

  await check("M102-11 Empty results are valid (not fabricated)", async () => {
    const out = await withLoopbackFeed(() =>
      engine().search(
        {
          operation: "search_posts",
          queries: ["zzzz-no-such-opportunity-phrase-999"],
          maxResults: 5,
          live: true,
        },
        { feedUrl: mock.url, allowFixtures: false }
      )
    );
    assert.equal(out.items.length, 0);
    assert.equal(out.providerMeta.mode, "feed");
    assert.equal(out.providerMeta.liveCollection, true);
  });

  await check("M102-12 Isolation: no Apify / IG / Meta Ads / FB imports in engine", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(__dirname, "..", "services", "linkedinLeadDiscovery");
    const walk = (dir) => {
      const out = [];
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) out.push(...walk(full));
        else if (name.endsWith(".js")) out.push(full);
      }
      return out;
    };
    for (const file of walk(root)) {
      if (file.endsWith("apifyProvider.js")) continue;
      const src = fs.readFileSync(file, "utf8");
      assert.ok(
        !/workflowInstagram|workflowMetaAds|workflowFacebookPage|apifyProvider/.test(
          src
        ),
        `isolation broken in ${file}`
      );
    }
  });

  if (mock) await mock.close();

  console.log(`\n${passed} M10.2 LinkedIn Native collection checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {
    // ignore
  }
  process.exit(process.exitCode || 0);
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
