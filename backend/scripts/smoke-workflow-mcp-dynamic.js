/**
 * Phase 3B — shared dynamic MCP registry, API surface, and node persistence.
 * Does not execute GA4 realtime/funnel (no executor) and does not call Google Ads.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerMcpDynamicTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Dynamic MCP tool registry");

  const registry = () => require("../services/mcpDynamicRegistry.service");
  const workflowsService = () => require("../modules/workflows/workflows.service");

  const ga4Dropdown = () =>
    registry().listTools({ provider: "google_analytics", exposure: "dropdown" });
  const ga4All = () =>
    registry().listTools({ provider: "google_analytics", exposure: "all" });

  check("MCP-A registry lists GA4 read/low tools", () => {
    const tools = ga4Dropdown();
    const ids = tools.map((tool) => tool.id);
    assertX.ok(ids.includes("run_realtime_report"));
    assertX.ok(ids.includes("run_funnel_report"));
    assertX.ok(ids.includes("run_pivot_report"));
    assertX.ok(ids.includes("list_audiences"));
    assertX.ok(ids.includes("list_conversion_events"));
    for (const tool of tools) {
      assertX.equal(tool.provider, "google_analytics");
      assertX.equal(tool.access, "read");
      assertX.equal(tool.risk, "low");
      assertX.equal(tool.authType, "google_ga4");
      assertX.ok(tool.inputSchema);
      assertX.equal(tool.implemented, false);
    }
  });

  check("MCP-B provider filtering keeps GA4 and GSC catalogs separate", () => {
    const ga4Ids = ga4Dropdown().map((tool) => tool.id);
    const gscIds = registry()
      .listTools({ provider: "google_search_console" })
      .map((tool) => tool.id);
    assertX.deepEqual(gscIds, ["inspect_url_enhanced"]);
    assertX.equal(ga4Ids.includes("inspect_url_enhanced"), false);
    assertX.equal(gscIds.includes("run_realtime_report"), false);
    const ads = registry().listTools({ provider: "google_ads" });
    assertX.deepEqual(ads, []);
    const providers = registry().listProviders();
    assertX.ok(providers.some((row) => row.id === "google_ads" && row.authType === "google_ads"));
  });

  check("MCP-C tool detail returns the input schema", () => {
    const detail = registry().getToolDefinition(
      "google_analytics",
      "run_realtime_report"
    );
    const fields = registry().describeInputFields(detail.inputSchema);
    const names = fields.map((field) => field.type);
    assertX.ok(names.includes("string"));
    assertX.ok(names.includes("number"));
    assertX.ok(names.includes("boolean"));
    assertX.ok(names.includes("enum"));
    const funnel = registry().getToolDefinition("google_analytics", "run_funnel_report");
    const funnelTypes = registry()
      .describeInputFields(funnel.inputSchema)
      .map((field) => field.type);
    assertX.ok(funnelTypes.includes("dateRange"));
    assertX.ok(funnelTypes.includes("array"));
    const pivot = registry().getToolDefinition("google_analytics", "run_pivot_report");
    const pivotTypes = registry()
      .describeInputFields(pivot.inputSchema)
      .map((field) => field.type);
    assertX.ok(pivotTypes.includes("date"));
    const inspect = registry().getToolDefinition(
      "google_search_console",
      "inspect_url_enhanced"
    );
    assertX.equal(inspect.implemented, true);
    assertX.equal(inspect.authType, "google_gsc");
    assertX.ok(inspect.inputSchema.required.includes("inspectionUrl"));
  });

  check("MCP-D unknown provider is rejected", () => {
    assertX.throws(
      () => registry().listTools({ provider: "google_facebook" }),
      (err) => err.code === "MCP_UNKNOWN_PROVIDER"
    );
    assertX.throws(
      () => registry().listTools({ provider: "" }),
      (err) => err.code === "MCP_UNKNOWN_PROVIDER"
    );
  });

  check("MCP-E unknown tool is rejected", () => {
    assertX.throws(
      () => registry().getToolDefinition("google_analytics", "run_report"),
      (err) => err.code === "MCP_UNKNOWN_TOOL"
    );
    assertX.throws(
      () =>
        registry().getToolDefinition(
          "google_analytics",
          "engagement_opportunities"
        ),
      (err) => err.code === "MCP_UNKNOWN_TOOL"
    );
    const ids = ga4All().map((tool) => tool.id);
    for (const blocked of [
      "engagement_opportunities",
      "landing_underperformance",
      "acquisition_concentration",
      "page_performance",
      "ctr_opportunities",
      "get_search_analytics",
    ]) {
      assertX.equal(ids.includes(blocked), false);
    }
  });

  check("MCP-F/G/H/J/K node data keeps provider, tool, params, and credential id only", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "dyn-1",
          type: "mcpDynamicTool",
          data: {
            label: "Dynamic MCP Tool",
            provider: "google_analytics",
            toolId: "run_realtime_report",
            credentialId: "cred-ga4-1",
            params: {
              propertyId: "{{item.customerId}}",
              minutes: 15,
              accessToken: "ya29.SHOULD_NOT_LEAK",
            },
            accessToken: "ya29.SHOULD_NOT_LEAK",
            refreshToken: "SHOULD_NOT_LEAK",
            clientSecret: "SHOULD_NOT_LEAK",
            developerToken: "SHOULD_NOT_LEAK",
          },
        },
      ],
      edges: [],
    };
    workflowsService().validateDefinition(definition);
    const saved = JSON.parse(JSON.stringify(definition));
    const data = saved.nodes[0].data;
    assertX.equal(data.provider, "google_analytics");
    assertX.equal(data.toolId, "run_realtime_report");
    assertX.equal(data.credentialId, "cred-ga4-1");
    assertX.equal(data.params.propertyId, "{{item.customerId}}");
    assertX.equal(data.params.minutes, 15);
    const blob = JSON.stringify(saved);
    assertX.equal(blob.includes("SHOULD_NOT_LEAK"), false);
    assertX.equal(blob.includes("ya29"), false);
    assertX.equal(blob.includes("accessToken"), false);
    assertX.equal(blob.includes("refreshToken"), false);
    assertX.equal(blob.includes("clientSecret"), false);
    assertX.equal(blob.includes("developerToken"), false);
    assertX.ok(workflowsService().ALLOWED_NODE_TYPES.has("mcpDynamicTool"));
  });

  check("MCP-I parameter schema covers the generic field types", () => {
    const types = new Set();
    for (const tool of ga4Dropdown()) {
      for (const field of registry().describeInputFields(tool.inputSchema)) {
        types.add(field.type);
        assertX.equal(typeof field.required, "boolean");
        assertX.equal(typeof field.description, "string");
      }
    }
    for (const expected of [
      "string",
      "number",
      "boolean",
      "enum",
      "date",
      "dateRange",
      "array",
    ]) {
      assertX.ok(types.has(expected), expected);
    }
    const predictive = registry().getToolDefinition(
      "google_analytics",
      "run_predictive_analysis"
    );
    assertX.equal(predictive.risk, "medium");
    assertX.equal(predictive.implemented, false);
    assertX.equal(
      ga4Dropdown().some((tool) => tool.id === "run_predictive_analysis"),
      false
    );
  });

  check("MCP-L existing GSC plugin routes stay registered", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.routes.js"),
      "utf8"
    );
    assertX.ok(routes.includes('"/plugins/gsc-mcp/tools"'));
    assertX.ok(routes.includes('"/plugins/gsc-mcp/execute"'));
    assertX.ok(routes.includes('"/plugins/gsc-mcp/intent"'));
    assertX.ok(routes.includes('"/plugins/mcp/tools"'));
    assertX.ok(routes.includes('"/plugins/mcp/tools/:provider/:toolId"'));
    assertX.ok(routes.includes('"/plugins/mcp/tools/:provider/:toolId/execute"'));
    const host = require("../services/mcpPluginHost.service");
    assertX.equal(typeof host.listGscMcpTools, "function");
    assertX.equal(typeof host.executeGscMcpTool, "function");
    assertX.equal(typeof host.intentHints, "function");
  });

  check("MCP expressions resolve with the existing expression helper", () => {
    const { resolveExpression } = require("../services/workflowNodes.service");
    const resolved = registry().resolveParamTree(
      {
        propertyId: "{{item.customerId}}",
        note: "see {{items.src.0.json.field}}",
        accessToken: "nope",
      },
      {
        item: { json: { customerId: "123" } },
        items: { src: [{ json: { field: "from-items" } }] },
        input: {},
        steps: {},
      },
      resolveExpression
    );
    assertX.equal(resolved.propertyId, "123");
    assertX.equal(resolved.note, "see from-items");
    assertX.equal(resolved.accessToken, undefined);
  });

  check("MCP unavailable GA4 tool does not invent a result", async () => {
    const { executeNode } = require("../services/workflowNodes.service");
    await assertX.rejects(
      () =>
        executeNode(
          {
            id: "dyn-1",
            type: "mcpDynamicTool",
            data: {
              provider: "google_analytics",
              toolId: "run_realtime_report",
              credentialId: "cred-ga4-1",
              params: { propertyId: "123", minutes: 15 },
            },
          },
          { input: {}, steps: {}, items: {}, item: { json: {} }, inputItems: [] }
        ),
      (err) => err.code === "MCP_TOOL_UNAVAILABLE"
    );
    await assertX.rejects(
      () =>
        registry().executeTool({
          provider: "google_analytics",
          toolId: "run_funnel_report",
          params: {},
        }),
      (err) => err.code === "MCP_INVALID_PARAMS"
    );
    await assertX.rejects(
      () =>
        registry().executeTool({
          provider: "google_analytics",
          toolId: "run_predictive_analysis",
          params: { propertyId: "123" },
        }),
      (err) => err.code === "MCP_TOOL_GATED"
    );
  });

  check("MCP GSC inspect delegates to the existing executor and returns WorkflowItems", async () => {
    await assertX.rejects(
      () =>
        registry().executeTool({
          provider: "google_search_console",
          toolId: "inspect_url_enhanced",
          params: { inspectionUrl: "https://example.com/a" },
          credentialId: "cred-1",
        }),
      (err) => err.code === "MCP_INVALID_PARAMS"
    );
    await assertX.rejects(
      () =>
        registry().executeTool({
          provider: "google_search_console",
          toolId: "inspect_url_enhanced",
          params: {
            siteUrl: "sc-domain:example.com",
            inspectionUrl: "https://example.com/a",
          },
        }),
      (err) => err.code === "MCP_CREDENTIAL_REQUIRED"
    );

    const result = await registry().executeTool(
      {
        provider: "google_search_console",
        toolId: "inspect_url_enhanced",
        credentialId: "cred-1",
        params: {
          siteUrl: "sc-domain:example.com",
          inspectionUrl: "https://example.com/a",
        },
      },
      {
        executeGscMcpTool: async (args) => {
          assertX.equal(args.toolId, "inspect_url_enhanced");
          assertX.equal(args.credentialId, "cred-1");
          assertX.equal(args.mode, "raw");
          return {
            ok: true,
            data: {
              inspectionUrl: args.toolArgs.inspectionUrl,
              indexStatus: "Submitted and indexed",
              accessToken: "ya29.SHOULD_NOT_LEAK",
              refreshToken: "SHOULD_NOT_LEAK",
            },
          };
        },
      }
    );
    assertX.equal(result.items.length, 1);
    assertX.equal(result.items[0].json.inspectionUrl, "https://example.com/a");
    assertX.equal(result.items[0].json.indexStatus, "Submitted and indexed");
    assertX.equal(Object.prototype.hasOwnProperty.call(result.items[0].json, "accessToken"), false);
    assertX.equal(JSON.stringify(result).includes("SHOULD_NOT_LEAK"), false);

    await assertX.rejects(
      () =>
        registry().executeTool(
          {
            provider: "google_search_console",
            toolId: "inspect_url_enhanced",
            credentialId: "cred-1",
            params: {
              siteUrl: "sc-domain:example.com",
              inspectionUrl: "https://example.com/a",
            },
          },
          {
            executeGscMcpTool: async () => {
              throw new Error("accessToken ya29.SHOULD_NOT_LEAK");
            },
          }
        ),
      (err) => {
        assertX.equal(err.code, "MCP_EXECUTION_FAILED");
        assertX.equal(String(err.message).includes("SHOULD_NOT_LEAK"), false);
        assertX.equal(String(err.message).includes("ya29"), false);
        return true;
      }
    );

    await assertX.rejects(
      () =>
        registry().executeTool(
          {
            provider: "google_search_console",
            toolId: "inspect_url_enhanced",
            credentialId: "missing",
            params: {
              siteUrl: "sc-domain:example.com",
              inspectionUrl: "https://example.com/a",
            },
          },
          {
            executeGscMcpTool: async () => {
              const error = new Error("Google credential not found");
              throw error;
            },
          }
        ),
      (err) => err.code === "MCP_CREDENTIAL_UNAUTHORIZED"
    );
  });
};

module.exports = { registerMcpDynamicTests };

if (require.main === module) {
  const queue = [];
  const check = (name, fn) => {
    queue.push(async () => {
      await fn();
      console.log(`  ok  ${name}`);
    });
  };
  const section = (name) => console.log(`\n${name}`);
  registerMcpDynamicTests({ check, section, assert });
  (async () => {
    for (const task of queue) await task();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
