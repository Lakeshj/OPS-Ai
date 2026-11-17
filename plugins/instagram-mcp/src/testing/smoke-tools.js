/**
 * Plugin-local checks. No live Instagram calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { provider, tools, WRITE_TOOL_IDS } = require("../contracts/tools");
const { COMMON_TOOL_IDS } = require("../contracts/common");
const { PERFORMANCE_TOOL_IDS, ACCOUNT_METRIC_ENUM } = require("../contracts/performance");
const { createExecutor } = require("../executor");

const executorSrc = fs.readFileSync(path.join(__dirname, "../executor.js"), "utf8");
assert.equal(executorSrc.includes("publish_image"), false);
assert.equal(executorSrc.includes("reply_comment"), false);
assert.equal(/method:\s*["']POST["']/.test(executorSrc), false);
assert.equal(/method:\s*["']DELETE["']/.test(executorSrc), false);
assert.equal(/fetch\(/.test(executorSrc), false);
assert.match(executorSrc, /getProfile|listMedia|getMedia|listComments|runAccountInsights|runMediaInsights/);

assert.equal(provider.id, "instagram");
assert.equal(provider.authType, "instagram");
assert.deepEqual(
  tools.map((tool) => tool.id),
  [
    "account_summary",
    "list_media",
    "media_details",
    "comments",
    "account_insights",
    "media_insights",
  ]
);

for (const id of WRITE_TOOL_IDS) {
  assert.equal(
    tools.some((tool) => tool.id === id),
    false,
    `write tool ${id} must not be registered`
  );
}

for (const id of COMMON_TOOL_IDS) {
  const tool = tools.find((row) => row.id === id);
  assert.ok(tool, id);
  assert.equal(tool.uiGroup, "common");
  assert.equal(tool.access, "read");
  assert.equal(tool.risk, "low");
  assert.equal(tool.implemented, true);
  assert.equal(tool.executor, "instagram_mcp");
  assert.equal(tool.inputSchema.properties.credentialId, undefined);
  assert.equal(tool.inputSchema.properties.accessToken, undefined);
  assert.equal(tool.inputSchema.properties.instagramUserId, undefined);
}

for (const id of PERFORMANCE_TOOL_IDS) {
  const tool = tools.find((row) => row.id === id);
  assert.ok(tool, id);
  assert.equal(tool.uiGroup, "performance");
  assert.equal(tool.access, "read");
  assert.equal(tool.executor, "instagram_mcp");
}

const mediaDetails = tools.find((tool) => tool.id === "media_details");
assert.deepEqual(mediaDetails.inputSchema.required, ["mediaId"]);

const comments = tools.find((tool) => tool.id === "comments");
assert.deepEqual(comments.inputSchema.required, ["mediaId"]);

const accountInsights = tools.find((tool) => tool.id === "account_insights");
assert.ok(accountInsights.inputSchema.properties.metrics.items.enum.includes("views"));
assert.equal(
  accountInsights.inputSchema.properties.metrics.items.enum.includes("made_up_metric"),
  false
);
assert.ok(ACCOUNT_METRIC_ENUM.includes("reach"));

(async () => {
  const calls = [];
  const executor = createExecutor({
    AppError: class AppError extends Error {
      constructor(message, statusCode, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
      }
    },
    getProfile: async (args) => {
      calls.push(["getProfile", args]);
      return { id: args.instagramUserId, username: "opsai" };
    },
    listMedia: async (args) => {
      calls.push(["listMedia", args]);
      return {
        rows: [{ id: "m1", mediaId: "m1", _meta: { provider: "instagram" } }],
      };
    },
  });

  const summary = await executor.executeInstagramMcpTool({
    toolId: "account_summary",
    credentialId: "cred-1",
    account: { instagramUserId: "17841400000000000" },
  });
  assert.equal(summary[0].provider, "instagram");
  assert.equal(summary[0].tool, "account_summary");
  assert.equal(summary[0].instagramUserId, "17841400000000000");
  assert.equal(calls[0][0], "getProfile");

  const media = await executor.executeInstagramMcpTool({
    toolId: "list_media",
    credentialId: "cred-1",
    params: { limit: 5 },
    account: { instagramUserId: "17841400000000000" },
  });
  assert.equal(media[0].tool, "list_media");
  assert.equal(calls[1][1].limit, 5);
  assert.equal(calls[1][1].returnAll, false);

  await assert.rejects(
    () =>
      executor.executeInstagramMcpTool({
        toolId: "media_details",
        credentialId: "cred-1",
        params: {},
        account: { instagramUserId: "17841400000000000" },
      }),
    /media id/i
  );

  await assert.rejects(
    () =>
      executor.executeInstagramMcpTool({
        toolId: "reply_comment",
        credentialId: "cred-1",
        account: { instagramUserId: "17841400000000000" },
      }),
    /does not expose write tool/
  );

  await assert.rejects(
    () =>
      executor.executeInstagramMcpTool({
        toolId: "publish_image",
        credentialId: "cred-1",
        account: { instagramUserId: "17841400000000000" },
      }),
    /does not expose write tool/
  );

  console.log("instagram-mcp smoke-tools: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
