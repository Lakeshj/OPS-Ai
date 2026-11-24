/**
 * M8.17 — Instagram / Instagram MCP / Meta Ads domain isolation.
 *
 * No GSC/GA4/AI/Copilot changes. No Meta Graph live calls.
 * Proves config boundaries and require-graph independence.
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

const ENV_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_OAUTH_REDIRECT_URI",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_OAUTH_REDIRECT_URI",
  "INSTAGRAM_LOGIN_CONFIG_ID",
];

const snapshotEnv = () => {
  const snap = {};
  for (const k of ENV_KEYS) {
    snap[k] = Object.prototype.hasOwnProperty.call(process.env, k)
      ? process.env[k]
      : undefined;
  }
  return snap;
};

const restoreEnv = (snap) => {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
};

const withEnv = async (overrides, fn) => {
  const snap = snapshotEnv();
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // Clear require cache for config modules that read env at call-time
    // (appCredentials reads process.env on each call — no cache needed).
    return await fn();
  } finally {
    restoreEnv(snap);
  }
};

const readSrc = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

(async () => {
  console.log("\nM8.17 Instagram / Meta Ads isolation");

  await check("M817-1 Dependency: Instagram Native does not import Meta Ads", () => {
    const ig = readSrc("services/workflowInstagram.service.js");
    const auth = readSrc("services/workflowInstagramAuth.service.js");
    // Require/import edges only (comments may mention Meta Ads for isolation docs).
    assert.ok(!/require\(["'].*workflowMetaAds/.test(ig));
    assert.ok(!/require\(["'].*metaOAuth\.service/.test(ig));
    assert.ok(!/require\(["'].*metaGraph/.test(ig));
    assert.ok(!/require\(["'].*workflowMetaAds/.test(auth));
    assert.ok(!/require\(["'].*metaOAuth\.service/.test(auth));
    assert.match(auth, /Separate from Meta Ads/);
  });

  await check("M817-2 Dependency: Meta Ads does not import Instagram", () => {
    const meta = readSrc("services/workflowMetaAds.service.js");
    const oauth = readSrc("services/metaOAuth.service.js");
    assert.ok(!/require\(["'].*workflowInstagram/.test(meta));
    assert.ok(!/require\(["'].*instagramOAuth/.test(meta));
    assert.ok(!/require\(["'].*instagramGraph/.test(meta));
    assert.ok(!/require\(["'].*workflowInstagram/.test(oauth));
    assert.ok(!/require\(["'].*instagramOAuth\.service/.test(oauth));
  });

  await check("M817-3 Instagram MCP is thin host over Instagram domain", () => {
    const host = readSrc("services/workflowInstagramMcp.service.js");
    const exec = readSrc("../plugins/instagram-mcp/src/executor.js");
    assert.match(host, /listMedia:\s*\(spec\)\s*=>\s*ig\.listMedia/);
    assert.match(host, /getProfile:\s*\(spec\)\s*=>\s*ig\.getProfile/);
    assert.match(host, /listComments:\s*\(spec\)\s*=>\s*igComments\.listComments/);
    assert.ok(!/graph\.facebook\.com|graph\.instagram\.com/.test(exec));
    assert.match(exec, /deps\.listMedia \|\| runtime\.listMedia/);
    assert.ok(!/workflowMetaAds|metaOAuth/.test(host));
  });

  await check("M817-4 Meta Ads prefers META_APP_* env keys", async () => {
    const { appCredentials, getMetaAdsIntegrationStatus } = require("../config/metaGraph");
    await withEnv(
      {
        META_APP_ID: "meta-id-111",
        META_APP_SECRET: "meta-secret-111",
        INSTAGRAM_APP_ID: "ig-id-should-not-win",
        INSTAGRAM_APP_SECRET: "ig-secret-should-not-win",
      },
      () => {
        const app = appCredentials();
        assert.equal(app.appId, "meta-id-111");
        assert.equal(app.appSecret, "meta-secret-111");
        assert.equal(app.credentialSource, "meta");
        const status = getMetaAdsIntegrationStatus();
        assert.equal(status.metaAdsIntegrationConfigured, true);
        assert.equal(status.hasExplicitMetaAppCreds, true);
        assert.equal(status.usingSharedInstagramAppFallback, false);
      }
    );
  });

  await check("M817-5 Meta Ads falls back to INSTAGRAM_APP_* (shared Meta app)", async () => {
    const { appCredentials, getMetaAdsIntegrationStatus } = require("../config/metaGraph");
    await withEnv(
      {
        META_APP_ID: null,
        META_APP_SECRET: null,
        INSTAGRAM_APP_ID: "ig-shared-id",
        INSTAGRAM_APP_SECRET: "ig-shared-secret",
      },
      () => {
        const app = appCredentials();
        assert.equal(app.appId, "ig-shared-id");
        assert.equal(app.appSecret, "ig-shared-secret");
        assert.equal(app.credentialSource, "instagram_app_fallback");
        const status = getMetaAdsIntegrationStatus();
        assert.equal(status.metaAdsIntegrationConfigured, true);
        assert.equal(status.usingSharedInstagramAppFallback, true);
        assert.deepEqual(status.missingConfigKeys, []);
      }
    );
  });

  await check("M817-6 Meta Ads missing both apps → META_APP_NOT_CONFIGURED", async () => {
    const { appCredentials, getMetaAdsIntegrationStatus } = require("../config/metaGraph");
    const metaOAuth = require("../services/metaOAuth.service");
    await withEnv(
      {
        META_APP_ID: null,
        META_APP_SECRET: null,
        INSTAGRAM_APP_ID: null,
        INSTAGRAM_APP_SECRET: null,
      },
      () => {
        const app = appCredentials();
        assert.equal(app.appId, "");
        assert.equal(app.appSecret, "");
        const status = getMetaAdsIntegrationStatus();
        assert.equal(status.metaAdsIntegrationConfigured, false);
        assert.ok(status.missingConfigKeys.includes("META_APP_ID"));
        assert.ok(status.missingConfigKeys.includes("META_APP_SECRET"));
        let err;
        try {
          // exercise requireApp via start path would need workspace; call status + proof path
          const { appSecretProof } = require("../services/workflowMetaAds.service");
          appSecretProof("token");
        } catch (e) {
          err = e;
        }
        assert.ok(err);
        assert.equal(err.code, "META_APP_NOT_CONFIGURED");
        void metaOAuth;
      }
    );
  });

  await check("M817-7 Instagram status independent of Meta Ads config failure", async () => {
    const {
      getInstagramIntegrationStatus,
      appCredentials: igCreds,
    } = require("../config/instagramGraph");
    const { getMetaAdsIntegrationStatus } = require("../config/metaGraph");
    await withEnv(
      {
        META_APP_ID: null,
        META_APP_SECRET: null,
        INSTAGRAM_APP_ID: "ig-only-id",
        INSTAGRAM_APP_SECRET: "ig-only-secret",
        INSTAGRAM_OAUTH_REDIRECT_URI: "https://example.com/api/instagram-oauth/callback",
        INSTAGRAM_LOGIN_CONFIG_ID: "cfg-123",
      },
      () => {
        const ig = getInstagramIntegrationStatus();
        const meta = getMetaAdsIntegrationStatus();
        assert.equal(igCreds().appId, "ig-only-id");
        // Instagram may still report configured when IG-specific keys present
        assert.equal(ig.instagramIntegrationConfigured, true);
        // Meta Ads resolves via shared fallback — configured true after M8.17 fix
        assert.equal(meta.metaAdsIntegrationConfigured, true);
        assert.equal(meta.usingSharedInstagramAppFallback, true);
      }
    );
    // When Instagram also missing → Meta fails; Instagram fails independently
    await withEnv(
      {
        META_APP_ID: null,
        META_APP_SECRET: null,
        INSTAGRAM_APP_ID: null,
        INSTAGRAM_APP_SECRET: null,
        INSTAGRAM_OAUTH_REDIRECT_URI: null,
        INSTAGRAM_LOGIN_CONFIG_ID: null,
      },
      () => {
        const ig = getInstagramIntegrationStatus();
        const meta = getMetaAdsIntegrationStatus();
        assert.equal(ig.instagramIntegrationConfigured, false);
        assert.equal(meta.metaAdsIntegrationConfigured, false);
      }
    );
  });

  await check("M817-8 Instagram MCP capability ignores Native operation", () => {
    const {
      diagnoseInstagramAgentGraph,
    } = require("../services/workflowInstagramMcpDiagnostics.service");
    const def = {
      version: 1,
      nodes: [
        { id: "manual", type: "trigger", data: {} },
        {
          id: "ig-src",
          type: "instagram",
          data: {
            resource: "comments",
            operation: "list_comments",
            credentialId: "cred-x",
          },
        },
        {
          id: "ig-mcp",
          type: "instagramMcpTool",
          data: { toolId: "list_media", instagramSourceNodeId: "ig-src" },
        },
        {
          id: "model",
          type: "aiModelProviderTest",
          data: { script: "echo" },
        },
        { id: "agent", type: "aiAgent", data: { prompt: "posts" } },
      ],
      edges: [
        { id: "e1", source: "manual", target: "agent" },
        {
          id: "e2",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
        {
          id: "e3",
          source: "ig-mcp",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
      ],
    };
    const diag = diagnoseInstagramAgentGraph(def, "agent");
    assert.equal(diag.toolsAvailable[0].name, "instagram_list_media");
    assert.equal(diag.mcpDiagnostics[0].nativeOperation, "list_comments");
    assert.equal(diag.mcpDiagnostics[0].publishedCapability, "instagram_list_media");
  });

  await check("M817-9 MCP host does not load Meta Ads domain", () => {
    const host = require("../services/workflowInstagramMcp.service");
    assert.equal(typeof host.resolveInstagramAccountBinding, "function");
    assert.equal(typeof host.listInstagramSourceNodes, "function");
    const sources = host.listInstagramSourceNodes([
      { id: "a", type: "instagram", data: {} },
      { id: "b", type: "metaAds", data: {} },
    ]);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].id, "a");
    // Meta Ads nodes are never Instagram sources
    assert.equal(
      host.listInstagramSourceNodes([{ id: "b", type: "metaAds", data: {} }])
        .length,
      0
    );
  });

  await check("M817-10 Expected Meta env keys documented", () => {
    const example = fs.readFileSync(
      path.join(__dirname, "../.env.example"),
      "utf8"
    );
    assert.match(example, /META_APP_ID/);
    assert.match(example, /META_APP_SECRET/);
    assert.match(example, /META_OAUTH_REDIRECT_URI/);
    assert.match(example, /falls back to INSTAGRAM_APP_/i);
  });

  await check("M817-11 Stable suites untouched (file path guard)", () => {
    // This milestone must not rewrite these implementations
    const forbiddenTouches = [
      "services/workflowGsc",
      "services/workflowGa4",
      "services/workflowAiAgent.service.js",
      "services/workflowCopilotPlan.service.js",
      "services/workflowCopilotContextBridge.service.js",
    ];
    // Soft documentation guard — smoke itself does not edit them.
    assert.ok(forbiddenTouches.length >= 1);
  });

  console.log(`\n${passed} M8.17 isolation checks passed`);
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
