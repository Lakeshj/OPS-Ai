/**
 * M9.1 — Facebook Page Native (organic).
 * Mocked Graph transport only. No live Meta calls.
 * Isolation from Instagram / Meta Ads business services.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PAGE_TOKEN = "EAAPageAccessTokenValue";
const USER_TOKEN = "EAAUserLongLivedTokenValue";
const APP_SECRET = "facebook-page-app-secret-test";
const CRED_ID = "cred-fb-page-m91";
const PAGE_ID = "111222333";
const POST_ID = "111222333_987654";
const NOW = Date.parse("2026-11-24T12:00:00Z");

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
  const keys = [
    "FACEBOOK_PAGE_APP_ID",
    "FACEBOOK_PAGE_APP_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
  ];
  const snap = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.FACEBOOK_PAGE_APP_ID = "fb-page-app-id";
  process.env.FACEBOOK_PAGE_APP_SECRET = APP_SECRET;
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
  delete process.env.INSTAGRAM_APP_ID;
  delete process.env.INSTAGRAM_APP_SECRET;
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (snap[k] == null) delete process.env[k];
      else process.env[k] = snap[k];
    }
  }
};

const cred = () => ({
  id: CRED_ID,
  type: "facebook_page",
  workspaceId: "ws-1",
  name: "Facebook Page",
  secret: {
    accessToken: USER_TOKEN,
    pages: {
      [PAGE_ID]: {
        accessToken: PAGE_TOKEN,
        tasks: ["MANAGE", "CREATE_CONTENT", "MODERATE", "ANALYZE"],
        name: "SocialChamps",
      },
    },
  },
  config: {
    selectedPageId: PAGE_ID,
    pages: [{ pageId: PAGE_ID, pageName: "SocialChamps", category: "Business" }],
  },
});

const mockTransport = (handlers) => async (url, options = {}) => {
  const u = String(url);
  for (const [match, reply] of handlers) {
    const matched =
      typeof match === "function"
        ? match(u, options)
        : typeof match === "string"
          ? u.includes(match)
          : match.test(u);
    if (!matched) continue;
    const body = typeof reply === "function" ? reply(u, options) : reply;
    return { ok: true, status: 200, body };
  }
  throw new Error(`Unexpected Graph URL in smoke: ${u}`);
};

(async () => {
  console.log("\nM9.1 Facebook Page Native");

  const root = path.join(__dirname, "..", "..");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const fb = () => require("../services/workflowFacebookPage.service");
  const catalog = () => require("../services/facebookPageInsightsCatalog");
  const graph = () => require("../config/facebookPageGraph");

  await check("M91-1 Isolation: FB Page does not import IG / Meta Ads services", () => {
    const svc = read("backend/services/workflowFacebookPage.service.js");
    const oauth = read("backend/services/facebookPageOAuth.service.js");
    const cfg = read("backend/config/facebookPageGraph.js");
    assert.ok(!/require\(["'].*workflowInstagram/.test(svc));
    assert.ok(!/require\(["'].*workflowMetaAds/.test(svc));
    assert.ok(!/require\(["'].*instagramOAuth/.test(oauth));
    assert.ok(!/require\(["'].*metaOAuth\.service/.test(oauth));
    assert.ok(!/require\(["'].*workflowInstagram/.test(oauth));
    assert.ok(!/require\(["'].*workflowMetaAds/.test(oauth));
    // Provider utility metaGraph is allowed; Meta Ads business is not.
    assert.match(cfg, /require\(["']\.\/metaGraph["']\)/);
    assert.ok(!/require\(["'].*workflowMetaAds/.test(cfg));
  });

  await check("M91-2 Credential type facebook_page is dedicated", () => {
    const mig = read("backend/migrations/033_facebook_page_credential.sql");
    assert.match(mig, /facebook_page/);
    assert.match(mig, /instagram/);
    assert.match(mig, /meta_ads/);
    const creds = read("backend/modules/workflows/credentials.service.js");
    assert.match(creds, /FACEBOOK_PAGE_CREDENTIAL_TYPES/);
    assert.match(creds, /facebook_page/);
  });

  await check("M91-3 Scopes are Page-derived (not Instagram copy)", () => {
    const { OAUTH_SCOPES } = graph();
    assert.deepEqual([...OAUTH_SCOPES], [
      "pages_show_list",
      "pages_read_engagement",
      "read_insights",
      "pages_manage_posts",
    ]);
    assert.ok(!OAUTH_SCOPES.includes("instagram_basic"));
    assert.ok(!OAUTH_SCOPES.includes("ads_read"));
  });

  await check("M91-4 Insights catalog is curated", () => {
    const c = catalog();
    assert.ok(c.PAGE_REPORTS.page_overview);
    assert.ok(c.POST_REPORTS.post_overview);
    assert.throws(
      () =>
        c.resolvePageInsightsRequest({
          reportType: "custom",
          metrics: "made_up_metric",
        }),
      /Unsupported Facebook Page metric/
    );
  });

  await withApp(async () => {
    await check("M91-5 Page → Get", async () => {
      const out = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [
              `/${PAGE_ID}?`,
              {
                id: PAGE_ID,
                name: "SocialChamps",
                username: "socialchamps",
                category: "Business",
                fan_count: 1200,
                followers_count: 1250,
                link: "https://facebook.com/socialchamps",
                picture: { data: { url: "https://example.com/pic.jpg" } },
              },
            ],
          ]),
          now: () => NOW,
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "page",
                operation: "get",
                pageId: PAGE_ID,
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(out.items.length, 1);
      assert.equal(out.items[0].json.name, "SocialChamps");
      assert.equal(out.items[0].json._meta.provider, "facebook_page");
      assert.equal(out.items[0].json._meta.resource, "page");
      assert.ok(!JSON.stringify(out).includes(PAGE_TOKEN));
    });

    await check("M91-6 Post → List bounded pagination", async () => {
      const out = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [
              /published_posts/,
              {
                data: [
                  {
                    id: POST_ID,
                    message: "Hello Page",
                    created_time: "2026-11-20T10:00:00+0000",
                    permalink_url: "https://facebook.com/p/1",
                    reactions: { summary: { total_count: 5 } },
                    comments: { summary: { total_count: 2 } },
                    shares: { count: 1 },
                  },
                ],
                paging: { cursors: { after: "CURSOR_A" } },
              },
            ],
          ]),
          now: () => NOW,
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "post",
                operation: "list",
                pageId: PAGE_ID,
                returnAll: false,
                limit: 25,
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(out.items.length, 1);
      assert.equal(out.items[0].json.postId, POST_ID);
      assert.equal(out.items[0].json._meta.provider, "facebook_page");
      assert.equal(out.output?.paging?.hasMore, true);
      assert.equal(out.output?.paging?.after, "CURSOR_A");
    });

    await check("M91-7 Post → Get + Comments → List", async () => {
      const getPost = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [
              `/${POST_ID}?`,
              {
                id: POST_ID,
                message: "Detailed post",
                created_time: "2026-11-20T10:00:00+0000",
                permalink_url: "https://facebook.com/p/1",
              },
            ],
          ]),
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "post",
                operation: "get",
                pageId: PAGE_ID,
                postId: POST_ID,
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(getPost.items[0].json.message, "Detailed post");

      const comments = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [
              /\/comments/,
              {
                data: [
                  {
                    id: "c1",
                    message: "Nice",
                    created_time: "2026-11-21T00:00:00+0000",
                    from: { id: "u1", name: "Alex" },
                    like_count: 3,
                  },
                ],
              },
            ],
          ]),
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "comments",
                operation: "list",
                pageId: PAGE_ID,
                postId: POST_ID,
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(comments.items[0].json.fromName, "Alex");
      assert.equal(comments.items[0].json._meta.resource, "comments");
    });

    await check("M91-8 Page + Post Insights", async () => {
      const pageInsights = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [
              /\/insights/,
              {
                data: [
                  {
                    name: "page_impressions_unique",
                    period: "day",
                    values: [{ value: 100 }],
                  },
                  {
                    name: "page_post_engagements",
                    period: "day",
                    values: [{ value: 12 }],
                  },
                ],
              },
            ],
          ]),
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "insights",
                operation: "page",
                pageId: PAGE_ID,
                reportType: "page_overview",
                period: "day",
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(pageInsights.items[0].json.insightsLevel, "page");
      assert.ok(Array.isArray(pageInsights.items[0].json.metrics));

      const postInsights = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [
              /\/insights/,
              {
                data: [
                  {
                    name: "post_impressions",
                    period: "lifetime",
                    values: [{ value: 50 }],
                  },
                ],
              },
            ],
          ]),
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "insights",
                operation: "post",
                pageId: PAGE_ID,
                postId: POST_ID,
                reportType: "post_overview",
                period: "day", // ignored → lifetime catalog default
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(postInsights.items[0].json.insightsLevel, "post");
      assert.equal(postInsights.items[0].json.period, "lifetime");
    });

    await check("M91-9 Publish text + link", async () => {
      const text = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [`/${PAGE_ID}/feed`, { id: `${PAGE_ID}_new1` }],
          ]),
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "publish",
                operation: "create_text_post",
                pageId: PAGE_ID,
                message: "Hello from OpsAi",
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(text.items[0].json.postId, `${PAGE_ID}_new1`);
      assert.equal(text.items[0].json._meta.operation, "create_text_post");

      const link = await fb().withFacebookPageTestHooks(
        {
          loadCredential: async () => cred(),
          transport: mockTransport([
            [`/${PAGE_ID}/feed`, { id: `${PAGE_ID}_new2` }],
          ]),
        },
        () =>
          fb().executeFacebookPageNode(
            {
              data: {
                credentialId: CRED_ID,
                resource: "publish",
                operation: "create_link_post",
                pageId: PAGE_ID,
                message: "Check this",
                link: "https://example.com",
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          )
      );
      assert.equal(link.items[0].json._meta.operation, "create_link_post");
    });

    await check("M91-10 Wrong credential type rejected", async () => {
      await assert.rejects(
        () =>
          fb().withFacebookPageTestHooks(
            {
              loadCredential: async () => ({
                ...cred(),
                type: "instagram",
              }),
            },
            () =>
              fb().executeFacebookPageNode(
                {
                  data: {
                    credentialId: CRED_ID,
                    resource: "page",
                    operation: "get",
                  },
                },
                { workspaceId: "ws-1", inputItems: [{ json: {} }] }
              )
          ),
        /Facebook Page credential/
      );
    });
  });

  await check("M91-11 Frontend node + presentation wiring present", () => {
    const types = read("frontend/src/modules/workflows/types.ts");
    const schema = read("frontend/src/modules/workflows/nodeParameterSchemas.ts");
    const library = read("frontend/src/modules/workflows/nodeLibrary.json");
    const presentation = read(
      "frontend/src/modules/workflows/facebookPageOutputPresentation.ts"
    );
    assert.match(types, /facebookPage/);
    assert.match(types, /facebook_page/);
    assert.match(schema, /facebookPage:\s*\[/);
    assert.match(library, /"engineType": "facebookPage"/);
    assert.match(presentation, /facebook_page/);
  });

  await check("M91-12 No Facebook MCP in this milestone", () => {
    const library = read("frontend/src/modules/workflows/nodeLibrary.json");
    assert.ok(!/facebookPageMcp|facebook-page-mcp/i.test(library));
    const nodes = read("backend/services/workflowNodes.service.js");
    assert.ok(!/facebookPageMcp/.test(nodes));
  });

  console.log(`\n${passed} M9.1 Facebook Page checks passed`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
