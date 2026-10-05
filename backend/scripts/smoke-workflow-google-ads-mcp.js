/**
 * Google Ads MCP P0 — dynamic registry tools. No live Google calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerGoogleAdsMcpTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Google Ads MCP P0");

  const registry = () => require("../services/mcpDynamicRegistry.service");
  const adsMcp = () => require("../services/workflowGoogleAdsMcp.service");
  const nativeAds = () => require("../services/workflowGoogleAds.service");

  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

  const searchNode = (params) => ({
    id: "mcp-ads",
    type: "mcpDynamicTool",
    data: {
      provider: "google_ads",
      toolId: "search",
      credentialId: "cred-ads",
      params,
    },
  });

  check("ADS-MCP-1 google_ads provider becomes visible when implemented tools exist", () => {
    const providers = registry().listProviders();
    const ads = providers.find((row) => row.id === "google_ads");
    assertX.equal(ads.authType, "google_ads");
    assertX.equal(ads.toolCount, 19);
    const tools = registry().listTools({ provider: "google_ads" });
    assertX.deepEqual(
      tools.map((tool) => tool.id),
      [
        "account_summary",
        "campaigns",
        "ad_groups",
        "ads",
        "keywords",
        "assets",
        "conversion_actions",
        "recommendations",
        "campaign_performance",
        "ad_group_performance",
        "ad_performance",
        "keyword_performance",
        "search_terms",
        "device_performance",
        "geographic_performance",
        "placement_performance",
        "conversion_performance",
        "get_resource_metadata",
        "search",
      ]
    );
    const allIds = registry()
      .listTools({ provider: "google_ads", exposure: "all" })
      .map((tool) => tool.id);
    assertX.deepEqual(allIds, [
      "account_summary",
      "campaigns",
      "ad_groups",
      "ads",
      "keywords",
      "assets",
      "conversion_actions",
      "recommendations",
      "campaign_performance",
      "ad_group_performance",
      "ad_performance",
      "keyword_performance",
      "search_terms",
      "device_performance",
      "geographic_performance",
      "placement_performance",
      "conversion_performance",
      "list_accessible_customers",
      "get_resource_metadata",
      "search",
    ]);
    for (const tool of tools) {
      assertX.equal(tool.implemented, true);
      assertX.equal(tool.access, "read");
      assertX.equal(tool.risk, "low");
      assertX.equal(tool.authType, "google_ads");
    }
  });

  check("ADS-MCP-2 list_accessible_customers registry schema", () => {
    const tool = registry().getToolDefinition("google_ads", "list_accessible_customers");
    assertX.deepEqual(tool.inputSchema.required || [], []);
    assertX.deepEqual(registry().describeInputFields(tool.inputSchema), []);
    assertX.equal(tool.outputSchema.properties.customerResourceName.type, "string");
  });

  check("ADS-MCP-3 list_accessible_customers executor", async () => {
    const calls = [];
    const result = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "list_accessible_customers",
        credentialId: "cred-ads",
        params: {},
        workspaceId: "ws-1",
      },
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return {
            body: { resourceNames: ["customers/1234567890", "customers/0987654321"] },
          };
        },
      }
    );
    assertX.equal(calls.length, 1);
    assertX.equal(calls[0].method, "GET");
    assertX.equal(calls[0].requiredType, "google_ads");
    assertX.equal(
      calls[0].url,
      "https://googleads.googleapis.com/v25/customers:listAccessibleCustomers"
    );
    assertX.equal(calls[0].headers, undefined);
    assertX.equal(result.items.length, 2);
  });

  check("ADS-MCP-4 customer results become WorkflowItems", async () => {
    const result = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "list_accessible_customers",
        credentialId: "cred-ads",
        params: {},
      },
      {
        googleApiRequest: async () => ({
          body: { resourceNames: ["customers/7887133215", "not-a-customer"] },
        }),
      }
    );
    assertX.deepEqual(result.items[0].json.customerResourceName, "customers/7887133215");
    assertX.equal(result.items[0].json.customerId, "7887133215");
    assertX.equal(result.items[1].json.customerResourceName, "not-a-customer");
    assertX.equal(result.items[1].json.customerId, undefined);
    assertX.equal(result.items[0].json.accountName, undefined);
  });

  check("ADS-MCP-5 get_resource_metadata schema", () => {
    const tool = registry().getToolDefinition("google_ads", "get_resource_metadata");
    const fields = registry().describeInputFields(tool.inputSchema);
    const names = fields.map((field) => field.name);
    assertX.deepEqual(names, ["resourceOrField", "query", "limit"]);
    assertX.equal(fields.every((field) => field.required === false), true);
    assertX.equal(fields.find((field) => field.name === "limit").type, "integer");
    const built = adsMcp().fieldServiceQuery({ resourceOrField: "metrics.clicks" });
    assertX.match(built, /^SELECT /);
    assertX.match(built, /WHERE name = "metrics\.clicks"/);
    assertX.equal(built.includes("FROM campaign"), false);
  });

  check("ADS-MCP-6 metadata API execution", async () => {
    const calls = [];
    await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "get_resource_metadata",
        credentialId: "cred-ads",
        params: { resourceOrField: "metrics.clicks", limit: 5 },
      },
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [] } };
        },
      }
    );
    assertX.equal(calls.length, 1);
    assertX.equal(calls[0].method, "POST");
    assertX.equal(
      calls[0].url,
      "https://googleads.googleapis.com/v25/googleAdsFields:search"
    );
    assertX.match(calls[0].body.query, /WHERE name = "metrics\.clicks"/);
    assertX.equal(calls[0].body.pageSize, 5);
    assertX.equal(String(calls[0].url).includes("googleAds:search"), false);
  });

  check("ADS-MCP-7 metadata output preserves real field information", async () => {
    const result = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "get_resource_metadata",
        credentialId: "cred-ads",
        params: { resourceOrField: "metrics.clicks" },
      },
      {
        googleApiRequest: async () => ({
          body: {
            results: [
              {
                name: "metrics.clicks",
                category: "METRIC",
                dataType: "INT64",
                selectable: true,
                filterable: true,
                sortable: true,
              },
            ],
          },
        }),
      }
    );
    const row = result.items[0].json;
    assertX.equal(row.name, "metrics.clicks");
    assertX.equal(row.category, "METRIC");
    assertX.equal(row.dataType, "INT64");
    assertX.equal(row.selectable, true);
    assertX.equal(row.filterable, true);
    assertX.equal(row.sortable, true);
    assertX.equal(row.description, undefined);
    assertX.equal(row._meta.resource, "metadata");
  });

  check("ADS-MCP-8 search schema", () => {
    const tool = registry().getToolDefinition("google_ads", "search");
    const fields = registry().describeInputFields(tool.inputSchema);
    const byName = Object.fromEntries(fields.map((field) => [field.name, field]));
    assertX.equal(byName.customerId.required, true);
    assertX.equal(byName.query.required, true);
    assertX.equal(byName.loginCustomerId.required, false);
    assertX.equal(byName.limit.type, "integer");
    assertX.equal(byName.returnAll.type, "boolean");
    assertX.equal(byName.returnAll.required, false);
  });

  check("ADS-MCP-9 valid GAQL reaches only GoogleAdsService.Search", async () => {
    const calls = [];
    await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "search",
        credentialId: "cred-ads",
        params: {
          customerId: "123-456-7890",
          query: "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'PAUSED'",
          limit: 10,
        },
      },
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [] } };
        },
      }
    );
    assertX.equal(calls.length, 1);
    assertX.equal(calls[0].method, "POST");
    assertX.equal(
      calls[0].url,
      "https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search"
    );
    assertX.match(calls[0].body.query, /^SELECT /);
    assertX.match(calls[0].body.query, /LIMIT 10/);
    assertX.equal(calls[0].headers, undefined);
    assertX.equal(JSON.stringify(calls).includes("mutate"), false);
  });

  check("ADS-MCP-10 search results become WorkflowItems", async () => {
    const result = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "search",
        credentialId: "cred-ads",
        params: {
          customerId: "1234567890",
          query: "SELECT campaign.id, metrics.clicks FROM campaign",
        },
      },
      {
        googleApiRequest: async () => ({
          body: {
            results: [
              {
                campaign: { id: "23982220693", name: "Brand" },
                metrics: { clicks: "12" },
              },
            ],
          },
        }),
      }
    );
    const row = result.items[0].json;
    assertX.equal(row.campaign.id, "23982220693");
    assertX.equal(row.campaign.name, "Brand");
    assertX.equal(row.metrics.clicks, "12");
    assertX.equal(row.reportType, undefined);
    assertX.equal(row.landingPage, undefined);
  });

  check("ADS-MCP-11 _meta.provider = google_ads", async () => {
    const listed = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "list_accessible_customers",
        credentialId: "cred-ads",
        params: {},
      },
      {
        googleApiRequest: async () => ({
          body: { resourceNames: ["customers/1234567890"] },
        }),
      }
    );
    const metaRow = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "get_resource_metadata",
        credentialId: "cred-ads",
        params: { resourceOrField: "campaign" },
      },
      {
        googleApiRequest: async () => ({
          body: { results: [{ name: "campaign", category: "RESOURCE" }] },
        }),
      }
    );
    const searched = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "search",
        credentialId: "cred-ads",
        params: {
          customerId: "1234567890",
          query: "SELECT campaign.id FROM campaign",
        },
      },
      {
        googleApiRequest: async () => ({
          body: { results: [{ campaign: { id: "1" } }] },
        }),
      }
    );
    for (const item of [...listed.items, ...metaRow.items, ...searched.items]) {
      assertX.equal(item.json._meta.provider, "google_ads");
      assertX.equal(item.json._meta.apiVersion, "v25");
    }
  });

  check("ADS-MCP-12 _meta.tool correct for each tool", async () => {
    const stub = async (spec) => {
      if (String(spec.url).includes("listAccessibleCustomers")) {
        return { body: { resourceNames: ["customers/1234567890"] } };
      }
      if (String(spec.url).includes("googleAdsFields:search")) {
        return { body: { results: [{ name: "campaign.id", category: "ATTRIBUTE" }] } };
      }
      return { body: { results: [{ campaign: { id: "1" } }] } };
    };
    const tools = ["list_accessible_customers", "get_resource_metadata", "search"];
    for (const toolId of tools) {
      const params =
        toolId === "search"
          ? { customerId: "1234567890", query: "SELECT campaign.id FROM campaign" }
          : toolId === "get_resource_metadata"
            ? { resourceOrField: "campaign.id" }
            : {};
      const result = await registry().executeTool(
        { provider: "google_ads", toolId, credentialId: "cred-ads", params },
        { googleApiRequest: stub }
      );
      assertX.equal(result.items[0].json._meta.tool, toolId);
    }
  });

  check("ADS-MCP-13 customerId expression resolution", async () => {
    const node = searchNode({
      customerId: "{{item.customerId}}",
      query: "{{steps.previous.gaql}}",
    });
    assertX.equal(node.data.params.customerId, "{{item.customerId}}");
    assertX.equal(node.data.params.query, "{{steps.previous.gaql}}");
    const calls = [];
    await registry().executeDynamicMcpNode(
      node,
      {
        item: { json: { customerId: "788-713-3215" } },
        steps: { previous: { gaql: "SELECT campaign.id FROM campaign" } },
      },
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [] } };
        },
      }
    );
    assertX.equal(calls.length, 1);
    assertX.match(calls[0].url, /\/customers\/7887133215\/googleAds:search$/);
    assertX.match(calls[0].body.query, /^SELECT campaign\.id FROM campaign/);
    assertX.equal(node.data.params.customerId, "{{item.customerId}}");
  });

  check("ADS-MCP-14 optional loginCustomerId", async () => {
    const calls = [];
    const request = async (spec) => {
      calls.push(spec);
      return { body: { results: [{ campaign: { id: "1" } }] } };
    };
    await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "search",
        credentialId: "cred-ads",
        params: {
          customerId: "1234567890",
          query: "SELECT campaign.id FROM campaign",
        },
      },
      { googleApiRequest: request }
    );
    await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "search",
        credentialId: "cred-ads",
        params: {
          customerId: "1234567890",
          loginCustomerId: "999-000-1111",
          query: "SELECT campaign.id FROM campaign",
        },
      },
      { googleApiRequest: request }
    );
    assertX.equal(calls[0].headers, undefined);
    assertX.deepEqual(calls[1].headers, { "login-customer-id": "9990001111" });
    assertX.equal(calls[1].headers["login-customer-id"] === "1234567890", false);
  });

  check("ADS-MCP-15 USER_PERMISSION_DENIED remains safe/actionable", async () => {
    const err = new Error("GOOGLE_ADS_API_ERROR\ncode: USER_PERMISSION_DENIED");
    err.code = "GOOGLE_ADS_CUSTOMER_UNAUTHORIZED";
    err.googleAds = { code: "USER_PERMISSION_DENIED" };
    await assertX.rejects(
      () =>
        registry().executeTool(
          {
            provider: "google_ads",
            toolId: "search",
            credentialId: "cred-ads",
            params: {
              customerId: "1234567890",
              query: "SELECT campaign.id FROM campaign",
            },
          },
          {
            googleApiRequest: async () => {
              throw err;
            },
          }
        ),
      (error) => {
        assertX.equal(error.code, "USER_PERMISSION_DENIED");
        assertX.match(error.message, /customer ID/i);
        assertX.equal(/authorization|bearer|ya29|developer-token:/i.test(error.message), false);
        return true;
      }
    );
  });

  check("ADS-MCP-16 invalid GAQL produces safe query error", async () => {
    let calls = 0;
    await assertX.rejects(
      () =>
        registry().executeTool(
          {
            provider: "google_ads",
            toolId: "search",
            credentialId: "cred-ads",
            params: {
              customerId: "1234567890",
              query: "UPDATE campaign SET campaign.status = PAUSED",
            },
          },
          {
            googleApiRequest: async () => {
              calls += 1;
              return { body: {} };
            },
          }
        ),
      (error) => {
        assertX.equal(error.code, "GOOGLE_ADS_QUERY");
        assertX.match(error.message, /SELECT/);
        return true;
      }
    );
    assertX.equal(calls, 0);
    const googleErr = new Error("queryError");
    googleErr.code = "GOOGLE_ADS_QUERY";
    googleErr.googleAds = { code: "UNRECOGNIZED_FIELD" };
    await assertX.rejects(
      () =>
        registry().executeTool(
          {
            provider: "google_ads",
            toolId: "search",
            credentialId: "cred-ads",
            params: {
              customerId: "1234567890",
              query: "SELECT not_a_field FROM campaign",
            },
          },
          {
            googleApiRequest: async () => {
              throw googleErr;
            },
          }
        ),
      (error) => {
        assertX.equal(error.code, "GOOGLE_ADS_QUERY");
        assertX.match(error.message, /field names/);
        return true;
      }
    );
  });

  check("ADS-MCP-17 no mutation endpoint exists/reachable", () => {
    const source = read("../../plugins/google-ads-mcp/src/executor.js");
    assertX.equal(source.includes("googleAds:mutate"), false);
    assertX.equal(source.includes(":mutate"), false);
    assertX.equal(source.includes("customers:mutate"), false);
    assertX.match(source, /googleAds:search/);
    assertX.match(source, /googleAdsFields:search/);
    assertX.match(source, /customers:listAccessibleCustomers/);
    const host = read("../services/workflowGoogleAdsMcp.service.js");
    assertX.match(host, /plugins\/google-ads-mcp/);
    assertX.equal(host.includes("googleAds:search"), false);
    const native = read("../services/workflowGoogleAds.service.js");
    assertX.equal(native.includes("googleAds:mutate"), false);
  });

  check("ADS-MCP-18 credentialId only persists", () => {
    const saved = registry().sanitizeDynamicMcpNodeData({
      provider: "google_ads",
      toolId: "search",
      credentialId: "cred-ads",
      developerToken: "should-drop",
      accessToken: "ya29.secret",
      params: {
        customerId: "1234567890",
        query: "SELECT campaign.id FROM campaign",
        refreshToken: "drop-me",
      },
    });
    assertX.equal(saved.credentialId, "cred-ads");
    assertX.equal(saved.developerToken, undefined);
    assertX.equal(saved.accessToken, undefined);
    assertX.equal(saved.params.refreshToken, undefined);
    assertX.equal(saved.params.customerId, "1234567890");
  });

  check("ADS-MCP-19 tokens/developer token never appear in saved workflow/output", async () => {
    const result = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "search",
        credentialId: "cred-ads",
        params: {
          customerId: "1234567890",
          query: "SELECT campaign.id FROM campaign",
        },
      },
      {
        googleApiRequest: async () => ({
          body: {
            results: [
              {
                campaign: { id: "1" },
                accessToken: "ya29.LEAK",
                developerToken: "DEV-LEAK",
                note: "Bearer ya29.LEAKEDTOKEN",
              },
            ],
          },
        }),
      }
    );
    const text = JSON.stringify(result);
    assertX.equal(text.includes("ya29"), false);
    assertX.equal(text.includes("DEV-LEAK"), false);
    assertX.equal(text.includes("accessToken"), false);
    assertX.equal(text.includes("developerToken"), false);
    assertX.equal(result.items[0].json.campaign.id, "1");
  });

  check("ADS-MCP-20 existing native Google Ads node remains unchanged", () => {
    const reports = Object.keys(nativeAds().REPORTS);
    assertX.deepEqual(reports, [
      "campaign_performance",
      "ad_group_performance",
      "keyword_performance",
      "search_terms",
      "device_performance",
      "geographic_performance",
      "conversion_performance",
    ]);
    const mcpIds = registry()
      .listTools({ provider: "google_ads", exposure: "all" })
      .map((tool) => tool.id);
    for (const report of reports) {
      assertX.equal(mcpIds.includes(report), true);
      assertX.equal(
        registry().getToolDefinition("google_ads", report).uiGroup,
        "performance"
      );
    }
    const native = read("../services/workflowGoogleAds.service.js");
    assertX.match(native, /googleAds:search/);
    assertX.equal(native.includes("googleAds:mutate"), false);
    assertX.equal(native.includes("googleAdsMcpTool"), false);
    assertX.equal(typeof nativeAds().runGoogleAdsReport, "function");
    assertX.equal(typeof nativeAds().buildReportQuery, "function");
  });

  check("ADS-MCP-21 existing GSC Inspect URL dynamic tool remains working", async () => {
    const inspect = registry().getToolDefinition(
      "google_search_console",
      "inspect_url_enhanced"
    );
    assertX.equal(inspect.implemented, true);
    assertX.equal(inspect.authType, "google_gsc");
    let adsCalled = false;
    const result = await registry().executeTool(
      {
        provider: "google_search_console",
        toolId: "inspect_url_enhanced",
        credentialId: "cred-gsc",
        params: {
          siteUrl: "https://example.com/",
          inspectionUrl: "https://example.com/page",
        },
      },
      {
        executeGscMcpTool: async (args) => {
          assertX.equal(args.toolId, "inspect_url_enhanced");
          return {
            ok: true,
            data: { inspectionUrl: args.toolArgs.inspectionUrl, indexStatus: "Submitted and indexed" },
          };
        },
        googleApiRequest: async () => {
          adsCalled = true;
          return { body: {} };
        },
      }
    );
    assertX.equal(adsCalled, false);
    assertX.equal(result.items[0].json.indexStatus, "Submitted and indexed");
  });

  check("ADS-MCP-22 GA4 MCP regression", async () => {
    const dropdown = registry().listTools({ provider: "google_analytics" });
    assertX.ok(dropdown.length > 0);
    assertX.equal(dropdown.every((tool) => tool.implemented === false), true);
    assertX.equal(
      dropdown.some((tool) => tool.id === "run_predictive_analysis"),
      false
    );
    let called = false;
    await assertX.rejects(
      () =>
        registry().executeTool(
          {
            provider: "google_analytics",
            toolId: "run_realtime_report",
            credentialId: "cred-ga4",
            params: { propertyId: "123" },
          },
          {
            googleApiRequest: async () => {
              called = true;
              return { body: {} };
            },
          }
        ),
      (error) => error.code === "MCP_TOOL_UNAVAILABLE"
    );
    assertX.equal(called, false);
  });

  const grounding = () => require("../services/workflowGoogleAdsAiGrounding");

  const searchRow = (resource, fields) => ({
    ...fields,
    _meta: {
      provider: "google_ads",
      tool: "search",
      resource,
      customerId: "7887133215",
      apiVersion: "v25",
    },
  });

  const crossProvider = /GA4|GSC|Search Console|Landing Underperformance|landing_underperformance|landingPage/;

  check("ADS-MCP-G1 search FROM campaign uses campaign terminology", () => {
    const row = searchRow("campaign", {
      campaign: { id: "11", name: "Brand" },
      metrics: { clicks: "4" },
    });
    const grounded = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "Summarize",
      userPrompt: "",
      input: [{ json: row }],
    });
    const report = grounding().formatGoogleAdsReport([row]);
    assertX.equal(grounded.entity, "campaign");
    assertX.match(grounded.systemPrompt, /report: Campaign\n/);
    assertX.equal(grounded.systemPrompt.includes("Campaign Performance"), false);
    assertX.match(grounded.systemPrompt, /Available fields: campaign\.id, campaign\.name, metrics\.clicks/);
    assertX.equal(grounded.systemPrompt.includes("campaignName"), false);
    assertX.equal(grounded.systemPrompt.includes("impressions"), false);
    assertX.match(report, /Campaign/);
    assertX.match(report, /campaign\.name: Brand/);
    assertX.match(report, /metrics\.clicks: 4/);
    assertX.equal(report.includes("Campaign Performance"), false);
    assertX.equal(report.includes("campaignName"), false);
    assertX.equal(crossProvider.test(grounded.systemPrompt), false);
    assertX.equal(crossProvider.test(report), false);
  });

  check("ADS-MCP-G2 search FROM ad_group uses ad group terminology", () => {
    const row = searchRow("ad_group", { adGroup: { id: "9", name: "Shoes" } });
    const grounded = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    const report = grounding().formatGoogleAdsReport([row]);
    assertX.equal(grounded.entity, "ad group");
    assertX.match(grounded.systemPrompt, /report: Ad Group\n/);
    assertX.equal(grounded.systemPrompt.includes("Campaign Performance"), false);
    assertX.match(report, /Ad Group/);
    assertX.match(report, /adGroup\.name: Shoes/);
    assertX.equal(report.includes("Campaign Performance"), false);
    assertX.equal(crossProvider.test(grounded.systemPrompt), false);
    assertX.equal(crossProvider.test(report), false);
  });

  check("ADS-MCP-G3 search FROM asset is generic Google Ads Asset Data", () => {
    const row = searchRow("asset", { asset: { id: "3", name: "Logo" } });
    const grounded = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    const report = grounding().formatGoogleAdsReport([row]);
    assertX.match(grounded.systemPrompt, /resource: asset/);
    assertX.match(grounded.systemPrompt, /report: Google Ads Asset Data/);
    assertX.equal(grounded.systemPrompt.includes("Campaign Performance"), false);
    assertX.match(grounded.systemPrompt, /Available fields: asset\.id, asset\.name/);
    assertX.match(report, /Google Ads Asset Data/);
    assertX.match(report, /asset\.name: Logo/);
    assertX.equal(report.includes("Campaign Performance"), false);
    const customer = searchRow("customer", { customer: { id: "7887133215" } });
    const customerGround = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: customer }],
    });
    assertX.match(customerGround.systemPrompt, /report: Google Ads Customer Data/);
    const ad = searchRow("ad_group_ad", { adGroupAd: { ad: { id: "5" } } });
    const adGround = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: ad }],
    });
    assertX.match(adGround.systemPrompt, /report: Google Ads Ad Group Ad Data/);
    assertX.match(adGround.systemPrompt, /Available fields: adGroupAd\.ad\.id/);
    assertX.equal(crossProvider.test(grounded.systemPrompt + report), false);
  });

  check("ADS-MCP-G4 unknown resource is Google Ads Search Results", () => {
    for (const resource of ["search", ""]) {
      const row = searchRow(resource, { customer: { id: "1" } });
      if (!resource) delete row._meta.resource;
      const grounded = grounding().applyGoogleAdsAiGrounding({
        systemPrompt: "",
        userPrompt: "",
        input: [{ json: row }],
      });
      const report = grounding().formatGoogleAdsReport([row]);
      assertX.match(grounded.systemPrompt, /report: Google Ads Search Results/);
      assertX.equal(grounded.entity, "search");
      assertX.equal(grounded.systemPrompt.includes("Campaign Performance"), false);
      assertX.match(report, /Google Ads Search Results/);
      assertX.equal(report.includes("Campaign Performance"), false);
      assertX.equal(crossProvider.test(grounded.systemPrompt + report), false);
    }
  });

  check("ADS-MCP-G5 search grounding has no GA4 or GSC terminology", () => {
    const row = searchRow("asset", { asset: { id: "3" } });
    const grounded = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "Summarize the rows.",
      userPrompt: "{{input}}",
      input: [{ json: row }],
    });
    const report = grounding().formatGoogleAdsReport([row]);
    assertX.equal(crossProvider.test(grounded.systemPrompt), false);
    assertX.equal(crossProvider.test(report), false);
    assertX.equal(grounded.systemPrompt.includes("Campaign Performance"), false);
    assertX.equal(report.includes("Campaign Performance"), false);
  });

  check("ADS-MCP-G6 native Campaign Performance report stays unchanged", () => {
    const row = {
      source: "google_ads",
      provider: "google_ads",
      reportType: "campaign_performance",
      campaignId: "11",
      campaignName: "Brand",
      impressions: 100,
      clicks: 10,
      ctr: 0.1,
      _meta: {
        provider: "google_ads",
        resource: "campaign",
        report: "campaign_performance",
        customerId: "7887133215",
      },
    };
    const grounded = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "Summarize the rows.",
      userPrompt: "",
      input: [{ json: row }],
    });
    const report = grounding().formatGoogleAdsReport([row]);
    assertX.equal(grounded.entity, "campaign");
    assertX.match(grounded.systemPrompt, /report: Campaign Performance/);
    assertX.match(grounded.systemPrompt, /Campaign rows use campaign vocabulary/);
    assertX.match(report, /Campaign Performance/);
    assertX.match(report, /Campaign: Brand/);
    assertX.match(report, /Impressions: 100/);
    assertX.equal(report.includes("Google Ads Search Results"), false);
  });

  check("ADS-MCP-G7 list_accessible_customers grounding stays unchanged", () => {
    const row = {
      customerResourceName: "customers/7887133215",
      customerId: "7887133215",
      _meta: {
        provider: "google_ads",
        resource: "customer",
        tool: "list_accessible_customers",
        apiVersion: "v25",
      },
    };
    const grounded = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    const report = grounding().formatGoogleAdsReport([row]);
    assertX.equal(grounded.entity, "campaign");
    assertX.match(grounded.systemPrompt, /report: Campaign Performance/);
    assertX.equal(grounded.systemPrompt.includes("tool: search"), false);
    assertX.equal(grounded.systemPrompt.includes("Google Ads Customer Data"), false);
    assertX.match(report, /Campaign Performance/);
    assertX.equal(report.includes("Google Ads Customer Data"), false);
  });

  check("ADS-MCP-G8 get_resource_metadata grounding stays unchanged", () => {
    const row = {
      name: "metrics.clicks",
      category: "METRIC",
      dataType: "INT64",
      selectable: true,
      _meta: {
        provider: "google_ads",
        resource: "metadata",
        tool: "get_resource_metadata",
        apiVersion: "v25",
      },
    };
    const grounded = grounding().applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    const report = grounding().formatGoogleAdsReport([row]);
    assertX.equal(grounded.entity, "campaign");
    assertX.match(grounded.systemPrompt, /report: Campaign Performance/);
    assertX.equal(grounded.systemPrompt.includes("tool: search"), false);
    assertX.equal(grounded.systemPrompt.includes("Google Ads Search Results"), false);
    assertX.match(report, /Campaign Performance/);
    assertX.equal(report.includes("Google Ads Search Results"), false);
  });

  const adsNode = (toolId, params = {}, extra = {}) => ({
    id: "ads-mcp-node",
    type: "googleAdsMcpTool",
    data: {
      label: "Google Ads MCP Tools",
      nodeType: "googleAdsMcpTool",
      toolId,
      params,
      ...extra,
    },
  });

  const sourceNode = (id, data = {}) => ({
    id,
    type: "googleAds",
    data: {
      nodeType: "googleAds",
      label: data.label || "Google Ads",
      credentialId: "cred-ads",
      customerId: "1234567890",
      loginCustomerId: "",
      ...data,
    },
  });

  const sourceContext = (nodes, extra = {}) => ({
    graph: { nodes },
    inputItems: [],
    ...extra,
  });

  check("ADS-MCP-NODE-6 tool dropdown keeps advanced tools grouped", () => {
    const tools = registry().listTools({ provider: "google_ads" });
    const advanced = tools.filter((tool) => tool.uiGroup === "advanced");
    assertX.deepEqual(
      advanced.map((tool) => tool.id),
      ["get_resource_metadata", "search"]
    );
    for (const tool of advanced) {
      assertX.equal(tool.authType, "google_ads");
      assertX.equal(tool.implemented, true);
    }
  });

  check("ADS-MCP-NODE-7/8 dedicated node hides account fields and keeps schemas", () => {
    const ui = read("../../frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /lockedProvider/);
    assertX.match(ui, /googleAdsSourceFieldState/);
    assertX.match(ui, /Google Ads Source/);
    assertX.match(ui, /ACCOUNT_PARAM_NAMES/);
    assertX.equal(ui.includes("Google Ads Account"), false);
    const renderer = read("../../frontend/src/components/workflows/params/NodeParameterRenderer.tsx");
    assertX.match(renderer, /lockedProvider="google_ads"/);
    const search = registry().describeInputFields(
      registry().getToolDefinition("google_ads", "search").inputSchema
    );
    assertX.deepEqual(
      search.map((fieldRow) => fieldRow.name),
      ["customerId", "loginCustomerId", "query", "limit", "returnAll"]
    );
    assertX.equal(search.find((fieldRow) => fieldRow.name === "customerId").required, true);
    assertX.equal(search.find((fieldRow) => fieldRow.name === "query").required, true);
    assertX.equal(search.find((fieldRow) => fieldRow.name === "loginCustomerId").required, false);
    const listed = registry().describeInputFields(
      registry().getToolDefinition("google_ads", "list_accessible_customers").inputSchema
    );
    assertX.deepEqual(listed, []);
  });

  check("ADS-MCP-NODE-9/10/11 dedicated node executes the three tools", async () => {
    const calls = [];
    const deps = {
      googleApiRequest: async (spec) => {
        calls.push(spec);
        if (String(spec.url).includes("listAccessibleCustomers")) {
          return { body: { resourceNames: ["customers/1234567890"] } };
        }
        if (String(spec.url).includes("googleAdsFields:search")) {
          return { body: { results: [{ name: "metrics.clicks", category: "METRIC", dataType: "INT64" }] } };
        }
        return { body: { results: [{ campaign: { id: "11", name: "Brand" }, metrics: { clicks: "4" } }] } };
      },
    };
    const ctx = sourceContext([sourceNode("ads-source")]);
    const listed = await registry().executeGoogleAdsMcpNode(
      adsNode("list_accessible_customers"),
      ctx,
      deps
    );
    const meta = await registry().executeGoogleAdsMcpNode(
      adsNode("get_resource_metadata", { resourceOrField: "metrics.clicks" }),
      ctx,
      deps
    );
    const searched = await registry().executeGoogleAdsMcpNode(
      adsNode("search", {
        query: "SELECT campaign.id, campaign.name, metrics.clicks FROM campaign",
        limit: 5,
      }),
      ctx,
      deps
    );
    assertX.equal(listed.items[0].json.customerId, "1234567890");
    assertX.equal(meta.items[0].json.name, "metrics.clicks");
    assertX.equal(searched.items[0].json.campaign.name, "Brand");
    assertX.equal(calls.length, 3);
    assertX.ok(calls[0].url.includes("customers:listAccessibleCustomers"));
    assertX.ok(calls[1].url.includes("googleAdsFields:search"));
    assertX.ok(calls[2].url.includes("/googleAds:search"));
    assertX.equal(JSON.stringify(calls).includes("mutate"), false);
    assertX.equal(adsNode("search").data.provider, undefined);
  });

  check("ADS-MCP-NODE-12 dedicated node provenance stays google_ads", async () => {
    const result = await registry().executeGoogleAdsMcpNode(
      adsNode("search", {
        query: "SELECT campaign.id FROM campaign",
      }),
      sourceContext([sourceNode("ads-source")]),
      {
        googleApiRequest: async () => ({
          body: { results: [{ campaign: { id: "11" } }] },
        }),
      }
    );
    assertX.equal(result.items[0].json._meta.provider, "google_ads");
    assertX.equal(result.items[0].json._meta.tool, "search");
    assertX.equal(result.items[0].json._meta.resource, "campaign");
    assertX.equal(result.items[0].json._meta.customerId, "1234567890");
    assertX.equal(result.items[0].json._meta.apiVersion, "v25");
  });

  check("ADS-MCP-NODE-13 search grounding uses the actual resource", () => {
    const grounding = require("../services/workflowGoogleAdsAiGrounding");
    const row = {
      asset: { id: "3", name: "Logo" },
      _meta: {
        provider: "google_ads",
        tool: "search",
        resource: "asset",
        apiVersion: "v25",
      },
    };
    const grounded = grounding.applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    assertX.match(grounded.systemPrompt, /report: Google Ads Asset Data/);
    assertX.equal(grounded.systemPrompt.includes("Campaign Performance"), false);
    assertX.equal(/GA4|GSC|Search Console/.test(grounded.systemPrompt), false);
  });

  check("ADS-MCP-NODE-15/16 old dynamic Google Ads nodes still execute and save", async () => {
    const calls = [];
    const result = await registry().executeDynamicMcpNode(
      {
        id: "legacy-ads",
        type: "mcpDynamicTool",
        data: {
          provider: "google_ads",
          toolId: "list_accessible_customers",
          credentialId: "cred-ads",
          params: {},
          accessToken: "should-strip",
        },
      },
      {},
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { resourceNames: ["customers/1234567890"] } };
        },
      }
    );
    assertX.equal(result.items[0].json._meta.tool, "list_accessible_customers");
    assertX.equal(calls.length, 1);
    const workflows = require("../modules/workflows/workflows.service");
    const legacy = {
      version: 1,
      nodes: [
        {
          id: "legacy-ads",
          type: "mcpDynamicTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "mcpDynamicTool",
            provider: "google_ads",
            toolId: "search",
            credentialId: "cred-ads",
            params: { customerId: "1234567890", query: "SELECT campaign.id FROM campaign" },
            developerToken: "legacy-secret",
          },
        },
      ],
      edges: [],
    };
    workflows.validateDefinition(legacy);
    assertX.equal(legacy.nodes[0].data.provider, "google_ads");
    assertX.equal(legacy.nodes[0].data.toolId, "search");
    assertX.equal(legacy.nodes[0].data.credentialId, "cred-ads");
    assertX.equal(legacy.nodes[0].data.developerToken, undefined);
    const dedicated = {
      version: 1,
      nodes: [
        {
          id: "ads-mcp-node",
          type: "googleAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "googleAdsMcpTool",
            provider: "google_ads",
            toolId: "search",
            credentialId: "cred-ads",
            googleAdsSourceNodeId: "ads-source",
            params: {
              query: "SELECT campaign.id FROM campaign",
              customerId: "1234567890",
              loginCustomerId: "1234567890",
            },
            accessToken: "should-strip",
          },
        },
      ],
      edges: [],
    };
    workflows.validateDefinition(dedicated);
    assertX.equal(dedicated.nodes[0].data.provider, undefined);
    assertX.equal(dedicated.nodes[0].data.toolId, "search");
    assertX.equal(dedicated.nodes[0].data.credentialId, undefined);
    assertX.equal(dedicated.nodes[0].data.googleAdsSourceNodeId, "ads-source");
    assertX.equal(dedicated.nodes[0].data.params.customerId, undefined);
    assertX.equal(dedicated.nodes[0].data.params.loginCustomerId, undefined);
    assertX.equal(dedicated.nodes[0].data.accessToken, undefined);
    assertX.equal(workflows.ALLOWED_NODE_TYPES.has("googleAdsMcpTool"), true);
    assertX.equal(workflows.ALLOWED_NODE_TYPES.has("mcpDynamicTool"), true);
  });

  check("ADS-MCP-NODE-20 dedicated node has no mutation endpoint", async () => {
    let called = false;
    await assertX.rejects(
      () =>
        registry().executeGoogleAdsMcpNode(
          adsNode("search", {
            query: "UPDATE campaign SET campaign.status = 'PAUSED'",
          }),
          sourceContext([sourceNode("ads-source")]),
          {
            googleApiRequest: async () => {
              called = true;
              return { body: {} };
            },
          }
        ),
      (error) => error.code === "GOOGLE_ADS_QUERY"
    );
    assertX.equal(called, false);
    const src = read("../../plugins/google-ads-mcp/src/executor.js");
    assertX.equal(src.includes("googleAds:mutate"), false);
    const native = read("../services/workflowGoogleAds.service.js");
    assertX.equal(native.includes("googleAdsMcpTool"), false);
    assertX.equal(native.includes("googleAds:mutate"), false);
  });

  check("ADS-MCP-23 GSC MCP regression", () => {
    const gsc = registry().listTools({ provider: "google_search_console" });
    assertX.deepEqual(gsc.map((tool) => tool.id), ["inspect_url_enhanced"]);
    const host = read("../services/mcpPluginHost.service.js");
    assertX.match(host, /executeGscMcpTool/);
    const plugin = read("../../plugins/gsc-mcp/src/contracts/capabilities.js");
    assertX.match(plugin, /inspect_url_enhanced/);
  });

  check("ADS-MCP-V2A-1 one Google Ads node binds automatically", async () => {
    const calls = [];
    const result = await registry().executeGoogleAdsMcpNode(
      adsNode("search", { query: "SELECT campaign.id FROM campaign" }),
      sourceContext([sourceNode("only-ads")], { inputItems: [{ json: { credentialId: "from-item" } }] }),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].credentialId, "cred-ads");
    assertX.equal(calls[0].url.includes("/customers/1234567890/"), true);
    assertX.equal(result.items[0].json._meta.customerId, "1234567890");
    assertX.equal(adsNode("search").data.googleAdsSourceNodeId, undefined);
  });

  check("ADS-MCP-V2A-2 one Google Ads node hides Google Ads Source", () => {
    const state = adsMcp().googleAdsSourceFieldState(
      [sourceNode("only-ads", { label: "Main account" })],
      ""
    );
    assertX.equal(state.showSelector, false);
    assertX.equal(state.message, null);
    assertX.equal(state.sources.length, 1);
    const ui = read("../../frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /sourceState\?\.showSelector/);
    assertX.match(ui, /Google Ads Source/);
  });

  check("ADS-MCP-V2A-3 multiple Google Ads nodes show the source selector", () => {
    const state = adsMcp().googleAdsSourceFieldState(
      [
        sourceNode("ads-a", { label: "Brand" }),
        sourceNode("ads-b", { label: "Retail" }),
      ],
      ""
    );
    assertX.equal(state.showSelector, true);
    assertX.deepEqual(
      state.sources.map((row) => `${row.label} (${row.id})`),
      ["Brand (ads-a)", "Retail (ads-b)"]
    );
    assertX.equal(state.message, null);
  });

  check("ADS-MCP-V2A-4 selected source node id persists", async () => {
    const workflows = require("../modules/workflows/workflows.service");
    const definition = {
      version: 1,
      nodes: [
        {
          id: "ads-mcp-node",
          type: "googleAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "googleAdsMcpTool",
            toolId: "search",
            googleAdsSourceNodeId: "ads-b",
            credentialId: "should-not-persist",
            params: { query: "SELECT campaign.id FROM campaign" },
          },
        },
      ],
      edges: [],
    };
    workflows.validateDefinition(definition);
    assertX.equal(definition.nodes[0].data.googleAdsSourceNodeId, "ads-b");
    assertX.equal(definition.nodes[0].data.credentialId, undefined);
    const calls = [];
    await registry().executeGoogleAdsMcpNode(
      adsNode("search", { query: "SELECT campaign.id FROM campaign" }, {
        googleAdsSourceNodeId: "ads-b",
      }),
      sourceContext([
        sourceNode("ads-a", { credentialId: "cred-a", customerId: "1111111111" }),
        sourceNode("ads-b", { credentialId: "cred-b", customerId: "2222222222" }),
      ]),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].credentialId, "cred-b");
    assertX.equal(calls[0].url.includes("/customers/2222222222/"), true);
  });

  check("ADS-MCP-V2A-5 no Google Ads node returns an actionable validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeGoogleAdsMcpNode(
          adsNode("search", { query: "SELECT campaign.id FROM campaign" }),
          sourceContext([]),
          { googleApiRequest: async () => ({ body: {} }) }
        ),
      (error) => error.message === "Add and configure a Google Ads node first."
    );
    const state = adsMcp().googleAdsSourceFieldState([], "");
    assertX.equal(state.showSelector, false);
    assertX.equal(state.message, "Add and configure a Google Ads node first.");
  });

  check("ADS-MCP-V2A-6 deleted source node returns an actionable validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeGoogleAdsMcpNode(
          adsNode("search", { query: "SELECT campaign.id FROM campaign" }, {
            googleAdsSourceNodeId: "gone",
          }),
          sourceContext([sourceNode("still-here")]),
          { googleApiRequest: async () => ({ body: {} }) }
        ),
      (error) =>
        error.message === "The selected Google Ads source is no longer in this workflow."
    );
  });

  check("ADS-MCP-V2A-7 missing source credential returns validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeGoogleAdsMcpNode(
          adsNode("search", { query: "SELECT campaign.id FROM campaign" }),
          sourceContext([sourceNode("ads-source", { credentialId: "" })]),
          { googleApiRequest: async () => ({ body: {} }) }
        ),
      (error) =>
        error.message === "Configure a Google Ads credential on the selected Google Ads node."
    );
  });

  check("ADS-MCP-V2A-8 missing source customerId returns validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeGoogleAdsMcpNode(
          adsNode("search", { query: "SELECT campaign.id FROM campaign" }),
          sourceContext([sourceNode("ads-source", { customerId: "  " })]),
          { googleApiRequest: async () => ({ body: {} }) }
        ),
      (error) => error.message === "Configure a Customer ID on the selected Google Ads node."
    );
  });

  check("ADS-MCP-V2A-9 credentialId is inherited server-side", async () => {
    const calls = [];
    await registry().executeGoogleAdsMcpNode(
      adsNode("get_resource_metadata", { resourceOrField: "metrics.clicks" }),
      sourceContext([
        sourceNode("ads-source", { credentialId: "{{input.credentialId}}" }),
      ], { input: { credentialId: "cred-from-source" } }),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ name: "metrics.clicks", category: "METRIC" }] } };
        },
      }
    );
    assertX.equal(calls[0].credentialId, "cred-from-source");
    assertX.equal(JSON.stringify(calls[0]).includes("accessToken"), false);
  });

  check("ADS-MCP-V2A-10 customerId is inherited server-side", async () => {
    const calls = [];
    await registry().executeGoogleAdsMcpNode(
      adsNode("search", {
        query: "SELECT campaign.id FROM campaign",
        customerId: "9999999999",
      }),
      sourceContext(
        [sourceNode("ads-source", { customerId: "{{input.customerId}}" })],
        {
          input: { customerId: "1234567890" },
          inputItems: [{ json: { customerId: "8888888888", accessToken: "ya29.item-secret" } }],
        }
      ),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].url.includes("/customers/1234567890/"), true);
    assertX.equal(calls[0].url.includes("9999999999"), false);
    assertX.equal(calls[0].url.includes("8888888888"), false);
  });

  check("ADS-MCP-V2A-11 loginCustomerId is inherited only when non-blank", async () => {
    const calls = [];
    const deps = {
      googleApiRequest: async (spec) => {
        calls.push(spec);
        return { body: { results: [{ campaign: { id: "11" } }] } };
      },
    };
    await registry().executeGoogleAdsMcpNode(
      adsNode("search", { query: "SELECT campaign.id FROM campaign" }),
      sourceContext([sourceNode("ads-source", { loginCustomerId: "1098765432" })]),
      deps
    );
    assertX.equal(calls[0].headers["login-customer-id"], "1098765432");
    calls.length = 0;
    await registry().executeGoogleAdsMcpNode(
      adsNode("search", { query: "SELECT campaign.id FROM campaign" }),
      sourceContext([sourceNode("ads-source", { loginCustomerId: "" })]),
      deps
    );
    assertX.equal(calls[0].headers, undefined);
  });

  check("ADS-MCP-V2A-12 customerId is never copied into loginCustomerId", async () => {
    const calls = [];
    await registry().executeGoogleAdsMcpNode(
      adsNode("search", {
        query: "SELECT campaign.id FROM campaign",
        loginCustomerId: "1234567890",
      }),
      sourceContext([sourceNode("ads-source", { customerId: "1234567890", loginCustomerId: "" })]),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].headers, undefined);
    assertX.equal(JSON.stringify(calls[0].headers || {}).includes("1234567890"), false);
  });

  check("ADS-MCP-V2A-13/14/15 dedicated node does not persist account fields", () => {
    const workflows = require("../modules/workflows/workflows.service");
    const definition = {
      version: 1,
      nodes: [
        {
          id: "ads-mcp-node",
          type: "googleAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "googleAdsMcpTool",
            toolId: "search",
            credentialId: "cred-ads",
            customerId: "1234567890",
            loginCustomerId: "1098765432",
            params: {
              query: "SELECT campaign.id FROM campaign",
              customerId: "1234567890",
              loginCustomerId: "1098765432",
              credentialId: "cred-ads",
            },
          },
        },
      ],
      edges: [],
    };
    workflows.validateDefinition(definition);
    const saved = definition.nodes[0].data;
    assertX.equal(saved.credentialId, undefined);
    assertX.equal(saved.customerId, undefined);
    assertX.equal(saved.loginCustomerId, undefined);
    assertX.equal(saved.params.credentialId, undefined);
    assertX.equal(saved.params.customerId, undefined);
    assertX.equal(saved.params.loginCustomerId, undefined);
    assertX.equal(saved.params.query, "SELECT campaign.id FROM campaign");
  });

  check("ADS-MCP-V2A-16 list_accessible_customers is hidden from the normal tool list", () => {
    const ids = registry().listTools({ provider: "google_ads" }).map((tool) => tool.id);
    assertX.equal(ids.includes("list_accessible_customers"), false);
    const hidden = registry().getToolDefinition("google_ads", "list_accessible_customers");
    assertX.equal(hidden.uiGroup, "internal");
    assertX.equal(hidden.implemented, true);
  });

  check("ADS-MCP-V2A-17 list_accessible_customers executor remains callable", async () => {
    const result = await registry().executeTool(
      {
        provider: "google_ads",
        toolId: "list_accessible_customers",
        credentialId: "cred-ads",
        params: {},
      },
      {
        googleApiRequest: async () => ({
          body: { resourceNames: ["customers/1234567890"] },
        }),
      }
    );
    assertX.equal(result.items[0].json.customerId, "1234567890");
    assertX.equal(result.items[0].json._meta.tool, "list_accessible_customers");
  });

  check("ADS-MCP-V2A-18 get_resource_metadata is Advanced", () => {
    const tool = registry().getToolDefinition("google_ads", "get_resource_metadata");
    assertX.equal(tool.uiGroup, "advanced");
    assertX.equal(
      registry().listTools({ provider: "google_ads" }).some((row) => row.id === tool.id),
      true
    );
  });

  check("ADS-MCP-V2A-19 search is Advanced", () => {
    const tool = registry().getToolDefinition("google_ads", "search");
    assertX.equal(tool.uiGroup, "advanced");
    const ui = read("../../frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /Advanced/);
    assertX.match(ui, /Common/);
  });

  check("ADS-MCP-V2A-20 GAQL search remains SELECT-only", async () => {
    let called = false;
    await assertX.rejects(
      () =>
        registry().executeGoogleAdsMcpNode(
          adsNode("search", { query: "UPDATE campaign SET campaign.status = 'PAUSED'" }),
          sourceContext([sourceNode("ads-source")]),
          {
            googleApiRequest: async () => {
              called = true;
              return { body: {} };
            },
          }
        ),
      (error) => error.code === "GOOGLE_ADS_QUERY"
    );
    assertX.equal(called, false);
  });

  check("ADS-MCP-V2A-21 legacy dynamic Google Ads node still executes", async () => {
    const calls = [];
    const result = await registry().executeDynamicMcpNode(
      {
        id: "legacy-ads",
        type: "mcpDynamicTool",
        data: {
          provider: "google_ads",
          toolId: "search",
          credentialId: "cred-legacy",
          params: {
            customerId: "1234567890",
            loginCustomerId: "1098765432",
            query: "SELECT campaign.id FROM campaign",
          },
        },
      },
      { graph: { nodes: [] } },
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].credentialId, "cred-legacy");
    assertX.equal(calls[0].url.includes("/customers/1234567890/"), true);
    assertX.equal(calls[0].headers["login-customer-id"], "1098765432");
    assertX.equal(result.items[0].json._meta.provider, "google_ads");
    assertX.equal(result.items[0].json._meta.tool, "search");
  });

  check("ADS-MCP-V2A-22 native Google Ads node is unchanged", () => {
    assertX.deepEqual(Object.keys(nativeAds().REPORTS), [
      "campaign_performance",
      "ad_group_performance",
      "keyword_performance",
      "search_terms",
      "device_performance",
      "geographic_performance",
      "conversion_performance",
    ]);
    const native = read("../services/workflowGoogleAds.service.js");
    assertX.equal(native.includes("googleAdsMcpTool"), false);
    assertX.equal(native.includes("googleAdsSourceNodeId"), false);
    assertX.equal(native.includes("googleAds:mutate"), false);
  });

  check("ADS-MCP-V2A-23 GA4 MCP is unchanged", () => {
    const ga4 = registry().listTools({ provider: "google_analytics" });
    assertX.ok(ga4.some((tool) => tool.id === "run_realtime_report"));
    assertX.equal(ga4.every((tool) => tool.uiGroup === "common"), true);
    assertX.equal(ga4.some((tool) => tool.id === "search"), false);
    const plugin = read("../../plugins/ga4-mcp/src/index.js");
    assertX.equal(plugin.includes("google_ads"), false);
  });

  check("ADS-MCP-V2A-24 GSC MCP is unchanged", () => {
    const gsc = registry().listTools({ provider: "google_search_console" });
    assertX.deepEqual(gsc.map((tool) => tool.id), ["inspect_url_enhanced"]);
    assertX.equal(gsc[0].uiGroup, "common");
    const plugin = read("../../plugins/gsc-mcp/src/contracts/capabilities.js");
    assertX.match(plugin, /inspect_url_enhanced/);
    assertX.equal(plugin.includes("googleAdsSourceNodeId"), false);
  });

  check("ADS-MCP-V2A-25 secrets stay out of MCP node data and output", async () => {
    const workflows = require("../modules/workflows/workflows.service");
    const definition = {
      version: 1,
      nodes: [
        {
          id: "ads-mcp-node",
          type: "googleAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "googleAdsMcpTool",
            toolId: "search",
            accessToken: "ya29.saved-secret",
            refreshToken: "refresh-secret",
            clientSecret: "client-secret",
            developerToken: "dev-secret",
            params: {
              query: "SELECT campaign.id FROM campaign",
              accessToken: "ya29.param-secret",
            },
          },
        },
      ],
      edges: [],
    };
    workflows.validateDefinition(definition);
    const saved = JSON.stringify(definition.nodes[0].data);
    assertX.equal(saved.includes("ya29"), false);
    assertX.equal(saved.includes("refresh-secret"), false);
    assertX.equal(saved.includes("client-secret"), false);
    assertX.equal(saved.includes("dev-secret"), false);
    const result = await registry().executeGoogleAdsMcpNode(
      adsNode("search", { query: "SELECT campaign.id FROM campaign" }),
      sourceContext(
        [
          sourceNode("ads-source", {
            accessToken: "ya29.source-secret",
            developerToken: "source-dev",
          }),
        ],
        { inputItems: [{ json: { accessToken: "ya29.item-secret", developerToken: "item-dev" } }] }
      ),
      {
        googleApiRequest: async () => ({
          body: { results: [{ campaign: { id: "11" }, accessToken: "ya29.api-secret" }] },
        }),
      }
    );
    const output = JSON.stringify(result);
    assertX.equal(output.includes("ya29"), false);
    assertX.equal(output.includes("source-dev"), false);
    assertX.equal(output.includes("item-dev"), false);
    assertX.equal(output.includes("accessToken"), false);
    assertX.equal(result.items[0].json.campaign.id, "11");
  });

  const COMMON_IDS = [
    "account_summary",
    "campaigns",
    "ad_groups",
    "ads",
    "keywords",
    "assets",
    "conversion_actions",
    "recommendations",
  ];

  check("ADS-MCP-V2B-1 Common group contains 8 tools", () => {
    const common = registry()
      .listTools({ provider: "google_ads" })
      .filter((tool) => tool.uiGroup === "common");
    assertX.deepEqual(
      common.map((tool) => tool.id),
      COMMON_IDS
    );
    assertX.deepEqual(
      common.map((tool) => tool.displayName),
      [
        "Account Summary",
        "Campaigns",
        "Ad Groups",
        "Ads",
        "Keywords",
        "Assets",
        "Conversion Actions",
        "Recommendations",
      ]
    );
    for (const tool of common) {
      assertX.equal(tool.access, "read");
      assertX.equal(tool.risk, "low");
      assertX.equal(tool.implemented, true);
    }
  });

  check("ADS-MCP-V2B-2 internal list_accessible_customers stays hidden", () => {
    const ids = registry().listTools({ provider: "google_ads" }).map((tool) => tool.id);
    assertX.equal(ids.includes("list_accessible_customers"), false);
  });

  check("ADS-MCP-V2B-3 Advanced Search remains visible", () => {
    const tool = registry().listTools({ provider: "google_ads" }).find((row) => row.id === "search");
    assertX.equal(tool.uiGroup, "advanced");
    assertX.equal(tool.implemented, true);
  });

  check("ADS-MCP-V2B-4 Advanced Metadata remains visible", () => {
    const tool = registry()
      .listTools({ provider: "google_ads" })
      .find((row) => row.id === "get_resource_metadata");
    assertX.equal(tool.uiGroup, "advanced");
    assertX.equal(tool.implemented, true);
  });

  check("ADS-MCP-V2B-5 account_summary GAQL uses customer", () => {
    const built = adsMcp().buildCommonToolQuery("account_summary", {});
    assertX.equal(built.resource, "customer");
    assertX.match(built.query, /^SELECT /);
    assertX.match(built.query, /FROM customer$/);
    for (const field of [
      "customer.id",
      "customer.descriptive_name",
      "customer.currency_code",
      "customer.time_zone",
      "customer.manager",
      "customer.status",
    ]) {
      assertX.equal(built.query.includes(field), true, field);
    }
    assertX.equal(built.query.includes("metrics."), false);
  });

  check("ADS-MCP-V2B-6 campaigns filters compile safely", () => {
    const built = adsMcp().buildCommonToolQuery("campaigns", {
      campaignId: "42",
      status: "ENABLED",
    });
    assertX.equal(built.resource, "campaign");
    assertX.match(built.query, /FROM campaign/);
    assertX.match(built.query, /campaign\.id = 42/);
    assertX.match(built.query, /campaign\.status = ENABLED/);
    assertX.equal(built.query.includes("metrics."), false);
    assertX.throws(
      () => adsMcp().buildCommonToolQuery("campaigns", { campaignId: "42 OR campaign.status = REMOVED" }),
      (error) => error.code === "GOOGLE_ADS_FILTER"
    );
    assertX.throws(
      () => adsMcp().buildCommonToolQuery("campaigns", { status: "DELETED" }),
      (error) => error.code === "GOOGLE_ADS_FILTER"
    );
  });

  check("ADS-MCP-V2B-7 ad_groups filters compile safely", () => {
    const built = adsMcp().buildCommonToolQuery("ad_groups", {
      campaignId: "7",
      adGroupId: "8",
      status: "PAUSED",
    });
    assertX.equal(built.resource, "ad_group");
    assertX.match(built.query, /FROM ad_group/);
    assertX.match(built.query, /campaign\.id = 7/);
    assertX.match(built.query, /ad_group\.id = 8/);
    assertX.match(built.query, /ad_group\.status = PAUSED/);
    assertX.equal(built.query.includes("metrics."), false);
  });

  check("ADS-MCP-V2B-8 ads uses ad_group_ad", () => {
    const built = adsMcp().buildCommonToolQuery("ads", { adId: "99", status: "ENABLED" });
    assertX.equal(built.resource, "ad_group_ad");
    assertX.match(built.query, /FROM ad_group_ad/);
    assertX.match(built.query, /ad_group_ad\.ad\.id = 99/);
    assertX.match(built.query, /ad_group_ad\.ad\.responsive_search_ad\.headlines/);
    assertX.equal(built.query.includes("metrics."), false);
  });

  check("ADS-MCP-V2B-9 keywords only return keyword criteria", () => {
    const built = adsMcp().buildCommonToolQuery("keywords", { textContains: "a'b%_" });
    assertX.equal(built.resource, "ad_group_criterion");
    assertX.match(built.query, /FROM ad_group_criterion/);
    assertX.match(built.query, /ad_group_criterion\.type = KEYWORD/);
    assertX.match(built.query, /LIKE '%a\\'b\\%\\_%'/);
    assertX.equal(built.query.includes("metrics."), false);
  });

  check("ADS-MCP-V2B-10 assets uses the asset resource", () => {
    const built = adsMcp().buildCommonToolQuery("assets", { assetType: "SITELINK" });
    assertX.equal(built.resource, "asset");
    assertX.match(built.query, /FROM asset/);
    assertX.match(built.query, /asset\.type = SITELINK/);
    assertX.equal(built.query.includes("metrics."), false);
  });

  check("ADS-MCP-V2B-11 conversion_actions uses conversion_action", () => {
    const built = adsMcp().buildCommonToolQuery("conversion_actions", {
      category: "PURCHASE",
      status: "ENABLED",
    });
    assertX.equal(built.resource, "conversion_action");
    assertX.match(built.query, /FROM conversion_action/);
    assertX.match(built.query, /conversion_action\.category = PURCHASE/);
    assertX.match(built.query, /conversion_action\.status = ENABLED/);
    assertX.equal(built.query.includes("metrics."), false);
  });

  check("ADS-MCP-V2B-12 recommendations are read only", () => {
    const built = adsMcp().buildCommonToolQuery("recommendations", {
      recommendationType: "KEYWORD",
      campaignId: "15",
    });
    assertX.equal(built.resource, "recommendation");
    assertX.match(built.query, /FROM recommendation/);
    assertX.match(built.query, /recommendation\.dismissed = FALSE/);
    assertX.match(built.query, /recommendation\.type = KEYWORD/);
    assertX.match(built.query, /campaign\.id = 15/);
    assertX.equal(/apply|mutate/i.test(built.query), false);
  });

  check("ADS-MCP-V2B-13 no recommendation apply endpoint is reachable", () => {
    const executor = read("../../plugins/google-ads-mcp/src/executor.js");
    const catalog = read("../../plugins/google-ads-mcp/src/contracts/catalog.js");
    assertX.equal(executor.includes("ApplyRecommendation"), false);
    assertX.equal(catalog.includes("ApplyRecommendation"), false);
    assertX.equal(executor.includes(":mutate"), false);
    assertX.equal(catalog.includes(":mutate"), false);
  });

  check("ADS-MCP-V2B-14 common tools inherit the source credential and customer", async () => {
    const calls = [];
    const deps = {
      googleApiRequest: async (spec) => {
        calls.push(spec);
        return { body: { results: [{ customer: { id: "1234567890" } }] } };
      },
    };
    for (const toolId of COMMON_IDS) {
      calls.length = 0;
      await registry().executeGoogleAdsMcpNode(
        adsNode(toolId, {}),
        sourceContext([sourceNode("ads-source", { loginCustomerId: "" })]),
        deps
      );
      assertX.equal(calls.length, 1, toolId);
      assertX.equal(calls[0].credentialId, "cred-ads", toolId);
      assertX.equal(calls[0].url.includes("/customers/1234567890/googleAds:search"), true, toolId);
      assertX.equal(calls[0].headers, undefined, toolId);
      assertX.match(calls[0].body.query, /^SELECT /);
    }
  });

  check("ADS-MCP-V2B-15 account fields do not persist on the MCP node", () => {
    const workflows = require("../modules/workflows/workflows.service");
    const definition = {
      version: 1,
      nodes: [
        {
          id: "ads-mcp-node",
          type: "googleAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "googleAdsMcpTool",
            toolId: "campaigns",
            credentialId: "cred-ads",
            customerId: "1234567890",
            loginCustomerId: "1098765432",
            params: { status: "ENABLED", customerId: "1234567890" },
          },
        },
      ],
      edges: [],
    };
    workflows.validateDefinition(definition);
    const saved = definition.nodes[0].data;
    assertX.equal(saved.credentialId, undefined);
    assertX.equal(saved.customerId, undefined);
    assertX.equal(saved.loginCustomerId, undefined);
    assertX.equal(saved.params.customerId, undefined);
    assertX.equal(saved.params.status, "ENABLED");
  });

  check("ADS-MCP-V2B-16 provenance is set for every common tool", async () => {
    const samples = {
      account_summary: { customer: { id: "1234567890", descriptiveName: "Main" } },
      campaigns: { campaign: { id: "1", name: "Brand" } },
      ad_groups: { adGroup: { id: "2", name: "Search" } },
      ads: { adGroupAd: { ad: { id: "3", type: "RESPONSIVE_SEARCH_AD" } } },
      keywords: { adGroupCriterion: { keyword: { text: "shoes" } } },
      assets: { asset: { id: "4", type: "SITELINK" } },
      conversion_actions: { conversionAction: { id: "5", name: "Purchase" } },
      recommendations: { recommendation: { type: "KEYWORD" } },
    };
    for (const toolId of COMMON_IDS) {
      const result = await registry().executeGoogleAdsMcpNode(
        adsNode(toolId, {}),
        sourceContext([sourceNode("ads-source")]),
        {
          googleApiRequest: async () => ({ body: { results: [samples[toolId]] } }),
        }
      );
      const meta = result.items[0].json._meta;
      assertX.equal(meta.provider, "google_ads", toolId);
      assertX.equal(meta.tool, toolId);
      assertX.equal(meta.resource, adsMcp().buildCommonToolQuery(toolId, {}).resource, toolId);
      assertX.equal(meta.customerId, "1234567890", toolId);
      assertX.equal(meta.apiVersion, "v25", toolId);
      assertX.equal(JSON.stringify(result).includes("accessToken"), false);
    }
  });

  check("ADS-MCP-V2B-17 entity grounding does not say Campaign Performance", () => {
    const grounding = require("../services/workflowGoogleAdsAiGrounding");
    const row = {
      campaign: { id: "1", name: "Brand", status: "ENABLED" },
      _meta: {
        provider: "google_ads",
        tool: "campaigns",
        resource: "campaign",
        customerId: "1234567890",
        apiVersion: "v25",
      },
    };
    const grounded = grounding.applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    const report = grounding.formatGoogleAdsReport([row]);
    assertX.match(grounded.systemPrompt, /report: Google Ads Campaign Data/);
    assertX.match(report, /Google Ads Campaign Data/);
    assertX.equal(grounded.systemPrompt.includes("Campaign Performance"), false);
    assertX.equal(report.includes("Campaign Performance"), false);
  });

  check("ADS-MCP-V2B-18 entity grounding has no GA4 or GSC terminology", () => {
    const grounding = require("../services/workflowGoogleAdsAiGrounding");
    const row = {
      customer: { id: "1234567890", descriptiveName: "Main" },
      _meta: {
        provider: "google_ads",
        tool: "account_summary",
        resource: "customer",
        apiVersion: "v25",
      },
    };
    const grounded = grounding.applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    assertX.match(grounded.systemPrompt, /Google Ads Account Data/);
    assertX.equal(/GA4|GSC|Search Console|landing page|engagement rate/i.test(grounded.systemPrompt), false);
  });

  check("ADS-MCP-V2B-19 raw Search is unchanged", async () => {
    const calls = [];
    await registry().executeGoogleAdsMcpNode(
      adsNode("search", { query: "SELECT campaign.id FROM campaign LIMIT 1" }),
      sourceContext([sourceNode("ads-source")]),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].body.query.includes("SELECT campaign.id FROM campaign"), true);
    assertX.equal(calls[0].body.query.includes("customer.descriptive_name"), false);
    assertX.equal(calls[0].url.includes("/googleAds:search"), true);
  });

  check("ADS-MCP-V2B-20 metadata is unchanged", async () => {
    const calls = [];
    await registry().executeGoogleAdsMcpNode(
      adsNode("get_resource_metadata", { resourceOrField: "metrics.clicks" }),
      sourceContext([sourceNode("ads-source")]),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ name: "metrics.clicks", category: "METRIC" }] } };
        },
      }
    );
    assertX.equal(calls[0].url.includes("googleAdsFields:search"), true);
    assertX.equal(calls[0].url.includes("googleAds:search"), false);
  });

  check("ADS-MCP-V2B-21 native Google Ads node is unchanged", () => {
    assertX.deepEqual(Object.keys(nativeAds().REPORTS), [
      "campaign_performance",
      "ad_group_performance",
      "keyword_performance",
      "search_terms",
      "device_performance",
      "geographic_performance",
      "conversion_performance",
    ]);
    const native = read("../services/workflowGoogleAds.service.js");
    assertX.equal(native.includes("account_summary"), false);
    assertX.equal(native.includes("googleAds:mutate"), false);
  });

  check("ADS-MCP-V2B-22 legacy dynamic Google Ads search still executes", async () => {
    const calls = [];
    const result = await registry().executeDynamicMcpNode(
      {
        id: "legacy-ads",
        type: "mcpDynamicTool",
        data: {
          provider: "google_ads",
          toolId: "search",
          credentialId: "cred-legacy",
          params: {
            customerId: "1234567890",
            query: "SELECT campaign.id FROM campaign",
          },
        },
      },
      {},
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].credentialId, "cred-legacy");
    assertX.equal(result.items[0].json._meta.tool, "search");
  });

  check("ADS-MCP-V2B-23 GA4 MCP regression", () => {
    const ga4 = registry().listTools({ provider: "google_analytics" });
    assertX.ok(ga4.some((tool) => tool.id === "run_realtime_report"));
    assertX.equal(ga4.some((tool) => tool.id === "campaigns"), false);
  });

  check("ADS-MCP-V2B-24 GSC MCP regression", () => {
    const gsc = registry().listTools({ provider: "google_search_console" });
    assertX.deepEqual(gsc.map((tool) => tool.id), ["inspect_url_enhanced"]);
  });

  check("ADS-MCP-V2B-25 no mutation URLs exist", () => {
    const executor = read("../../plugins/google-ads-mcp/src/executor.js");
    const catalog = read("../../plugins/google-ads-mcp/src/contracts/catalog.js");
    assertX.equal(executor.includes("googleAds:mutate"), false);
    assertX.equal(catalog.includes("googleAds:mutate"), false);
    assertX.equal(executor.includes("ApplyRecommendation"), false);
  });

  const PERFORMANCE_IDS = [
    "campaign_performance",
    "ad_group_performance",
    "ad_performance",
    "keyword_performance",
    "search_terms",
    "device_performance",
    "geographic_performance",
    "placement_performance",
    "conversion_performance",
  ];

  const customRange = {
    dateRange: "custom",
    startDate: "2026-03-01",
    endDate: "2026-03-07",
    limit: 25,
  };

  const assertReusesNative = (toolId, mcpParams, nativeFilters) => {
    const built = adsMcp().buildPerformanceToolQuery(toolId, {
      ...customRange,
      ...mcpParams,
    });
    const nativeBuilt = nativeAds().buildReportQuery({
      reportType: toolId,
      startDate: "2026-03-01",
      endDate: "2026-03-07",
      filters: nativeFilters,
      limit: 25,
    });
    assertX.equal(built.query, nativeBuilt.gaql, toolId);
    assertX.strictEqual(built.report, nativeAds().REPORTS[toolId], toolId);
  };

  check("ADS-MCP-V2C-1 Performance group contains exactly 9 tools", () => {
    const performance = registry()
      .listTools({ provider: "google_ads" })
      .filter((tool) => tool.uiGroup === "performance");
    assertX.deepEqual(
      performance.map((tool) => tool.id),
      PERFORMANCE_IDS
    );
    assertX.deepEqual(
      performance.map((tool) => tool.displayName),
      [
        "Campaign Performance",
        "Ad Group Performance",
        "Ad Performance",
        "Keyword Performance",
        "Search Terms",
        "Device Performance",
        "Geographic Performance",
        "Placement Performance",
        "Conversion Performance",
      ]
    );
    for (const tool of performance) {
      assertX.equal(tool.access, "read");
      assertX.equal(tool.risk, "low");
      assertX.equal(tool.implemented, true);
    }
    const ui = read("../../frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /Performance/);
  });

  check("ADS-MCP-V2C-2 Campaign performance reuses native report definition", () => {
    assertReusesNative(
      "campaign_performance",
      { campaignId: "55", status: "ENABLED" },
      { campaignId: "55", campaignStatus: "ENABLED" }
    );
  });

  check("ADS-MCP-V2C-3 Ad group performance reuses native report definition", () => {
    assertReusesNative(
      "ad_group_performance",
      { campaignId: "55", adGroupId: "7", status: "PAUSED" },
      { campaignId: "55", adGroupId: "7", adGroupStatus: "PAUSED" }
    );
  });

  check("ADS-MCP-V2C-4 Keyword performance reuses native report definition", () => {
    assertReusesNative(
      "keyword_performance",
      { textContains: "shoe", status: "ENABLED", adGroupId: "7" },
      { adGroupId: "7", keywordText: "shoe", keywordStatus: "ENABLED" }
    );
  });

  check("ADS-MCP-V2C-5 Search terms reuses native report definition", () => {
    assertReusesNative(
      "search_terms",
      { searchTermContains: "buy shoes", campaignId: "55" },
      { campaignId: "55", searchTerm: "buy shoes" }
    );
  });

  check("ADS-MCP-V2C-6 Device performance reuses native report definition", () => {
    assertReusesNative(
      "device_performance",
      { device: "MOBILE", campaignId: "55" },
      { campaignId: "55", device: "MOBILE" }
    );
  });

  check("ADS-MCP-V2C-7 Geographic performance reuses native report definition", () => {
    assertReusesNative(
      "geographic_performance",
      { campaignId: "55" },
      { campaignId: "55" }
    );
  });

  check("ADS-MCP-V2C-8 Conversion performance reuses native report definition", () => {
    assertReusesNative(
      "conversion_performance",
      { campaignId: "55" },
      { campaignId: "55" }
    );
    const filtered = adsMcp().buildPerformanceToolQuery("conversion_performance", {
      ...customRange,
      conversionActionName: "Purchase",
      conversionActionCategory: "PURCHASE",
    });
    assertX.strictEqual(filtered.report, nativeAds().REPORTS.conversion_performance);
    assertX.match(filtered.query, /segments\.conversion_action_name = 'Purchase'/);
    assertX.match(filtered.query, /segments\.conversion_action_category = PURCHASE/);
  });

  check("ADS-MCP-V2C-9 Ad performance uses ad_group_ad", () => {
    const built = adsMcp().buildPerformanceToolQuery("ad_performance", {
      ...customRange,
      adId: "99",
      status: "ENABLED",
    });
    assertX.equal(built.resource, "ad_group_ad");
    assertX.match(built.query, /FROM ad_group_ad/);
    assertX.match(built.query, /ad_group_ad\.ad\.id = 99/);
    assertX.match(built.query, /ad_group_ad\.status = ENABLED/);
    assertX.equal(built.query.includes("responsive_search_ad"), false);
    assertX.equal(nativeAds().REPORTS.ad_performance, undefined);
  });

  check("ADS-MCP-V2C-10 Placement performance uses group_placement_view", () => {
    const built = adsMcp().buildPerformanceToolQuery("placement_performance", {
      ...customRange,
      placementContains: "example.com",
    });
    assertX.equal(built.resource, "group_placement_view");
    assertX.match(built.query, /FROM group_placement_view/);
    assertX.match(built.query, /group_placement_view\.placement/);
    assertX.match(built.query, /group_placement_view\.display_name LIKE '%example\.com%'/);
    assertX.equal(built.query.includes("group_placement_view.placement LIKE"), false);
    assertX.equal(built.query.includes("detail_placement_view"), false);
  });

  check("ADS-MCP-V2C-11 Every performance tool has an independent date range", () => {
    for (const toolId of PERFORMANCE_IDS) {
      const fields = registry().describeInputFields(
        registry().getToolDefinition("google_ads", toolId).inputSchema
      );
      const names = fields.map((field) => field.name);
      assertX.equal(names.includes("dateRange"), true, toolId);
      assertX.equal(names.includes("startDate"), true, toolId);
      assertX.equal(names.includes("endDate"), true, toolId);
      const built = adsMcp().buildPerformanceToolQuery(toolId, customRange);
      assertX.match(built.query, /segments\.date BETWEEN '2026-03-01' AND '2026-03-07'/, toolId);
      assertX.deepEqual(built.dateRange, { startDate: "2026-03-01", endDate: "2026-03-07" });
    }
    const last7 = adsMcp().buildPerformanceToolQuery(
      "campaign_performance",
      { dateRange: "last7days" },
      { nowMs: Date.parse("2026-03-10T12:00:00Z") }
    );
    assertX.equal(last7.dateRange.startDate, "2026-03-04");
    assertX.equal(last7.dateRange.endDate, "2026-03-10");
  });

  check("ADS-MCP-V2C-12 MCP does not inherit native report date selection", async () => {
    const calls = [];
    await registry().executeGoogleAdsMcpNode(
      adsNode("campaign_performance", customRange),
      sourceContext([
        sourceNode("ads-source", {
          dateRange: "last30days",
          startDate: "2020-01-01",
          endDate: "2020-01-31",
          reportType: "keyword_performance",
        }),
      ]),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    const query = calls[0].body.query;
    assertX.match(query, /segments\.date BETWEEN '2026-03-01' AND '2026-03-07'/);
    assertX.equal(query.includes("2020-01-01"), false);
    assertX.equal(query.includes("keyword_view"), false);
    const src = read("../../plugins/google-ads-mcp/src/contracts/performance.js");
    assertX.equal(src.includes("source.data.dateRange"), false);
    assertX.equal(src.includes("data.dateRange"), false);
    assertX.equal(src.includes("data.reportType"), false);
  });

  check("ADS-MCP-V2C-13 Account context still inherited from source Google Ads node", async () => {
    const calls = [];
    const result = await registry().executeGoogleAdsMcpNode(
      adsNode("campaign_performance", customRange),
      sourceContext([
        sourceNode("ads-source", {
          credentialId: "cred-source",
          customerId: "1234567890",
          loginCustomerId: "1098765432",
        }),
      ]),
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].credentialId, "cred-source");
    assertX.match(calls[0].url, /customers\/1234567890\/googleAds:search$/);
    assertX.equal(calls[0].headers["login-customer-id"], "1098765432");
    assertX.equal(result.items[0].json._meta.customerId, "1234567890");
    assertX.equal(adsNode("campaign_performance", customRange).data.customerId, undefined);
  });

  check("ADS-MCP-V2C-14 No duplicate credential or customer fields", () => {
    for (const toolId of PERFORMANCE_IDS) {
      const names = registry()
        .describeInputFields(registry().getToolDefinition("google_ads", toolId).inputSchema)
        .map((field) => field.name);
      assertX.equal(names.includes("credentialId"), false, toolId);
      assertX.equal(names.includes("customerId"), false, toolId);
      assertX.equal(names.includes("loginCustomerId"), false, toolId);
    }
  });

  check("ADS-MCP-V2C-15 Geographic output retains countryCriterionId and locationType", async () => {
    const built = adsMcp().buildPerformanceToolQuery("geographic_performance", customRange);
    assertX.match(built.query, /geographic_view\.country_criterion_id/);
    assertX.match(built.query, /geographic_view\.location_type/);
    const result = await registry().executeGoogleAdsMcpNode(
      adsNode("geographic_performance", customRange),
      sourceContext([sourceNode("ads-source")]),
      {
        googleApiRequest: async () => ({
          body: {
            results: [
              {
                geographicView: {
                  countryCriterionId: "2840",
                  locationType: "LOCATION_OF_PRESENCE",
                },
                campaign: { id: "11", name: "Brand" },
              },
            ],
          },
        }),
      }
    );
    const row = result.items[0].json;
    assertX.equal(row.geographicView.countryCriterionId, "2840");
    assertX.equal(row.geographicView.locationType, "LOCATION_OF_PRESENCE");
    assertX.equal(row.country, undefined);
    assertX.equal(row.countryName, undefined);
  });

  check("ADS-MCP-V2C-16 Search terms remain distinct from keyword data", () => {
    const terms = adsMcp().buildPerformanceToolQuery("search_terms", customRange);
    const keywords = adsMcp().buildPerformanceToolQuery("keyword_performance", customRange);
    assertX.match(terms.query, /FROM search_term_view/);
    assertX.match(terms.query, /search_term_view\.search_term/);
    assertX.equal(terms.query.includes("ad_group_criterion.keyword.text"), false);
    assertX.match(keywords.query, /FROM keyword_view/);
    assertX.match(keywords.query, /ad_group_criterion\.keyword\.text/);
    assertX.equal(keywords.query.includes("search_term_view.search_term"), false);
    assertX.notEqual(terms.query, keywords.query);
  });

  check("ADS-MCP-V2C-17 Conversion Actions and Conversion Performance remain separate", () => {
    const catalog = adsMcp().buildCommonToolQuery("conversion_actions", {});
    const performance = adsMcp().buildPerformanceToolQuery("conversion_performance", customRange);
    assertX.match(catalog.query, /FROM conversion_action/);
    assertX.equal(catalog.query.includes("metrics.conversions"), false);
    assertX.match(performance.query, /segments\.conversion_action_name/);
    assertX.match(performance.query, /metrics\.conversions/);
    assertX.equal(performance.query.includes("conversion_action.id"), false);
    assertX.notEqual(catalog.resource, performance.resource);
  });

  check("ADS-MCP-V2C-18 Provenance is correct for every performance tool", async () => {
    for (const toolId of PERFORMANCE_IDS) {
      const built = adsMcp().buildPerformanceToolQuery(toolId, customRange);
      const result = await registry().executeGoogleAdsMcpNode(
        adsNode(toolId, customRange),
        sourceContext([sourceNode("ads-source")]),
        {
          googleApiRequest: async () => ({
            body: { results: [{ campaign: { id: "11" } }] },
          }),
        }
      );
      const meta = result.items[0].json._meta;
      assertX.equal(meta.provider, "google_ads", toolId);
      assertX.equal(meta.tool, toolId);
      assertX.equal(meta.resource, built.resource, toolId);
      assertX.equal(meta.customerId, "1234567890", toolId);
      assertX.equal(meta.apiVersion, "v25", toolId);
      assertX.deepEqual(meta.dateRange, { startDate: "2026-03-01", endDate: "2026-03-07" }, toolId);
      assertX.equal(JSON.stringify(result).includes("cred-ads"), false, toolId);
    }
  });

  check("ADS-MCP-V2C-19 Grounding labels are correct", () => {
    const grounding = require("../services/workflowGoogleAdsAiGrounding");
    const titles = {
      campaign_performance: "Google Ads Campaign Performance",
      ad_group_performance: "Google Ads Ad Group Performance",
      ad_performance: "Google Ads Ad Performance",
      keyword_performance: "Google Ads Keyword Performance",
      search_terms: "Google Ads Search Term Performance",
      device_performance: "Google Ads Device Performance",
      geographic_performance: "Google Ads Geographic Performance",
      placement_performance: "Google Ads Placement Performance",
      conversion_performance: "Google Ads Conversion Performance",
    };
    for (const toolId of PERFORMANCE_IDS) {
      const built = adsMcp().buildPerformanceToolQuery(toolId, customRange);
      const row = {
        campaign: { id: "11", name: "Brand" },
        metrics: { impressions: "10", clicks: "2" },
        _meta: {
          provider: "google_ads",
          tool: toolId,
          resource: built.resource,
          customerId: "1234567890",
          apiVersion: "v25",
          dateRange: built.dateRange,
        },
      };
      const grounded = grounding.applyGoogleAdsAiGrounding({
        systemPrompt: "",
        userPrompt: "",
        input: [{ json: row }],
      });
      const report = grounding.formatGoogleAdsReport([row]);
      assertX.match(grounded.systemPrompt, new RegExp(`report: ${titles[toolId]}`), toolId);
      assertX.match(report, new RegExp(titles[toolId]), toolId);
      assertX.match(grounded.systemPrompt, /performance records/, toolId);
    }
  });

  check("ADS-MCP-V2C-20 No GA4 or GSC contamination", () => {
    const grounding = require("../services/workflowGoogleAdsAiGrounding");
    const row = {
      searchTermView: { searchTerm: "buy shoes" },
      metrics: { impressions: "4" },
      _meta: {
        provider: "google_ads",
        tool: "search_terms",
        resource: "search_term_view",
        customerId: "1234567890",
        apiVersion: "v25",
      },
    };
    const grounded = grounding.applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [{ json: row }],
    });
    assertX.equal(
      /GA4|GSC|Search Console|landing page|engagement rate/i.test(grounded.systemPrompt),
      false
    );
    assertX.match(grounded.systemPrompt, /Google Ads Search Term Performance/);
    assertX.equal(/report: Keyword/.test(grounded.systemPrompt), false);
    const native = grounding.applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "",
      input: [
        {
          json: {
            source: "google_ads",
            provider: "google_ads",
            reportType: "campaign_performance",
            campaignName: "Brand",
            impressions: 10,
            clicks: 1,
            ctr: 0.1,
            cost: 1,
          },
        },
      ],
    });
    assertX.match(native.systemPrompt, /Campaign Performance/);
    assertX.equal(native.systemPrompt.includes("Google Ads Campaign Performance"), false);
  });

  check("ADS-MCP-V2C-21 No mutation endpoint is reachable", () => {
    const files = [
      "../../plugins/google-ads-mcp/src/executor.js",
      "../../plugins/google-ads-mcp/src/contracts/catalog.js",
      "../../plugins/google-ads-mcp/src/contracts/performance.js",
      "../services/googleAdsReportCatalog.js",
    ];
    for (const rel of files) {
      const src = read(rel);
      assertX.equal(src.includes("googleAds:mutate"), false, rel);
      assertX.equal(src.includes("ApplyRecommendation"), false, rel);
      assertX.equal(/CampaignOperation|AdGroupOperation/.test(src), false, rel);
    }
    assertX.throws(
      () => adsMcp().buildPerformanceToolQuery("campaign_performance", { segment: "week" }),
      (error) => error.code === "GOOGLE_ADS_FILTER"
    );
  });

  check("ADS-MCP-V2C-22 V2B Common tools are unchanged", () => {
    const common = registry()
      .listTools({ provider: "google_ads" })
      .filter((tool) => tool.uiGroup === "common")
      .map((tool) => tool.id);
    assertX.deepEqual(common, COMMON_IDS);
    const campaigns = adsMcp().buildCommonToolQuery("campaigns", { status: "ENABLED" });
    assertX.equal(campaigns.query.includes("metrics."), false);
    assertX.match(campaigns.query, /FROM campaign/);
    assertX.equal(campaigns.query.includes("segments.date"), false);
  });

  check("ADS-MCP-V2C-23 Advanced tools are unchanged", () => {
    const advanced = registry()
      .listTools({ provider: "google_ads" })
      .filter((tool) => tool.uiGroup === "advanced")
      .map((tool) => tool.id);
    assertX.deepEqual(advanced, ["get_resource_metadata", "search"]);
    const search = registry().describeInputFields(
      registry().getToolDefinition("google_ads", "search").inputSchema
    );
    assertX.deepEqual(
      search.map((field) => field.name),
      ["customerId", "loginCustomerId", "query", "limit", "returnAll"]
    );
    const metadata = registry().getToolDefinition("google_ads", "get_resource_metadata");
    assertX.equal(metadata.uiGroup, "advanced");
    const hidden = registry().getToolDefinition("google_ads", "list_accessible_customers");
    assertX.equal(hidden.uiGroup, "internal");
  });

  check("ADS-MCP-V2C-24 native Google Ads reports stay on the shared definitions", () => {
    assertX.deepEqual(Object.keys(nativeAds().REPORTS), [
      "campaign_performance",
      "ad_group_performance",
      "keyword_performance",
      "search_terms",
      "device_performance",
      "geographic_performance",
      "conversion_performance",
    ]);
    const nativeBuilt = nativeAds().buildReportQuery({
      reportType: "campaign_performance",
      startDate: "2026-03-01",
      endDate: "2026-03-07",
      limit: 25,
    });
    const mcpBuilt = adsMcp().buildPerformanceToolQuery("campaign_performance", customRange);
    assertX.equal(mcpBuilt.query, nativeBuilt.gaql);
    assertX.match(nativeBuilt.gaql, /campaign\.advertising_channel_type/);
    assertX.equal(nativeBuilt.gaql.includes("ad_group_ad"), false);
    const nativeSrc = read("../services/workflowGoogleAds.service.js");
    assertX.equal(nativeSrc.includes("googleAds:mutate"), false);
    assertX.match(nativeSrc, /googleAds:search/);
  });

  check("ADS-MCP-V2C-25 legacy Dynamic MCP Ads still works", async () => {
    const calls = [];
    const result = await registry().executeDynamicMcpNode(
      {
        id: "legacy-ads",
        type: "mcpDynamicTool",
        data: {
          provider: "google_ads",
          toolId: "search",
          credentialId: "cred-legacy",
          params: {
            customerId: "1234567890",
            query: "SELECT campaign.id FROM campaign",
          },
        },
      },
      {},
      {
        googleApiRequest: async (spec) => {
          calls.push(spec);
          return { body: { results: [{ campaign: { id: "11" } }] } };
        },
      }
    );
    assertX.equal(calls[0].credentialId, "cred-legacy");
    assertX.match(calls[0].url, /customers\/1234567890\/googleAds:search$/);
    assertX.equal(result.items[0].json._meta.tool, "search");
    assertX.equal(result.items[0].json._meta.dateRange, undefined);
  });
};

module.exports = { registerGoogleAdsMcpTests };
