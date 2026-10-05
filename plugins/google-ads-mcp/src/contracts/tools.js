/**
 * Google Ads MCP P0 tool definitions.
 * The dynamic registry registers this list. It does not own the schemas.
 */

const { commonToolDefinitions } = require("./catalog");
const { performanceToolDefinitions } = require("./performance");

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});

const provider = Object.freeze({
  id: "google_ads",
  displayName: "Google Ads",
  authType: "google_ads",
  credentialType: "google_ads",
});

const tools = Object.freeze([
  ...commonToolDefinitions(provider),
  ...performanceToolDefinitions(provider),
  {
    provider: provider.id,
    id: "list_accessible_customers",
    displayName: "List Accessible Customers",
    description:
      "Customers this Google account can access. One row per customer resource returned by Google Ads.",
    category: "account",
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "google_ads_mcp",
    uiGroup: "internal",
    inputSchema: objectSchema({}),
    outputSchema: objectSchema({
      customerResourceName: { type: "string", description: "Customer resource name from Google Ads." },
      customerId: { type: "string", description: "Customer id when the resource name includes one." },
    }),
  },
  {
    provider: provider.id,
    id: "get_resource_metadata",
    displayName: "Get Resource Metadata",
    description:
      "Look up Google Ads field metadata before writing GAQL. Uses GoogleAdsFieldService.Search.",
    category: "metadata",
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "google_ads_mcp",
    uiGroup: "advanced",
    inputSchema: objectSchema({
      resourceOrField: {
        type: "string",
        title: "Resource or field",
        description:
          "Google Ads field name, such as metrics.clicks or campaign. Used when Query is empty.",
      },
      query: {
        type: "string",
        title: "Field query",
        description:
          "Optional GoogleAdsFieldService SELECT. When set, this query is sent instead of Resource or field.",
      },
      limit: {
        type: "integer",
        title: "Limit",
        description: "Maximum metadata rows. Defaults to 100.",
        minimum: 1,
        maximum: 10000,
      },
    }),
    outputSchema: objectSchema({
      name: { type: "string", description: "Field name returned by Google Ads." },
      category: { type: "string", description: "Field category returned by Google Ads." },
    }),
  },
  {
    provider: provider.id,
    id: "search",
    displayName: "Search",
    description:
      "Run a read-only GAQL SELECT through Google Ads search. This does not use the native report list.",
    category: "reporting",
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "google_ads_mcp",
    uiGroup: "advanced",
    inputSchema: objectSchema(
      {
        customerId: {
          type: "string",
          title: "Customer ID",
          description: "10-digit Google Ads customer ID. Hyphens are optional.",
          accountContext: true,
        },
        loginCustomerId: {
          type: "string",
          title: "Login customer ID",
          description:
            "Optional manager account ID. Leave blank for direct access. Not copied from Customer ID.",
          accountContext: true,
        },
        query: {
          type: "string",
          title: "GAQL query",
          description: "Read-only GAQL SELECT. Sent only to Google Ads search.",
        },
        limit: {
          type: "integer",
          title: "Limit",
          description: "Maximum rows to return. Defaults to 100. Ignored when Return all is on.",
          minimum: 1,
          maximum: 10000,
        },
        returnAll: {
          type: "boolean",
          title: "Return all",
          description: "Page through search results, up to 10000 rows.",
        },
      },
      ["customerId", "query"]
    ),
    outputSchema: objectSchema({
      _meta: { type: "object", description: "Google Ads provenance for the search row." },
    }),
  },
]);

module.exports = { provider, tools };
