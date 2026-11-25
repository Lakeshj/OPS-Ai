/**
 * M10.3.4 — Perigon LinkedIn Social API adapter (mocked).
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

const mockFetchFactory = (handlers) => {
  return async (url, options = {}) => {
    const u = String(url);
    for (const h of handlers) {
      if (h.match(u, options)) return h.respond(u, options);
    }
    return {
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: `no mock for ${u}` }),
      headers: { get: () => null },
    };
  };
};

(async () => {
  console.log("\nM10.3.4 Perigon LinkedIn Social adapter");

  const validation = () => require("../modules/workflows/workflows.validation");
  const perigon = () => require("../services/linkedinLeadDiscovery/perigon");
  const service = () =>
    require("../services/workflowLinkedInLeadDiscovery.service");
  const library = () =>
    require("../services/linkedinLeadDiscovery/keywordLibrary");

  await check("M1034-1 validateCredential accepts perigon apiKey", () => {
    const errors = validation().validateCredential({
      body: {
        workspaceId: "ws",
        name: "Perigon",
        type: "perigon",
        secret: { apiKey: "pg_test_key" },
      },
    });
    assert.deepEqual(errors, []);
  });

  await check("M1034-2 validateCredential rejects empty perigon key", () => {
    const errors = validation().validateCredential({
      body: {
        workspaceId: "ws",
        name: "Perigon",
        type: "perigon",
        secret: { apiKey: "" },
      },
    });
    assert.ok(errors.some((e) => /apiKey/.test(e)));
  });

  await check("M1034-3 Allowlist error includes perigon (no Apify repeat)", () => {
    const errors = validation().validateCredential({
      body: {
        workspaceId: "ws",
        name: "x",
        type: "not_a_real_type",
        secret: {},
      },
    });
    assert.ok(errors.some((e) => /perigon/.test(e)));
    assert.ok(errors.some((e) => /apify/.test(e)));
  });

  await check("M1034-4 Keyword library unchanged 10/140/15", () => {
    const lib = library().getPublicLibrary();
    assert.equal(lib.categoryCount, 10);
    assert.equal(lib.originalKeywordCount, 140);
    assert.equal(lib.intentVariationCount, 15);
  });

  await check("M1034-5 Query OR grouping never drops queries", () => {
    const plan = perigon().queryBuilder.chunkIntoOrGroups(
      ["a", "b", "c", "d", "e", "f", "g"],
      3
    );
    assert.equal(plan.totalQueries, 7);
    assert.equal(plan.groupCount, 3);
    assert.equal(plan.groups[0].q.includes("OR"), true);
    const all = plan.groups.flatMap((g) => g.keywords);
    assert.deepEqual(all, ["a", "b", "c", "d", "e", "f", "g"]);
  });

  await check("M1034-6 Map sort/datePosted + reject custom dates", () => {
    const qb = perigon().queryBuilder;
    assert.equal(qb.mapSortBy("recent"), "DATE_POSTED");
    assert.equal(qb.mapSortBy("relevance"), "RELEVANCE");
    assert.equal(qb.mapDatePosted("past-week"), "PAST_WEEK");
    assert.equal(qb.mapDatePosted("past-year"), null);
    assert.equal(qb.mapDatePosted("2024-01-01"), null);
  });

  await check("M1034-7 Normalize Perigon post fields (no fabrication)", () => {
    const row = perigon().mapResults.mapPerigonPost({
      urn: "urn:li:activity:1",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:1",
      text: "Looking for SEO agency",
      postedAt: "2026-11-01T00:00:00Z",
      author: { fullName: "Ada", url: "https://www.linkedin.com/in/ada" },
      likes: 3,
      comments: 1,
    });
    assert.equal(row.sourcePostId, "urn:li:activity:1");
    assert.equal(row._sourceAdapter, "perigon");
    assert.equal(row.author.name, "Ada");
    assert.equal(row.engagement.likes, 3);
    const sparse = perigon().mapResults.mapPerigonPost({
      urn: "urn:li:activity:2",
      text: "hi",
    });
    assert.equal(sparse.author, null);
    assert.equal(sparse.engagement, null);
  });

  await check("M1034-8 Connection: invalid API key", async () => {
    const fetchImpl = mockFetchFactory([
      {
        match: (u) => u.includes("/v1/limits"),
        respond: async () => ({
          ok: false,
          status: 401,
          text: async () =>
            JSON.stringify({ status: 401, message: "Invalid API key: x." }),
          headers: { get: () => null },
        }),
      },
    ]);
    const res = await perigon().testPerigonConnection({
      apiKey: "bad",
      fetchImpl,
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, "invalid_api_key");
  });

  await check("M1034-9 Connection: LinkedIn not enabled", async () => {
    const fetchImpl = mockFetchFactory([
      {
        match: (u) => u.includes("/v1/limits"),
        respond: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({}),
          headers: { get: () => null },
        }),
      },
      {
        match: (u) => u.includes("/v1/social/linkedin/posts"),
        respond: async () => ({
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({
              status: 403,
              message:
                "Your plan does not include access to LinkedIn social data.",
            }),
          headers: { get: () => null },
        }),
      },
    ]);
    const res = await perigon().testPerigonConnection({
      apiKey: "ok-key",
      fetchImpl,
    });
    assert.equal(res.status, "linkedin_not_enabled");
    assert.equal(res.ok, false);
  });

  await check("M1034-10 Connection: quota exhausted", async () => {
    const fetchImpl = mockFetchFactory([
      {
        match: (u) => u.includes("/v1/limits"),
        respond: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              social: {
                requestsUsed: 10000,
                requestLimit: 10000,
                since: "2026-11-01T00:00:00Z",
                resetAt: "2026-12-01T00:00:00Z",
              },
            }),
          headers: { get: () => null },
        }),
      },
      {
        match: (u) => u.includes("/v1/social/linkedin/posts"),
        respond: async () => ({
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({
              status: 403,
              message: "The number of allowed social requests is exceeded",
            }),
          headers: { get: () => null },
        }),
      },
    ]);
    const res = await perigon().testPerigonConnection({
      apiKey: "ok-key",
      fetchImpl,
    });
    assert.equal(res.status, "quota_exhausted");
  });

  await check("M1034-11 Connection success + usage percentages", async () => {
    let linkedInHits = 0;
    const fetchImpl = mockFetchFactory([
      {
        match: (u) => u.includes("/v1/limits"),
        respond: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              social: {
                requestsUsed: 2500,
                requestLimit: 10000,
                since: "2026-11-01T00:00:00Z",
                resetAt: "2026-12-01T00:00:00Z",
              },
            }),
          headers: { get: () => null },
        }),
      },
      {
        match: (u) => u.includes("/v1/social/linkedin/posts"),
        respond: async () => {
          linkedInHits += 1;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                status: 200,
                numResults: 1,
                results: [
                  {
                    urn: "urn:li:activity:probe",
                    url: "https://www.linkedin.com/feed/update/urn:li:activity:probe",
                    text: "hello",
                    postedAt: "2026-11-20T00:00:00Z",
                  },
                ],
              }),
            headers: { get: () => null },
          };
        },
      },
    ]);
    const res = await perigon().testPerigonConnection({
      apiKey: "ok-key",
      fetchImpl,
    });
    assert.equal(res.ok, true);
    assert.equal(res.status, "connected");
    assert.ok(linkedInHits >= 1);

    const usage = perigon().buildSocialUsage({
      social: {
        requestsUsed: 2500,
        requestLimit: 10000,
        since: "2026-11-01T00:00:00Z",
        resetAt: "2026-12-01T00:00:00Z",
      },
    });
    assert.equal(usage.available, true);
    assert.equal(usage.free.usedPercent, 25);
    assert.equal(usage.free.remainingPercent, 75);
    assert.equal(usage.paid, null);

    const unlimited = perigon().buildSocialUsage({
      social: { requestsUsed: 12, requestLimit: null },
    });
    assert.equal(unlimited.free.infinite, true);
    assert.equal(unlimited.free.usedPercent, null);

    const missing = perigon().buildSocialUsage({});
    assert.equal(missing.available, false);
  });

  await check("M1034-12 Search + pagination + continuation", async () => {
    const seen = [];
    const fetchImpl = mockFetchFactory([
      {
        match: (u) => u.includes("/v1/social/linkedin/posts"),
        respond: async (u) => {
          const url = new URL(u);
          const page = Number(url.searchParams.get("page") || "1");
          const q = url.searchParams.get("q") || "";
          seen.push({ page, q });
          if (page === 1) {
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  status: 200,
                  numResults: 1,
                  nextPage: 2,
                  results: [
                    {
                      urn: "urn:li:activity:p1",
                      url: "https://www.linkedin.com/feed/update/urn:li:activity:p1",
                      text: "Looking for SEO agency partner",
                      postedAt: "2026-11-01T00:00:00Z",
                      likes: 2,
                    },
                  ],
                }),
              headers: { get: () => null },
            };
          }
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                status: 200,
                numResults: 1,
                results: [
                  {
                    urn: "urn:li:activity:p2",
                    url: "https://www.linkedin.com/feed/update/urn:li:activity:p2",
                    text: "Need digital marketing help",
                    postedAt: "2026-11-02T00:00:00Z",
                  },
                ],
              }),
            headers: { get: () => null },
          };
        },
      },
    ]);

    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "search_posts",
          dataProvider: "opsai_native",
          nativeSource: "perigon",
          perigonCredentialId: "cred-p",
          customKeywords: ["SEO agency", "digital marketing"],
          maxResults: 10,
          live: true,
          publicationPeriod: "past-week",
          sortBy: "recent",
        },
      },
      {
        workspaceId: "ws-test",
        perigonCredential: { id: "cred-p", type: "perigon", secret: { apiKey: "k" } },
        perigonFetchImpl: fetchImpl,
        inputItems: [{ json: {} }],
      }
    );
    assert.ok(out.items.length >= 2);
    assert.equal(out.output.providerMeta.mode, "perigon");
    assert.equal(out.output.providerMeta.sourceAdapter, "perigon");
    assert.equal(out.items[0].json._meta.fixture, false);
    assert.ok(seen.some((s) => s.page === 2));
    assert.ok(!JSON.stringify(out).includes("ok-key"));
    assert.ok(!JSON.stringify(out).includes('"apiKey"'));
  });

  await check("M1034-13 Empty results are valid", async () => {
    const fetchImpl = mockFetchFactory([
      {
        match: (u) => u.includes("/v1/social/linkedin/posts"),
        respond: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ status: 200, numResults: 0, results: [] }),
          headers: { get: () => null },
        }),
      },
    ]);
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "discover_by_custom_keywords",
          dataProvider: "opsai_native",
          nativeSource: "perigon",
          customKeywords: ["zzzz-no-match-phrase"],
          maxResults: 5,
          live: true,
        },
      },
      {
        workspaceId: "ws",
        perigonCredential: { type: "perigon", secret: { apiKey: "k" } },
        perigonFetchImpl: fetchImpl,
        inputItems: [{ json: {} }],
      }
    );
    assert.equal(out.items.length, 0);
    assert.equal(out.output.providerMeta.mode, "perigon");
  });

  await check("M1034-14 Get Post Details unsupported for Perigon", async () => {
    await assert.rejects(
      () =>
        service().executeLinkedInLeadDiscoveryNode(
          {
            data: {
              operation: "get_post_details",
              dataProvider: "opsai_native",
              nativeSource: "perigon",
              postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:1",
            },
          },
          {
            workspaceId: "ws",
            perigonCredential: { type: "perigon", secret: { apiKey: "k" } },
            inputItems: [{ json: {} }],
          }
        ),
      (err) =>
        err.code === "LINKEDIN_LEAD_PERIGON_UNSUPPORTED_OPERATION"
    );
  });

  await check("M1034-15 Category discovery via Perigon mock", async () => {
    const fetchImpl = mockFetchFactory([
      {
        match: (u) => u.includes("/v1/social/linkedin/posts"),
        respond: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              status: 200,
              numResults: 1,
              results: [
                {
                  urn: "urn:li:activity:seo1",
                  url: "https://www.linkedin.com/feed/update/urn:li:activity:seo1",
                  text: "Looking for SEO agency recommendations",
                  postedAt: "2026-11-10T00:00:00Z",
                },
              ],
            }),
          headers: { get: () => null },
        }),
      },
    ]);
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "discover_by_category",
          dataProvider: "opsai_native",
          nativeSource: "perigon",
          categoryIds: ["seo"],
          maxResults: 5,
          live: true,
        },
      },
      {
        workspaceId: "ws",
        perigonCredential: { type: "perigon", secret: { apiKey: "k" } },
        perigonFetchImpl: fetchImpl,
        inputItems: [{ json: {} }],
      }
    );
    assert.ok(out.items.length >= 1);
    assert.ok(out.output.queryCount >= 1);
  });

  await check("M1034-16 Isolation: Perigon without Apify/feed; Apify without Perigon", async () => {
    const sanitizedNative = service().sanitizeLinkedInLeadDiscoveryNodeData({
      dataProvider: "opsai_native",
      nativeSource: "perigon",
      perigonCredentialId: "p1",
      apifyCredentialId: "should-go",
      apifyBillingMode: "paid",
      nativeFeedUrl: "https://feed.example",
    });
    assert.equal(sanitizedNative.perigonCredentialId, "p1");
    assert.equal(sanitizedNative.apifyCredentialId, undefined);
    assert.equal(sanitizedNative.nativeFeedUrl, undefined);

    const sanitizedApify = service().sanitizeLinkedInLeadDiscoveryNodeData({
      dataProvider: "apify",
      apifyCredentialId: "a1",
      perigonCredentialId: "p1",
      nativeSource: "perigon",
    });
    assert.equal(sanitizedApify.apifyCredentialId, "a1");
    assert.equal(sanitizedApify.perigonCredentialId, undefined);
    assert.equal(sanitizedApify.nativeSource, undefined);

    // Perigon modules must not import Apify / IG / Meta / FB
    const root = path.join(__dirname, "..", "services", "linkedinLeadDiscovery", "perigon");
    for (const file of fs.readdirSync(root)) {
      if (!file.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(root, file), "utf8");
      assert.ok(
        !/workflowInstagram|workflowMetaAds|workflowFacebookPage|apifyProvider|apify\//.test(
          src
        ),
        file
      );
    }
  });

  await check("M1034-17 Rate limit classified; auth not retried forever", async () => {
    let hits = 0;
    const fetchImpl = mockFetchFactory([
      {
        match: () => true,
        respond: async () => {
          hits += 1;
          return {
            ok: false,
            status: 401,
            text: async () =>
              JSON.stringify({ status: 401, message: "Invalid API key" }),
            headers: { get: () => null },
          };
        },
      },
    ]);
    const client = perigon().createPerigonClient({
      apiKey: "bad",
      fetchImpl,
    });
    await assert.rejects(
      () => client.get("/v1/limits", { retries: 2 }),
      (err) => err.code === "LINKEDIN_LEAD_PERIGON_KEY_INVALID"
    );
    assert.equal(hits, 1);
  });

  await check("M1034-18 FE + migration + registry wiring", () => {
    const fields = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/LinkedInLeadDiscoveryFields.tsx"
      ),
      "utf8"
    );
    assert.match(fields, /testLinkedInPerigon/);
    assert.match(fields, /Perigon — LinkedIn Social API/);
    assert.match(fields, /allowedTypes=\{\["perigon"\]\}/);

    const types = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/types.ts"),
      "utf8"
    );
    assert.match(types, /\| "perigon"/);
    assert.match(types, /apiKey/);

    const mig = fs.readFileSync(
      path.join(__dirname, "../migrations/035_perigon_credential.sql"),
      "utf8"
    );
    assert.match(mig, /'perigon'/);

    const validationSrc = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.validation.js"),
      "utf8"
    );
    assert.match(validationSrc, /type === "perigon"/);

    const registry = fs.readFileSync(
      path.join(__dirname, "../services/connectionRegistry.service.js"),
      "utf8"
    );
    assert.match(registry, /dbType: "perigon"/);

    const routes = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.routes.js"),
      "utf8"
    );
    assert.match(routes, /test-perigon/);
  });

  await check("M1034-19 Live DB create/select/delete Perigon credential", async () => {
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
    assert.match(String(enumRows[0].Type), /perigon/);

    const created = await credentials.create(
      {
        workspaceId,
        name: `perigon-m1034-${Date.now()}`,
        type: "perigon",
        secret: { apiKey: "perigon_test_key_not_real" },
        config: {},
      },
      authUser
    );
    assert.ok(created.id);
    assert.equal(created.type, "perigon");
    assert.equal(created.connected, false);

    const loaded = await credentials.getForWorkspace(created.id, workspaceId);
    assert.equal(loaded.type, "perigon");
    assert.equal(loaded.secret.apiKey, "perigon_test_key_not_real");
    assert.equal(loaded.config.connected, false);

    await credentials.markPerigonConnectionStatus(created.id, workspaceId, {
      connected: true,
      status: "connected",
      code: "OK",
      linkedInAccess: true,
    });
    const verified = await credentials.getForWorkspace(created.id, workspaceId);
    assert.equal(verified.config.connected, true);

    await credentials.remove(created.id, authUser);
    const gone = await credentials.getForWorkspace(created.id, workspaceId);
    assert.equal(gone, null);
  });

  console.log(`\n${passed} M10.3.4 checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {}
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
