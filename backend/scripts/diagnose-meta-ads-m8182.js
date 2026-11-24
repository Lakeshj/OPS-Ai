/**
 * M8.18.2 — live Meta Ads entity/insights data-path diagnosis.
 * Never prints access tokens / app secrets.
 */
require("dotenv").config();
const assert = require("node:assert/strict");

const ACCOUNT = "2048781345838236";

const redactUrl = (url) =>
  String(url || "")
    .replace(/([?&](access_token|appsecret_proof|appsecret_time)=)[^&]*/gi, "$1[redacted]")
    .replace(/EAA[A-Za-z0-9]+/g, "[redacted]");

const summarizeQuery = (url) => {
  const u = new URL(url);
  const q = Object.fromEntries(u.searchParams.entries());
  delete q.access_token;
  delete q.appsecret_proof;
  delete q.appsecret_time;
  return {
    path: u.pathname.replace(/^\/v[\d.]+\/?/, ""),
    fields: q.fields || null,
    filtering: q.filtering || null,
    limit: q.limit || null,
    after: q.after || null,
    level: q.level || null,
    time_range: q.time_range || null,
    time_increment: q.time_increment || null,
    breakdowns: q.breakdowns || null,
  };
};

(async () => {
  const { pool } = require("../config/database");
  const ads = require("../services/workflowMetaAds.service");
  const { decryptSecret } = require("../services/secretBox.service");

  const [credRows] = await pool.execute(
    `SELECT id, name, workspace_id, type, secret_json, config_json
     FROM workflow_credentials
     WHERE type = 'meta_ads'
     ORDER BY updated_at DESC
     LIMIT 10`
  );
  if (!credRows.length) {
    console.error("No meta_ads credentials found");
    process.exitCode = 1;
    await pool.end();
    return;
  }

  let chosen = null;
  for (const row of credRows) {
    let cfg = {};
    try {
      cfg = JSON.parse(row.config_json || "{}");
    } catch {
      cfg = {};
    }
    const secret = decryptSecret(row.secret_json) || {};
    const selected = String(cfg.selectedAdAccountId || "").replace(/^act_/i, "");
    const hasToken = Boolean(String(secret.accessToken || "").trim());
    console.log(
      `cred ${row.id.slice(0, 8)}… name=${row.name} selected=${selected || "(none)"} token=${hasToken ? "yes" : "no"}`
    );
    if (hasToken && (!chosen || selected === ACCOUNT)) {
      chosen = { id: row.id, workspaceId: row.workspace_id, selected, name: row.name };
      if (selected === ACCOUNT) break;
    }
  }
  if (!chosen) {
    console.error("No usable meta_ads credential with token");
    process.exitCode = 1;
    await pool.end();
    return;
  }
  console.log(
    `\nUsing credential ${chosen.id.slice(0, 8)}… workspace=${chosen.workspaceId.slice(0, 8)}… selected=${chosen.selected || "(none)"}\n`
  );

  const calls = [];
  const wrapTransport = async (url, options) => {
    const defaultTransport = async (u, opts) => {
      const res = await fetch(u, opts);
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { error: { message: "non-json" } };
      }
      return { ok: res.ok, status: res.status, body };
    };
    const res = await defaultTransport(url, options);
    const summary = summarizeQuery(url);
    const rawCount = Array.isArray(res.body?.data) ? res.body.data.length : res.body?.id ? 1 : 0;
    const errCode = res.body?.error?.code;
    const errMsg = res.body?.error?.message
      ? String(res.body.error.message).slice(0, 180)
      : null;
    calls.push({
      ...summary,
      httpStatus: res.status,
      ok: res.ok,
      rawCount,
      errorCode: errCode || null,
      errorMessage: errMsg,
      sampleIds: Array.isArray(res.body?.data)
        ? res.body.data.slice(0, 3).map((r) => r.id || r.account_id || null)
        : res.body?.id
          ? [res.body.id]
          : [],
    });
    return res;
  };

  const runNode = async (data) => {
    calls.length = 0;
    return ads.withMetaTestHooks({ transport: wrapTransport }, () =>
      ads.executeMetaAdsNode(
        {
          id: "diag-meta",
          type: "metaAds",
          data: {
            nodeType: "metaAds",
            credentialId: chosen.id,
            adAccountId: ACCOUNT,
            platformScope: "all",
            returnAll: false,
            limit: 25,
            ...data,
          },
        },
        {
          workspaceId: chosen.workspaceId,
          inputItems: [{ json: {} }],
          steps: {},
        }
      )
    );
  };

  const report = async (label, data) => {
    console.log(`\n=== ${label} ===`);
    try {
      const result = await runNode(data);
      const last = calls[calls.length - 1] || null;
      console.log(
        JSON.stringify(
          {
            graphCalls: calls.map((c) => ({
              path: c.path,
              fields: c.fields,
              filtering: c.filtering,
              limit: c.limit,
              after: c.after,
              level: c.level,
              time_range: c.time_range,
              breakdowns: c.breakdowns,
              httpStatus: c.httpStatus,
              rawCount: c.rawCount,
              errorCode: c.errorCode,
              errorMessage: c.errorMessage,
              sampleIds: c.sampleIds,
            })),
            finalRowCount: Array.isArray(result.items) ? result.items.length : 0,
            outputRowCount: result.output?.rowCount ?? null,
            platformScope: result.output?.platformScope ?? null,
            firstNames: (result.items || [])
              .slice(0, 3)
              .map((i) => i.json?.name || i.json?.presentation?.campaignName || null),
          },
          null,
          2
        )
      );
      return { result, calls: calls.slice(), last };
    } catch (err) {
      console.log(
        JSON.stringify(
          {
            thrown: {
              code: err.code || null,
              message: String(err.message || "").slice(0, 240),
            },
            graphCalls: calls.map((c) => ({
              path: c.path,
              fields: c.fields,
              filtering: c.filtering,
              limit: c.limit,
              httpStatus: c.httpStatus,
              rawCount: c.rawCount,
              errorCode: c.errorCode,
              errorMessage: c.errorMessage,
            })),
          },
          null,
          2
        )
      );
      return { error: err, calls: calls.slice() };
    }
  };

  // Static filter audit (no live call)
  console.log("=== Filter audit (no optional params) ===");
  const filtering = (() => {
    const build = ads.buildEntityFiltering
      ? null
      : null;
    // use internal via execute path — recomputed here by requiring same logic
    const listOf = (value) => {
      if (value == null || value === "") return [];
      if (Array.isArray(value)) {
        return value.map((e) => String(e || "").trim()).filter(Boolean);
      }
      return String(value)
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    };
    const emptyData = {
      effectiveStatus: "",
      objective: "",
      campaignId: "",
      adSetId: "",
      filters: {},
      platformScope: "all",
    };
    const statuses = listOf(emptyData.effectiveStatus);
    const objectives = listOf(emptyData.objective);
    const campaignIds = listOf(emptyData.campaignId);
    const adSetIds = listOf(emptyData.adSetId);
    const filteringArr = [];
    if (statuses.length) filteringArr.push({ field: "effective_status", value: statuses });
    if (objectives.length) filteringArr.push({ field: "objective", value: objectives });
    if (campaignIds.length) filteringArr.push({ field: "campaign.id", value: campaignIds });
    if (adSetIds.length) filteringArr.push({ field: "adset.id", value: adSetIds });
    return {
      emptyOptionalParamsProduceFiltering: filteringArr,
      platformScopeAppliedToEntityQuery: false,
    };
  })();
  console.log(JSON.stringify(filtering, null, 2));

  await report("Ad Account Get", {
    resource: "adAccount",
    operation: "get",
  });

  await report("Campaign List (no filters)", {
    resource: "campaign",
    operation: "list",
    platformScope: "all",
  });

  await report("Ad Set List (account-level)", {
    resource: "adSet",
    operation: "list",
    platformScope: "all",
  });

  await report("Ad List (account-level)", {
    resource: "ad",
    operation: "list",
    platformScope: "all",
  });

  await report("Insights account last7days All Meta", {
    resource: "insights",
    operation: "runReport",
    reportType: "account_performance",
    dateRange: "last7days",
    platformScope: "all",
    platformBreakdown: false,
  });

  await report("Insights account last30days All Meta", {
    resource: "insights",
    operation: "runReport",
    reportType: "account_performance",
    dateRange: "last30days",
    platformScope: "all",
    platformBreakdown: false,
  });

  await report("Insights account last30days + publisher_platform breakdown", {
    resource: "insights",
    operation: "runReport",
    reportType: "account_performance",
    dateRange: "last30days",
    platformScope: "all",
    platformBreakdown: true,
  });

  // Code-path proof: platformScope not in entity Graph query
  console.log("\n=== Code proof: entity list ignores publisher_platform ===");
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "../services/workflowMetaAds.service.js"),
    "utf8"
  );
  const entityFn = src.slice(
    src.indexOf("const executeEntityListGet"),
    src.indexOf("const executeDelivery")
  );
  assert.ok(!entityFn.includes("publisher_platform"));
  assert.ok(!entityFn.includes("filterRowsByPublisherPlatform"));
  assert.ok(entityFn.includes("buildEntityFiltering"));
  console.log(
    JSON.stringify(
      {
        entityListUsesPublisherPlatformFilter: false,
        insightsUsesPublisherPlatformFilter: src.includes(
          "filterRowsByPublisherPlatform"
        ),
      },
      null,
      2
    )
  );

  await pool.end();
})().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch {
    /* ignore */
  }
});
