/**
 * M8.18.2 — Meta Ads data-path: appsecret_proof + insights breakdown fields.
 * Mocked Graph for unit proofs; live counts belong to diagnose-meta-ads-m8182.js.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LONG = "EAATestLongLivedTokenValue";
const APP_SECRET = "meta-app-secret-test";
const CRED_ID = "cred-meta-m8182";
const ACCOUNT = "2048781345838236";

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

(async () => {
  console.log("\nM8.18.2 Meta Ads data-path");

  const ads = () => require("../services/workflowMetaAds.service");
  const catalog = () => require("../services/metaAdsReportCatalog");
  const read = (rel) =>
    fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

  await check("M8182-1 appsecret_proof HMAC is untied (no appsecret_time)", async () => {
    await withApp(async () => {
      const proof = ads().appSecretProof(LONG, Date.parse("2030-01-01T00:00:00Z"));
      const expected = crypto.createHmac("sha256", APP_SECRET).update(LONG).digest("hex");
      assert.equal(proof.appsecret_proof, expected);
      assert.equal(proof.appsecret_time, undefined);
    });
  });

  await check("M8182-2 Graph request omits appsecret_time", async () => {
    await withApp(async () => {
      let seen = null;
      await ads().withMetaTestHooks(
        {
          transport: async (url) => {
            const u = new URL(url);
            seen = {
              hasProof: Boolean(u.searchParams.get("appsecret_proof")),
              hasTime: u.searchParams.has("appsecret_time"),
            };
            return { ok: true, status: 200, body: { id: "1" } };
          },
        },
        async () => {
          await ads().metaGraphRequest({
            accessToken: LONG,
            path: "me",
            query: { fields: "id" },
          });
        }
      );
      assert.equal(seen.hasProof, true);
      assert.equal(seen.hasTime, false);
    });
  });

  await check("M8182-3 insights query keeps publisher_platform out of fields", () => {
    const query = catalog().buildInsightsQuery({
      reportType: "account_performance",
      since: "2026-09-01",
      until: "2026-09-30",
      filters: {},
      pageSize: 25,
      breakdowns: ["publisher_platform"],
      extraFields: ["publisher_platform"],
    });
    assert.equal(query.breakdowns, "publisher_platform");
    assert.equal(query.fields.includes("publisher_platform"), false);
  });

  await check("M8182-4 entity list ignores platformScope for Graph filtering", () => {
    const src = read("services/workflowMetaAds.service.js");
    const entityFn = src.slice(
      src.indexOf("const executeEntityListGet"),
      src.indexOf("const executeDelivery")
    );
    assert.equal(entityFn.includes("publisher_platform"), false);
    assert.equal(entityFn.includes("filterRowsByPublisherPlatform"), false);
  });

  await check("M8182-5 empty optional filters produce no filtering", async () => {
    await withApp(async () => {
      let filtering = "MISSING";
      await ads().withMetaTestHooks(
        {
          loadCredential: async () => ({
            id: CRED_ID,
            type: "meta_ads",
            workspaceId: "ws-1",
            secret: { accessToken: LONG, expiresAt: "2030-01-01T00:00:00.000Z" },
            config: {},
          }),
          transport: async (url) => {
            const u = new URL(url);
            if (u.pathname.endsWith(`/act_${ACCOUNT}/campaigns`)) {
              filtering = u.searchParams.get("filtering");
              return {
                ok: true,
                status: 200,
                body: {
                  data: [
                    {
                      id: "1",
                      name: "C1",
                      objective: "OUTCOME_LEADS",
                      status: "ACTIVE",
                      effective_status: "ACTIVE",
                    },
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
                platformScope: "instagram",
                resource: "campaign",
                operation: "list",
                effectiveStatus: "",
                objective: "",
                campaignId: "",
                limit: 25,
              },
            },
            { workspaceId: "ws-1", inputItems: [{ json: {} }] }
          );
          assert.equal(result.items.length, 1);
          assert.equal(result.output.platformScope, "instagram");
          assert.equal(filtering, null);
        }
      );
    });
  });

  await check("M8182-6 normalize keeps publisher_platform from breakdowns provenance", () => {
    const row = ads().normalizeInsightsRow(
      {
        account_id: ACCOUNT,
        spend: "10",
        impressions: "100",
        clicks: "5",
        publisher_platform: "facebook",
        date_start: "2026-09-01",
        date_stop: "2026-09-01",
      },
      {
        fieldReportType: "account_performance",
        reportType: "account_performance",
        level: "account",
        adAccountId: ACCOUNT,
        since: "2026-09-01",
        until: "2026-09-01",
        timezone: "UTC",
        breakdowns: ["publisher_platform"],
      }
    );
    assert.equal(row.publisher_platform, "facebook");
  });

  console.log(`\nM8.18.2 done: ${passed} checks`);
})();
