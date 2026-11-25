/**
 * M10.3.3 — Native feed DNS fix + API compatibility detection.
 */
const assert = require("node:assert/strict");

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
  console.log("\nM10.3.3 Native feed DNS + API compatibility");

  const httpSec = () => require("../services/workflowHttpSecurity.service");
  const feed = () =>
    require("../services/linkedinLeadDiscovery/nativeCollection/feedConnection");

  await check("M1033-1 dns module is imported (no 'dns is not defined')", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(
        __dirname,
        "../services/workflowHttpSecurity.service.js"
      ),
      "utf8"
    );
    assert.match(src, /require\(["']node:dns\/promises["']\)/);
  });

  await check("M1033-2 Public hostname DNS resolves (api.perigon.io)", async () => {
    const u = await httpSec().assertSafeHttpUrl(
      "https://api.perigon.io/v1/social/linkedin/posts"
    );
    assert.equal(u.hostname, "api.perigon.io");
  });

  await check("M1033-3 Private IP still blocked", async () => {
    await assert.rejects(
      () => httpSec().assertSafeHttpUrl("http://127.0.0.1/"),
      (err) => err.code === "HTTP_DESTINATION_BLOCKED"
    );
  });

  await check("M1033-4 Perigon URL → unsupported_api (no blind /search)", async () => {
    const res = await feed().testFeedConnection({
      feedUrl: "https://api.perigon.io/v1/social/linkedin/posts",
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, "unsupported_api");
    assert.equal(res.code, "LINKEDIN_LEAD_NATIVE_FEED_UNSUPPORTED_API");
    assert.match(String(res.message), /Perigon|dedicated adapter/i);
  });

  await check("M1033-5 validateAndNormalizeFeedUrl rejects Perigon", async () => {
    await assert.rejects(
      () =>
        feed().validateAndNormalizeFeedUrl(
          "https://api.perigon.io/v1/social/linkedin/posts"
        ),
      (err) => err.code === "LINKEDIN_LEAD_NATIVE_FEED_UNSUPPORTED_API"
    );
  });

  await check("M1033-6 LinkedIn webpage still rejected", async () => {
    const res = await feed().testFeedConnection({
      feedUrl:
        "https://www.linkedin.com/posts/example_activity-123-abc",
    });
    assert.equal(res.status, "unsupported_api");
    assert.equal(res.code, "LINKEDIN_LEAD_NATIVE_FEED_URL_IS_LINKEDIN_PAGE");
  });

  await check("M1033-7 Empty URL → not_configured", async () => {
    const res = await feed().testFeedConnection({ feedUrl: "" });
    assert.equal(res.status, "not_configured");
  });

  console.log(`\n${passed} M10.3.3 checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {}
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
