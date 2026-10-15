/**
 * Meta Ads MCP tool definitions.
 * The dynamic registry registers this list. It does not own the schemas.
 */

const { commonToolDefinitions, objectSchema } = require("./catalog");
const { performanceToolDefinitions } = require("./performance");

const provider = Object.freeze({
  id: "meta_ads",
  displayName: "Meta Ads",
  authType: "meta_ads",
  credentialType: "meta_ads",
});

const internalTools = Object.freeze([
  {
    provider: provider.id,
    id: "list_accessible_ad_accounts",
    displayName: "List Accessible Ad Accounts",
    description:
      "Ad accounts this Meta user can access. One row per account returned by GET /me/adaccounts.",
    category: "account",
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "meta_ads_mcp",
    uiGroup: "internal",
    inputSchema: objectSchema({}),
    outputSchema: objectSchema({
      adAccountId: { type: "string", description: "Numeric Meta ad account id." },
      apiId: { type: "string", description: "act_{id} Graph path id." },
      name: { type: "string", description: "Ad account name." },
    }),
  },
]);

const tools = Object.freeze([
  ...commonToolDefinitions(provider),
  ...performanceToolDefinitions(provider),
  ...internalTools,
]);

module.exports = { provider, tools };
