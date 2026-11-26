/**
 * M10.3.9 — Apify Actor input compatibility (no LinkedIn cookies).
 * Fetches live public Actor OpenAPI (no paid runs).
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
  console.log("\nM10.3.9 Apify Actor input compatibility");

  const {
    ACTOR_ID,
    ACTOR_USERNAME_NAME,
    ACTOR_URL,
    ACTOR_PRICING,
    LEGACY_COOKIE_ACTOR,
  } = require("../services/linkedinLeadDiscovery/apify/constants");
  const {
    buildActorInput,
    validateActorInput,
  } = require("../services/linkedinLeadDiscovery/apify/inputMapper");
  const { mapApifyItems } = require("../services/linkedinLeadDiscovery/apify/mapResults");
  const { getProviderDescriptor } = require("../services/linkedinLeadDiscovery/providerInterface");

  await check("M1039-1 Active Actor is scrapeforge no-cookie", () => {
    assert.equal(ACTOR_ID, "kTfhD8wSCMRXlhNmE");
    assert.equal(ACTOR_USERNAME_NAME, "scrapeforge~linkedin-all-in-one");
    assert.match(ACTOR_URL, /scrapeforge\/linkedin-all-in-one/);
    assert.equal(LEGACY_COOKIE_ACTOR.id, "kfiWbq3boy3dWKbiL");
    const desc = getProviderDescriptor("apify");
    assert.equal(desc.actorId, ACTOR_ID);
  });

  await check("M1039-2 Live OpenAPI: legacy Actor requires cookie", async () => {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${LEGACY_COOKIE_ACTOR.id}`
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const buildId = body.data?.taggedBuilds?.latest?.buildId;
    assert.ok(buildId);
    const openapiRes = await fetch(
      `https://api.apify.com/v2/acts/${LEGACY_COOKIE_ACTOR.id}/builds/${buildId}/openapi.json`
    );
    assert.equal(openapiRes.status, 200);
    const openapi = await openapiRes.json();
    const required = openapi.components?.schemas?.inputSchema?.required || [];
    console.log(`       legacy required=${JSON.stringify(required)}`);
    assert.ok(required.includes("cookie"));
    assert.ok(required.includes("userAgent"));
    assert.ok(required.includes("urls"));
    assert.ok(required.includes("proxy"));
  });

  await check("M1039-3 Live OpenAPI: current Actor has no cookie field", async () => {
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data?.id, ACTOR_ID);
    const buildId = body.data?.taggedBuilds?.latest?.buildId;
    assert.ok(buildId);
    const openapiRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/builds/${buildId}/openapi.json`
    );
    assert.equal(openapiRes.status, 200);
    const openapi = await openapiRes.json();
    const schema = openapi.components?.schemas?.inputSchema || {};
    const required = schema.required || [];
    const props = Object.keys(schema.properties || {});
    console.log(`       current required=${JSON.stringify(required)}`);
    console.log(`       current props=${props.join(",")}`);
    assert.ok(required.includes("mode"));
    assert.ok(!required.includes("cookie"));
    assert.ok(!props.includes("cookie"));
    assert.ok(props.includes("search"));
    assert.ok(props.includes("postUrls"));
    assert.ok(props.includes("postedLimit"));
    assert.ok(props.includes("maxPosts"));
    // PAY_PER_EVENT entitlement compatible with Free allowance metering
    const pricing = body.data?.pricingInfos?.slice(-1)?.[0];
    assert.equal(pricing?.pricingModel, "PAY_PER_EVENT");
  });

  await check("M1039-4 Mapper emits valid post-search input (no cookie)", () => {
    const mapped = buildActorInput({
      queries: ["Looking for SEO agency", "Need marketing help"],
      publicationPeriod: "past-week",
      sortBy: "recent",
      maxResults: 25,
    });
    assert.equal(mapped.input.mode, "post-search");
    assert.match(mapped.input.search, /Looking for SEO agency/);
    assert.match(mapped.input.search, /OR/);
    assert.equal(mapped.input.postedLimit, "week");
    assert.equal(mapped.input.sortBy, "date");
    assert.equal(mapped.input.maxPosts, 25);
    assert.equal(mapped.input.cookie, undefined);
    assert.equal(mapped.input.userAgent, undefined);
    validateActorInput(mapped.input);
  });

  await check("M1039-5 Mapper emits valid post-detail input", () => {
    const mapped = buildActorInput({
      operation: "get_post_details",
      postUrl:
        "https://www.linkedin.com/posts/example_activity-1234567890-abcd",
    });
    assert.equal(mapped.input.mode, "post-detail");
    assert.equal(mapped.input.postUrls.length, 1);
    validateActorInput(mapped.input, { operation: "get_post_details" });
  });

  await check("M1039-6 Missing search / cookie rejected locally", () => {
    assert.throws(
      () => buildActorInput({ queries: [], maxResults: 10 }),
      (err) => err.code === "LINKEDIN_LEAD_APIFY_INPUT_INVALID"
    );
    assert.throws(
      () =>
        validateActorInput({
          mode: "post-search",
          search: "ok",
          cookie: [{ name: "li_at", value: "x" }],
        }),
      (err) =>
        err.code === "LINKEDIN_LEAD_APIFY_INPUT_INVALID" &&
        /cookie/i.test(err.message) &&
        err.statusCode === 400
    );
  });

  await check("M1039-7 Normalize scrapeforge + legacy dataset shapes", () => {
    const rows = mapApifyItems([
      {
        source: "post-search",
        postId: "urn:li:activity:sf1",
        url: "https://www.linkedin.com/posts/a",
        content: "Need an SEO agency this quarter",
        postedAt: "2026-11-20T12:00:00.000Z",
        author: { name: "SF Author", url: "https://www.linkedin.com/in/sf" },
        engagement: { likes: 3, comments: 1, shares: 0 },
      },
      {
        source: "post-reactions",
        reactionId: "r1",
        author: { name: "Reactor" },
      },
      {
        urn: "urn:li:activity:legacy",
        text: "Legacy shape still maps",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:legacy",
        authorFullName: "Legacy Author",
        likeCount: 2,
      },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sourcePostId, "urn:li:activity:sf1");
    assert.equal(rows[0].author.name, "SF Author");
    assert.equal(rows[0].engagement.likes, 3);
    assert.equal(rows[1].sourcePostId, "urn:li:activity:legacy");
  });

  await check("M1039-8 Pricing constants match PPE post events", () => {
    assert.equal(ACTOR_PRICING.model, "PAY_PER_EVENT");
    assert.ok(ACTOR_PRICING.events.datasetItemUsd > 0);
    assert.ok(ACTOR_PRICING.events.actorStartUsd >= 0);
  });

  await check("M1039-9 FE + isolation wiring", () => {
    const fe = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/LinkedInLeadDiscoveryFields.tsx"
      ),
      "utf8"
    );
    assert.match(fe, /scrapeforge\/linkedin-all-in-one/);
    assert.match(fe, /no LinkedIn session cookies/);
    assert.doesNotMatch(fe, /curious_coder\/linkedin-post-search-scraper/);

    const runner = fs.readFileSync(
      path.join(
        __dirname,
        "../services/linkedinLeadDiscovery/apify/runner.js"
      ),
      "utf8"
    );
    assert.match(runner, /validateActorInput/);
  });

  await check("M1039-10 Keyword library unchanged 10/140/15", () => {
    const lib = require("../services/linkedinLeadDiscovery/keywordLibrary");
    assert.equal(lib.SERVICE_CATEGORIES.length, 10);
    assert.equal(lib.ORIGINAL_KEYWORD_COUNT, 140);
    assert.equal(lib.INTENT_VARIATIONS.length, 15);
  });

  console.log(`\nM10.3.9 checks passed: ${passed}`);
  console.log(process.exitCode ? "M10.3.9 FAIL" : "M10.3.9 PASS");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
