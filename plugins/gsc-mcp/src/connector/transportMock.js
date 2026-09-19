/**
 * Phase 1 mock MCP session — essential Data tools only.
 */
const { normalizeResult } = require("../errors");
const { categorizeTool } = require("../registry/categories");
const { labelForToolId } = require("../contracts/capabilities");

const MOCK_TOOLS = [
  {
    name: "get_capabilities",
    description: "Lists tools and auth status (AI discovery)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_properties",
    description: "Shows all GSC properties",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_search_analytics",
    description: "Top queries/pages with clicks, impressions, CTR, position",
    inputSchema: {
      type: "object",
      properties: {
        siteUrl: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } },
        rowLimit: { type: "number" },
      },
      required: ["siteUrl"],
    },
  },
  {
    name: "get_performance_overview",
    description: "Summary of site performance",
    inputSchema: {
      type: "object",
      properties: {
        siteUrl: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
      },
      required: ["siteUrl"],
    },
  },
  {
    name: "compare_search_periods",
    description: "Compare performance between two time periods",
    inputSchema: {
      type: "object",
      properties: {
        siteUrl: { type: "string" },
        periodAStart: { type: "string" },
        periodAEnd: { type: "string" },
        periodBStart: { type: "string" },
        periodBEnd: { type: "string" },
      },
      required: ["siteUrl"],
    },
  },
  {
    name: "inspect_url_enhanced",
    description: "Detailed crawl/index status for a URL",
    inputSchema: {
      type: "object",
      properties: {
        siteUrl: { type: "string" },
        inspectionUrl: { type: "string" },
      },
      required: ["siteUrl", "inspectionUrl"],
    },
  },
];

const mockDataFor = (name, args = {}) => {
  const siteUrl = args.siteUrl || "https://example.com/";
  switch (name) {
    case "get_capabilities":
      return {
        auth: "mock",
        tools: MOCK_TOOLS.map((t) => t.name),
        labels: MOCK_TOOLS.map((t) => ({
          id: t.name,
          label: labelForToolId(t.name),
        })),
      };
    case "list_properties":
    case "list_sites":
      return {
        sites: [
          { siteUrl, permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteFullUser" },
        ],
      };
    case "get_search_analytics":
      return {
        rows: [
          {
            keys: ["seo workflow"],
            clicks: 42,
            impressions: 900,
            ctr: 0.0467,
            position: 8.2,
          },
          {
            keys: ["gsc mcp"],
            clicks: 18,
            impressions: 400,
            ctr: 0.045,
            position: 12.1,
          },
        ],
      };
    case "get_performance_overview":
    case "get_performance_summary":
      return {
        siteUrl,
        clicks: 1200,
        impressions: 48000,
        ctr: 0.025,
        position: 14.4,
      };
    case "compare_search_periods":
    case "compare_periods":
      return {
        periodA: { clicks: 1000, impressions: 40000 },
        periodB: { clicks: 1200, impressions: 48000 },
        delta: { clicks: 200, impressions: 8000 },
      };
    case "inspect_url_enhanced":
    case "inspect_url":
      return {
        inspectionUrl: args.inspectionUrl,
        indexStatus: "Submitted and indexed",
        lastCrawl: "2026-09-01T00:00:00Z",
      };
    default:
      return { mock: true, tool: name, args };
  }
};

const createMockSession = (auth = {}) => {
  const tools = MOCK_TOOLS.map((t) => ({
    id: t.name,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    category: categorizeTool(t.name),
    source: "external",
    externalName: t.name,
  }));

  return {
    async listTools() {
      return tools;
    },
    async callTool(name, args = {}) {
      const found = tools.find((t) => t.name === name || t.id === name);
      if (!found) {
        return normalizeResult(name, {
          ok: false,
          error: {
            code: "MCP_TOOL_FAILED",
            message: `Unknown mock tool: ${name}`,
          },
        });
      }
      return normalizeResult(found.id, {
        data: mockDataFor(found.name, args),
        warnings: auth.accessToken
          ? []
          : ["Mock session: no live Google token injected"],
      });
    },
    async close() {},
  };
};

const createMockTransport = () => ({
  async connect(auth) {
    return createMockSession(auth || {});
  },
});

module.exports = {
  createMockTransport,
  createMockSession,
  MOCK_TOOLS,
};
